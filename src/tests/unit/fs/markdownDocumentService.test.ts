import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { IpcMain } from 'electron';
vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import { MarkdownConflictError, MarkdownDocumentService, MarkdownError } from '@/main/fs/MarkdownDocumentService';
import { PageHistory, parseStatedTime } from '@/main/fs/pageCreated';
import { LinkIndex } from '@/main/fs/LinkIndex';
import { MarkdownHandlers } from '@/main/fs/MarkdownHandlers';
import { MetadataService } from '@/main/fs/MetadataService';
import { RootRegistry } from '@/main/fs/RootRegistry';

let tmp: string;
let root: string;
let registry: RootRegistry;
let service: MarkdownDocumentService;
const noteEdited = vi.fn(async () => undefined);
const invalidate = vi.fn();
const item = (name: string) => path.join(root, name);
/**
 * The environment without the caller's GIT_* variables. A pre-commit hook in a
 * linked worktree sets GIT_DIR and GIT_INDEX_FILE to the real repo, and git
 * would then init, add and commit there instead of in the temp folder.
 */
const withoutGitVars = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
/** Runs git in the opened folder with a fixed identity and no signing or hooks from the user's config. */
const git = (args: string[], env: Record<string, string> = {}) =>
  execFileSync('git', ['-c', 'user.name=Opal Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd: root,
    env: { ...withoutGitVars(), ...env },
  });

beforeEach(async () => {
  noteEdited.mockClear();
  invalidate.mockClear();
  // The service runs git log in the folder too, and a hook's GIT_DIR would point it at the real repo.
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-markdown-'));
  root = path.join(tmp, 'root');
  await mkdir(root);
  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  root = await registry.add(root);
  service = new MarkdownDocumentService({ registry, metadata: { invalidate }, activity: { noteEdited }, recoveryDir: path.join(tmp, 'Recovered') });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

describe('MarkdownDocumentService', () => {
  it('reads the body after frontmatter and preserves BOM, frontmatter and CRLF on write', async () => {
    const original = Buffer.concat([Buffer.from('﻿'), Buffer.from('---\r\ntags: [a]\r\ncustom: keep # comment\r\n---\r\n# Title\r\n\r\nBody line\r\n')]);
    await writeFile(item('note.md'), original);
    const document = await service.read(item('note.md'));
    expect(document).toMatchObject({ body: '# Title\n\nBody line\n', properties: 2, size: original.length });
    const written = await service.write(item('note.md'), '# Title\n\nEdited body\n\n- item', document.revision);
    const bytes = await readFile(item('note.md'));
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from('﻿'));
    // The body is written as given; only new line breaks take the file's CRLF.
    expect(bytes.toString('utf8')).toBe('﻿---\r\ntags: [a]\r\ncustom: keep # comment\r\n---\r\n# Title\r\n\r\nEdited body\r\n\r\n- item');
    expect(written.revision).not.toBe(document.revision);
    expect((await service.read(item('note.md'))).revision).toBe(written.revision);
    expect(noteEdited).toHaveBeenCalledWith(item('note.md'));
    expect(invalidate).toHaveBeenCalled();
    // Metadata written through Details still sees the same frontmatter.
    const metadata = new MetadataService({ registry });
    expect((await metadata.read(item('note.md'))).properties.tags).toEqual(['a']);
  });

  it('handles files without frontmatter, keeps no trailing newline when there was none, and treats an unclosed block as text', async () => {
    await writeFile(item('plain.md'), 'Just text');
    const plain = await service.read(item('plain.md'));
    expect(plain).toMatchObject({ body: 'Just text', properties: 0 });
    await service.write(item('plain.md'), 'Changed', plain.revision);
    expect(await readFile(item('plain.md'), 'utf8')).toBe('Changed');
    await writeFile(item('open.md'), '---\ntitle: never closed\nbody');
    const open = await service.read(item('open.md'));
    expect(open).toMatchObject({ body: '---\ntitle: never closed\nbody', properties: 0 });
    // Only YAML properties hide; a block of anything else, such as rules typed around some text, stays in the page.
    await writeFile(item('list.md'), '---\n- not\n- a map\n---\nBody');
    expect(await service.read(item('list.md'))).toMatchObject({ body: '---\n- not\n- a map\n---\nBody', properties: 0 });
    await writeFile(item('typed.md'), '---\nSome notes\n---\nBody');
    const typed = await service.read(item('typed.md'));
    expect(typed).toMatchObject({ body: '---\nSome notes\n---\nBody', properties: 0 });
    await service.write(item('typed.md'), '---\nSome notes!\n---\nBody', typed.revision);
    expect(await readFile(item('typed.md'), 'utf8')).toBe('---\nSome notes!\n---\nBody');
    await writeFile(item('empty.md'), '---\n---\nBody');
    expect(await service.read(item('empty.md'))).toMatchObject({ body: 'Body', properties: 0 });
  });

  it('gives the properties block the frontmatter as text and the file facts', async () => {
    const daily = path.join(root, 'Library', 'daily', '2026-10-28.md');
    await mkdir(path.dirname(daily), { recursive: true });
    const text = [
      '---',
      'date: 2026-10-28',
      'tags:',
      '  - daily',
      '  - kigali',
      'duration_min: 27',
      'gemini_notes: true',
      'summary:',
      'thread: "[[Library/chats/opal-status]]"',
      'base: &where { site: SF }',
      'again: *where',
      '---',
      '',
    ].join('\n');
    await writeFile(daily, text);
    const modified = new Date(2026, 9, 28, 6, 38);
    await utimes(daily, modified, modified);
    const facts = await service.properties(daily);
    expect(facts).toEqual({
      path: daily,
      relativePath: 'Library/daily/2026-10-28.md',
      properties: [
        { key: 'date', values: ['2026-10-28'] },
        { key: 'tags', values: ['daily', 'kigali'] },
        { key: 'duration_min', values: ['27'] },
        { key: 'gemini_notes', values: ['true'] },
        { key: 'summary', values: [] },
        { key: 'thread', values: ['[[Library/chats/opal-status]]'] },
        { key: 'base', values: ['{"site":"SF"}'] },
        { key: 'again', values: ['{"site":"SF"}'] },
      ],
      // A daily page's date is the day it began.
      created: { ms: new Date(2026, 9, 28).getTime(), dayOnly: true },
      modifiedMs: modified.getTime(),
      size: Buffer.byteLength(text),
    });
    // The count the page shows agrees with the list.
    expect((await service.read(daily)).properties).toBe(facts.properties.length);
    // A file without properties still has its facts; one whose block is not a map has no properties.
    await writeFile(item('plain.md'), 'Just text');
    expect(await service.properties(item('plain.md'))).toMatchObject({ relativePath: 'plain.md', properties: [], size: 9 });
    await writeFile(item('list.md'), '---\n- not\n- a map\n---\nBody');
    expect((await service.properties(item('list.md'))).properties).toEqual([]);
    await expect(service.properties(path.join(tmp, 'outside.md'))).rejects.toThrow(/not inside/i);
  });

  it('dates Created from the commit that added the file, and a save does not move it', async () => {
    const commitAt = (when: string, message: string) =>
      git(['commit', '-q', '--no-verify', '-m', message], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
    git(['init', '-q']);
    // The hook started each day's file as a copy of the template, and the move renamed it.
    const template = '## Morning\n### What am I changing today\n### What is my goal for today\n## Evening\n### What I Did Today\n';
    await mkdir(item('Archive/Journal'), { recursive: true });
    await writeFile(item('Archive/Journal/Template.md'), template);
    git(['add', '-A']);
    commitAt('2026-04-25T15:01:16-07:00', 'Template');
    await mkdir(item('Inbox/Logs'), { recursive: true });
    await writeFile(item('Inbox/Logs/2026-10-07.md'), `${template}Cody's line.\n`);
    git(['add', '-A']);
    commitAt('2026-10-07T00:11:29+02:00', 'Day');
    await mkdir(item('Library/daily'), { recursive: true });
    git(['mv', 'Inbox/Logs/2026-10-07.md', 'Library/daily/2026-10-07.md']);
    commitAt('2026-10-29T10:38:05-07:00', 'Move');

    const page = item('Library/daily/2026-10-07.md');
    // A fresh history each time, so nothing is remembered between reads.
    const created = async (file: string) =>
      (await new MarkdownDocumentService({ registry, history: new PageHistory() }).properties(file)).created;
    const began = { ms: Date.parse('2026-10-07T00:11:29+02:00'), dayOnly: false };
    expect(await created(page)).toEqual(began);

    // Every save replaces the file, so its birth time would be the time of the save.
    const inode = (await stat(page)).ino;
    const document = await service.read(page);
    await service.write(page, `${document.body}More.\n`, document.revision);
    expect((await stat(page)).ino).not.toBe(inode);
    expect(await created(page)).toEqual(began);

    // A file with no commit has no Created row; a stated time needs none.
    await writeFile(item('new.md'), 'Not committed yet');
    expect(await created(item('new.md'))).toBeNull();
    await writeFile(item('card.md'), '---\ncreated: "2026-10-28 09:12"\n---\n');
    expect(await created(item('card.md'))).toEqual({ ms: new Date(2026, 9, 28, 9, 12).getTime(), dayOnly: false });
    // A log's date counts; a date on any other page does not.
    await mkdir(item('Library/logs'), { recursive: true });
    await writeFile(item('Library/logs/2026-10-08 log.md'), '---\nwritten_by: ai\ntype: log\ndate: 2026-10-08\n---\n- 09:00 A line\n');
    expect(await created(item('Library/logs/2026-10-08 log.md'))).toEqual({ ms: new Date(2026, 9, 8).getTime(), dayOnly: true });
    await writeFile(item('dated.md'), '---\ndate: 2026-10-08\n---\n');
    expect(await created(item('dated.md'))).toBeNull();
  });

  it('reads a stated time as a day, a local time or a time with its offset', () => {
    expect(parseStatedTime('2026-10-28')).toEqual({ ms: new Date(2026, 9, 28).getTime(), dayOnly: true });
    expect(parseStatedTime('2026-10-28 09:12')).toEqual({ ms: new Date(2026, 9, 28, 9, 12).getTime(), dayOnly: false });
    expect(parseStatedTime('2026-10-28T09:12:30')).toEqual({ ms: new Date(2026, 9, 28, 9, 12, 30).getTime(), dayOnly: false });
    expect(parseStatedTime('2026-10-28T09:12:00-07:00')).toEqual({ ms: Date.parse('2026-10-28T16:12:00Z'), dayOnly: false });
    for (const value of [undefined, '', 'soon', '2026-02-30', '2026-10-28 25:00', '28/10/2026']) {
      expect(parseStatedTime(value)).toBeNull();
    }
  });

  it('refuses a stale revision without touching the file', async () => {
    await writeFile(item('note.md'), '# one\n');
    const document = await service.read(item('note.md'));
    await writeFile(item('note.md'), '# external\n');
    await expect(service.write(item('note.md'), '# mine\n', document.revision)).rejects.toThrow(MarkdownConflictError);
    expect(await readFile(item('note.md'), 'utf8')).toBe('# external\n');
    expect((await readdir(root)).some((name) => name.startsWith('.opal-edit-'))).toBe(false);
    expect(noteEdited).not.toHaveBeenCalled();
  });

  it('refuses paths outside roots, symlinks, non-Markdown, binary text and oversized files', async () => {
    const outside = path.join(tmp, 'outside.md');
    await writeFile(outside, '# out');
    await expect(service.read(outside)).rejects.toThrow(/not inside/i);
    await symlink(outside, item('link.md'));
    await expect(service.read(item('link.md'))).rejects.toThrow(/symlink|not inside/i);
    await writeFile(item('photo.jpg'), 'jpg');
    await expect(service.read(item('photo.jpg'))).rejects.toThrow(/Only Markdown/);
    await writeFile(item('bad.md'), Buffer.from([0xff, 0xfe, 0x00]));
    await expect(service.read(item('bad.md'))).rejects.toThrow(/UTF-8/);
    await expect(service.write(item('photo.jpg'), 'x', 'r')).rejects.toThrow(MarkdownError);
  });

  it('creates uniquely named empty notes and refuses bad names or files as parents', async () => {
    const first = await service.create(root);
    const second = await service.create(root);
    const named = await service.create(root, 'Meeting notes');
    expect([first.path, second.path, named.path].map((p) => path.basename(p))).toEqual(['Untitled.md', 'Untitled 2.md', 'Meeting notes.md']);
    expect(await readFile(first.path, 'utf8')).toBe('');
    await expect(service.create(root, 'bad/name')).rejects.toThrow(/not a valid file name/);
    await expect(service.create(first.path)).rejects.toThrow(/inside a folder|not a directory/i);
    await expect(service.create(path.join(tmp, 'elsewhere'))).rejects.toThrow(/not inside/i);
  });

  it('saves a copy next to the note, or in the recovery folder when the note\'s folder cannot take it', async () => {
    await writeFile(item('note.md'), '# note\n');
    const first = await service.saveCopy(item('note.md'), 'mine', 'unsaved copy');
    const second = await service.saveCopy(item('note.md'), 'mine again', 'unsaved copy');
    const conflicted = await service.saveCopy(item('note.md'), 'theirs', 'conflicted copy');
    expect([first, second, conflicted].map((copy) => copy.path)).toEqual([item('note (unsaved copy).md'), item('note (unsaved copy) 2.md'), item('note (conflicted copy).md')]);
    expect(await readFile(second.path, 'utf8')).toBe('mine again');
    expect(invalidate).toHaveBeenCalled();
    await chmod(root, 0o555);
    try {
      const recovered = await service.saveCopy(item('note.md'), 'locked out', 'unsaved copy');
      expect(recovered.path).toBe(path.join(tmp, 'Recovered', 'note (unsaved copy).md'));
      expect(await readFile(recovered.path, 'utf8')).toBe('locked out');
    } finally {
      await chmod(root, 0o755);
    }
    // A note whose root was closed still gets its copy, never next to it.
    const outside = await service.saveCopy(path.join(tmp, 'elsewhere', 'gone.md'), 'kept', 'unsaved copy');
    expect(outside.path).toBe(path.join(tmp, 'Recovered', 'gone (unsaved copy).md'));
  });

  it('reports a read-only file as a save failure and leaves it intact', async () => {
    await writeFile(item('ro.md'), '# locked\n');
    const document = await service.read(item('ro.md'));
    await chmod(root, 0o555);
    try {
      await expect(service.write(item('ro.md'), '# changed\n', document.revision)).rejects.toThrow();
    } finally {
      await chmod(root, 0o755);
    }
    expect(await readFile(item('ro.md'), 'utf8')).toBe('# locked\n');
  });
});

describe('MarkdownHandlers', () => {
  it('validates arguments and maps conflicts', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const ipc = { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as unknown as IpcMain;
    new MarkdownHandlers({ ipc, service, links: new LinkIndex({ registry }) }).registerAll();
    const invoke = (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing ${channel}`);
      return handler({}, ...args);
    };
    expect([...handlers.keys()].sort()).toEqual(['markdown:create', 'markdown:properties', 'markdown:read', 'markdown:resolve-links', 'markdown:save-copy', 'markdown:write']);
    await writeFile(item('note.md'), '# one\n');
    const read = await invoke('markdown:read', item('note.md')) as { success: true; data: { revision: string } };
    expect(read.success).toBe(true);
    expect(await invoke('markdown:read', '')).toMatchObject({ success: false, error: /Invalid/ });
    expect(await invoke('markdown:properties', item('note.md'))).toMatchObject({ success: true, data: { relativePath: 'note.md', properties: [], size: 6 } });
    expect(await invoke('markdown:properties', 42)).toMatchObject({ success: false, error: /Invalid/ });
    expect(await invoke('markdown:properties', path.join(tmp, 'outside.md'))).toMatchObject({ success: false, error: /not inside/ });
    expect(await invoke('markdown:write', item('note.md'), 42, read.data.revision)).toMatchObject({ success: false });
    await writeFile(item('note.md'), '# external\n');
    expect(await invoke('markdown:write', item('note.md'), '# mine\n', read.data.revision)).toEqual({ success: false, error: expect.stringMatching(/changed on disk/), conflict: true });
    expect(await invoke('markdown:create', root)).toMatchObject({ success: true, data: { path: item('Untitled.md') } });
    expect(await invoke('markdown:create', root, 7)).toMatchObject({ success: false });
    expect(await invoke('markdown:save-copy', item('note.md'), 'mine', 'unsaved copy')).toMatchObject({ success: true, data: { path: item('note (unsaved copy).md') } });
    expect(await invoke('markdown:save-copy', item('note.md'), 'mine', '../escape')).toMatchObject({ success: false, error: /Invalid/ });
    expect(await invoke('markdown:resolve-links', item('note.md'), ['NOTE', 'missing'])).toEqual({ success: true, data: { NOTE: item('note.md'), missing: null } });
    expect(await invoke('markdown:resolve-links', item('note.md'), 'note')).toMatchObject({ success: false, error: /Invalid/ });
    expect(await invoke('markdown:resolve-links', item('note.md'), Array(501).fill('x'))).toMatchObject({ success: false, error: /Invalid/ });
    expect(await invoke('markdown:resolve-links', path.join(tmp, 'outside.md'), ['note'])).toMatchObject({ success: false, error: /not inside/ });
  });
});
