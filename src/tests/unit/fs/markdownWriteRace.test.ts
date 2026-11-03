// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/** Runs just before the save's rename, where a hook's append can land after the revision check. */
const beforeRename = vi.hoisted(() => ({ run: null as null | (() => Promise<void>) }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      await beforeRename.run?.();
      return actual.rename(from, to);
    },
  };
});

import { MarkdownDocumentService } from '@/main/fs/MarkdownDocumentService';
import { RootRegistry } from '@/main/fs/RootRegistry';

let tmp: string;
let note: string;
let service: MarkdownDocumentService;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-write-race-'));
  const registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  const root = await registry.add(tmp);
  note = path.join(root, 'log.md');
  await writeFile(note, '# Day\n\n## Activity Log\n- 09:00 First\n');
  service = new MarkdownDocumentService({ registry });
});
afterEach(async () => {
  beforeRename.run = null;
  await rm(tmp, { recursive: true, force: true });
});

describe('MarkdownDocumentService write races', () => {
  it('keeps a line the hook appended between the revision check and the rename, and reports the revision it wrote', async () => {
    const document = await service.read(note);
    beforeRename.run = () => appendFile(note, '- 09:05 Second\n');
    const written = await service.write(note, '# Day, edited\n\n## Activity Log\n- 09:00 First\n', document.revision);
    expect(await readFile(note, 'utf8')).toBe('# Day, edited\n\n## Activity Log\n- 09:00 First\n- 09:05 Second\n');
    // The page saved without the appended line, so its next check of the disk merges it in.
    expect((await service.read(note)).revision).not.toBe(written.revision);
  });

  it('carries over only a pure append', async () => {
    const document = await service.read(note);
    beforeRename.run = () => writeFile(note, '# Rewritten by another tool, and longer than before\n');
    await service.write(note, '# Day, edited\n\n## Activity Log\n- 09:00 First\n', document.revision);
    expect(await readFile(note, 'utf8')).toBe('# Day, edited\n\n## Activity Log\n- 09:00 First\n');
  });
});
