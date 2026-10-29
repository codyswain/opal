import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { IpcMain } from 'electron';
vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import { MarkdownConflictError, MarkdownDocumentService, MarkdownError } from '@/main/fs/MarkdownDocumentService';
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

beforeEach(async () => {
  noteEdited.mockClear();
  invalidate.mockClear();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-markdown-'));
  root = path.join(tmp, 'root');
  await mkdir(root);
  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  root = await registry.add(root);
  service = new MarkdownDocumentService({ registry, metadata: { invalidate }, activity: { noteEdited }, recoveryDir: path.join(tmp, 'Recovered') });
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

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
    expect([...handlers.keys()].sort()).toEqual(['markdown:create', 'markdown:read', 'markdown:resolve-links', 'markdown:save-copy', 'markdown:write']);
    await writeFile(item('note.md'), '# one\n');
    const read = await invoke('markdown:read', item('note.md')) as { success: true; data: { revision: string } };
    expect(read.success).toBe(true);
    expect(await invoke('markdown:read', '')).toMatchObject({ success: false, error: /Invalid/ });
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
