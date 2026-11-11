// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { IpcMain } from 'electron';

vi.mock('@/main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { RootRegistry } from '@/main/fs/RootRegistry';
import { HiddenFiles } from '@/main/fs/HiddenFiles';
import { HiddenHandlers } from '@/main/fs/HiddenHandlers';
import { DiskReader } from '@/main/fs/DiskReader';
import { DiskHandlers } from '@/main/fs/DiskHandlers';
import { FileWriter } from '@/main/fs/FileWriter';
import { LinkIndex } from '@/main/fs/LinkIndex';
import { MetadataService } from '@/main/fs/MetadataService';
import { MarkdownDocumentService } from '@/main/fs/MarkdownDocumentService';
import { MarkdownHandlers } from '@/main/fs/MarkdownHandlers';
import { ActivityStore } from '@/main/activity/ActivityStore';
import { ActivityService } from '@/main/activity/ActivityService';
import { ActivityHandlers } from '@/main/activity/ActivityHandlers';
import { CollectionIndex } from '@/main/collections/CollectionIndex';
import { CollectionQueryService } from '@/main/collections/CollectionQueryService';
import { CollectionHandlers } from '@/main/collections/CollectionHandlers';
import { VaultService } from '@/main/vault/VaultService';
import { VaultHandlers } from '@/main/vault/VaultHandlers';
import { DayService } from '@/main/vault/DayService';
import { TouchedService } from '@/main/vault/TouchedService';
import { StackService } from '@/main/vault/StackService';
import { PinsService } from '@/main/pins/PinsService';
import { PinsHandlers } from '@/main/pins/PinsHandlers';
import { FilesService } from '@/main/files/FilesService';
import { FilesHandlers } from '@/main/files/FilesHandlers';
import { serveOpalFile } from '@/main/protocol/opalFile';
import { toOpalFileUrl } from '@/common/opalFileUrl';

/** Text that names or holds the hidden files. No answer may carry any of it while they are hidden. */
const MARKERS = ['Private.md', 'Photos/private', 'report.pdf', 'SECRET', 'Went over the private note', '2026-11-09.mdo'];
const DAY = '2026-11-10';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

describe('no IPC answer names or holds a hidden file while hidden', () => {
  let temporary: string, root: string, registry: RootRegistry;
  let hidden: HiddenFiles, collections: CollectionIndex, links: LinkIndex;
  const handlers = new Map<string, Handler>();
  const at = (relative: string) => path.join(root, relative);
  const put = async (relative: string, text: string) => {
    await mkdir(path.dirname(at(relative)), { recursive: true });
    await writeFile(at(relative), text);
  };
  const invoke = async (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return handler({ sender: { startDrag: vi.fn() } }, ...args);
  };

  beforeEach(async () => {
    handlers.clear();
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-hidden-surfaces-'));
    await mkdir(path.join(temporary, 'vault'));
    registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    root = await registry.add(path.join(temporary, 'vault'));

    await put('Notes/Index.md', '# Index\n\nSee [[Private]] and [[Plan]].\n');
    await put('Notes/Plan.md', '# Plan\n\nPlain words.\n');
    await put('Notes/Private.md', '# Private\n\nSECRET words.\n');
    await put('Photos/private/report.pdf', '%PDF-1.4 SECRET\n');
    await put('Library/daily/2026-11-10.mdo', '# Tuesday\n');
    await put('Library/daily/2026-11-09.mdo', '# Monday\n\nSECRET day.\n');
    await put('Library/daily/2026-11-08.mdo', '# Sunday\n');
    await put('Library/logs/2026-11-10 log.md', [
      '---', 'type: log', '---',
      '- 09:00 Went over the private note. · [[Notes/Private|Private]] · agent turn',
      '- 10:00 Wrote the plan. · [[Notes/Plan|Plan]] · agent turn',
      '',
    ].join('\n'));
    await put('Library/digests/2026-11-10 digest.md', '# Digest\n');
    await put('.opal/pins.json', JSON.stringify({ version: 1, pins: ['Notes/Private.md', 'Notes/Plan.md'] }));
    await put('.opal/hidden.json', JSON.stringify({ version: 1, hidden: ['Notes/Private.md', 'Photos/private', 'Library/daily/2026-11-09.mdo'] }));

    hidden = new HiddenFiles({ roots: () => registry.list(), prompt: async () => undefined, canPrompt: () => ({ ok: true }) });
    registry.setHidden(hidden);
    const seeing = registry.seeingHidden();
    const ipc = {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
      on: (channel: string, handler: Handler) => handlers.set(channel, handler),
    } as unknown as IpcMain;

    const reader = new DiskReader({ registry });
    const store = new ActivityStore({ storePath: path.join(temporary, 'activity.json') });
    collections = new CollectionIndex({ registry: seeing });
    links = new LinkIndex({ registry: seeing });
    const activity = new ActivityService({ registry, store, statEntry: (target) => reader.statEntry(target) });
    const metadata = new MetadataService({ registry, activity });
    const documents = new MarkdownDocumentService({ registry, metadata, activity, recoveryDir: path.join(temporary, 'Recovered') });
    const vault = new VaultService({ registry, documents });
    const days = new DayService({ registry, resolveLinks: (from, targets) => links.resolve(from, targets) });
    const files = new FilesService({ registry, links, appData: path.join(temporary, 'app') });
    const shell = { showItemInFolder: vi.fn(), openPath: vi.fn(async () => '') };

    new DiskHandlers({
      ipc, registry, reader, shell,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      copiesDir: files.copiesDir,
      watcher: { watch: vi.fn(async () => undefined), unwatch: vi.fn(async () => undefined) } as never,
      writer: new FileWriter({ registry, metadata, activity, trashItem: vi.fn(async () => undefined), hidden }),
    }).registerAll();
    new MarkdownHandlers({ ipc, service: documents, links, registry }).registerAll();
    new ActivityHandlers({ ipc, service: activity }).registerAll();
    new CollectionHandlers({ ipc, service: new CollectionQueryService({ registry, index: collections, activity: store }) }).registerAll();
    new VaultHandlers({
      ipc, service: vault, days, stacks: new StackService({ registry }),
      touched: new TouchedService({ registry, days }),
    }).registerAll();
    new PinsHandlers({ ipc, service: new PinsService({ registry }) }).registerAll();
    new FilesHandlers({ ipc, service: files, showOpenDialog: vi.fn() as never }).registerAll();
    new HiddenHandlers({ ipc, hidden, registry }).registerAll();

    // Opened while shown, so Recent holds it.
    await hidden.show();
    await invoke('activity:record', at('Notes/Private.md'), 'opened');
    await invoke('activity:record', at('Photos/private/report.pdf'), 'opened');
    await invoke('activity:record', at('Notes/Plan.md'), 'opened');
    await hidden.hide();
  });

  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  /** Every read-only channel, with the hidden paths and with general questions. */
  const everyAnswer = async () => {
    const privateNote = at('Notes/Private.md');
    const report = at('Photos/private/report.pdf');
    const nameQuery = (value: string) => ({
      version: 1,
      scope: { kind: 'all-roots' },
      filters: [{ field: 'name', op: 'matches', value }, { field: 'kind', op: 'not-in', values: ['directory'] }],
      sort: { field: 'match', direction: 'desc' },
    });
    const calls: Array<[string, ...unknown[]]> = [
      ['disk:list-roots'],
      ['disk:read-directory', root],
      ['disk:read-directory', at('Notes')],
      ['disk:read-directory', at('Photos')],
      ['disk:read-directory', at('Photos/private')],
      ['disk:stat', privateNote],
      ['disk:stat', report],
      ['disk:read-text-file', privateNote],
      ['disk:search-content', 'SECRET'],
      ['disk:search-content', 'words'],
      ['markdown:read', privateNote],
      ['markdown:properties', privateNote],
      ['markdown:read', at('Notes/Index.md')],
      ['markdown:resolve-links', at('Notes/Index.md'), ['Private', 'Notes/Private', 'Plan']],
      ['activity:recent', { limit: 50 }],
      ['collections:query', nameQuery('private'), { limit: 50 }],
      ['collections:query', nameQuery('report'), { limit: 50 }],
      ['collections:query', { version: 1, scope: { kind: 'all-roots' }, filters: [], sort: { field: 'opened', direction: 'desc' } }, { limit: 50 }],
      ['vault:discover'],
      ['vault:day', root, DAY],
      ['vault:touched-week', root, DAY],
      ['vault:stack', root, 'daily', at('Library/daily/2026-11-10.mdo')],
      ['pins:list'],
      ['files:status', report],
      ['files:fetch', report],
      ['files:info', report],
      ['files:thumbnail', report, 64, {}],
      ['files:app-name', report],
      ['files:find-moved', report],
      ['files:find-moved', at('Notes/Gone.md')],
      ['hidden:state'],
      ['hidden:blocked', [privateNote, report, at('Notes/Plan.md')]],
    ];
    const answers: Record<string, unknown> = {};
    for (const [channel, ...args] of calls) {
      answers[`${channel} ${JSON.stringify(args).slice(0, 80)}`] = await invoke(channel, ...args);
    }
    return answers;
  };

  const leaks = (answers: Record<string, unknown>) =>
    Object.entries(answers).flatMap(([call, answer]) => {
      const text = JSON.stringify(answer) ?? '';
      return MARKERS.filter((marker) => text.includes(marker)).map((marker) => `${call}: ${marker}`);
    });

  it('every channel leaves hidden files out, and refused reads say hidden', async () => {
    const answers = await everyAnswer();
    expect(leaks(answers)).toEqual([]);
    const refused = await invoke('markdown:read', at('Notes/Private.md'));
    expect(refused).toMatchObject({ success: false, hidden: true, error: 'This file is hidden.' });
    expect(await invoke('disk:read-text-file', at('Notes/Private.md'))).toMatchObject({ success: false, hidden: true });
    expect(await invoke('disk:read-directory', at('Photos/private'))).toMatchObject({ success: false, hidden: true });
    expect(await invoke('files:info', at('Photos/private/report.pdf'))).toMatchObject({ success: false, hidden: true });
    expect(await invoke('hidden:blocked', [at('Notes/Private.md'), at('Notes/Plan.md')])).toEqual({ success: true, data: [true, false] });
    expect(await invoke('vault:stack', root, 'daily', at('Library/daily/2026-11-09.mdo'))).toMatchObject({ success: false });
    const stack = JSON.stringify(await invoke('vault:stack', root, 'daily', at('Library/daily/2026-11-10.mdo')));
    expect(stack).toContain('2026-11-08.mdo');
    // The visible half of the day survives.
    const day = JSON.stringify(await invoke('vault:day', root, DAY));
    expect(day).toContain('Wrote the plan.');
  });

  it('the same calls do name them while shown, so the check above can see a leak', async () => {
    await hidden.show();
    const found = new Set(leaks(await everyAnswer()).map((leak) => leak.split(': ').at(-1)));
    expect([...found].sort()).toEqual([...MARKERS].sort());
  });

  it('hidden:remove and hidden:show cannot reach shown without the prompt', async () => {
    expect(await invoke('hidden:remove', at('Notes/Private.md'))).toMatchObject({ success: false });
    expect(hidden.isShown()).toBe(false);
  });

  it('the opal-file protocol refuses hidden files', async () => {
    const response = await serveOpalFile(new Request(toOpalFileUrl(at('Photos/private/report.pdf'))), { registry });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('SECRET');
  });
});
