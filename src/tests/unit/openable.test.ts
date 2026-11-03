// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { RootRegistry } from '@/main/fs/RootRegistry';
import { FilesService, type FilesPlatform } from '@/main/files/FilesService';
import { LAUNCHERS, REVEAL_REASON, openable } from '@/main/files/openable';
import { READ_ONLY_NOTICE } from '@/main/files/materialize';

vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

/** The extensions decision 42 names, which must only ever be shown in Finder. */
const DENIED = ['app', 'command', 'terminal', 'tool', 'workflow', 'action', 'scpt', 'applescript', 'jar', 'pkg', 'mpkg', 'fileloc', 'sh', 'zsh', 'bash', 'py', 'rb', 'pl'];

const BYTES = Buffer.from('%PDF-1.4 the real bytes');
const OID = createHash('sha256').update(BYTES).digest('hex');
const POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize ${BYTES.length}\n`;

function fakePlatform(): FilesPlatform {
  return {
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
    appName: vi.fn(async (file: string) => (file.endsWith('.pdf') ? 'Preview' : 'TextEdit')),
    quickLook: vi.fn(),
    thumbnail: vi.fn(async () => null),
    copyFileToClipboard: vi.fn(),
    saveDialog: vi.fn(async () => null),
    startDrag: vi.fn(async () => undefined),
  };
}

describe('openable', () => {
  let temporary: string, root: string, outside: string, platform: ReturnType<typeof fakePlatform>, service: FilesService;

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-openable-'));
    const registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    await mkdir(path.join(temporary, 'vault/.git'), { recursive: true });
    await mkdir(path.join(temporary, 'vault/Library/files'), { recursive: true });
    await mkdir(path.join(temporary, 'Downloads'));
    root = await registry.add(path.join(temporary, 'vault'));
    outside = path.join(temporary, 'Downloads');
    platform = fakePlatform();
    service = new FilesService({ registry, links: { invalidateDirectories: vi.fn() }, platform, appData: path.join(temporary, 'app-data') });
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('covers every launcher and script the design names', () => {
    for (const extension of DENIED) expect(LAUNCHERS.has(extension), extension).toBe(true);
  });

  it('only reveals each denied type in Finder, and never opens it', async () => {
    for (const extension of DENIED) {
      const file = path.join(root, `run.${extension}`);
      await writeFile(file, '#!/bin/sh\necho hi\n');
      expect(await service.open(file)).toEqual({ action: 'revealed', reason: REVEAL_REASON });
      expect(await service.quickLook(file)).toEqual({ action: 'revealed', reason: REVEAL_REASON });
    }
    expect(platform.openPath).not.toHaveBeenCalled();
    expect(platform.quickLook).not.toHaveBeenCalled();
    expect(platform.showItemInFolder).toHaveBeenCalledTimes(DENIED.length * 2);
  });

  it('reveals an app bundle, which is a folder', async () => {
    await mkdir(path.join(root, 'Tool.app/Contents'), { recursive: true });
    expect(await service.open(path.join(root, 'Tool.app'))).toMatchObject({ action: 'revealed' });
    expect(platform.openPath).not.toHaveBeenCalled();
  });

  it('reveals a file with its executable bit that macOS would run in Terminal, and opens an executable PDF', async () => {
    const tool = path.join(root, 'deploy');
    await writeFile(tool, '#!/bin/sh\n');
    await chmod(tool, 0o755);
    expect(await openable(tool, { inside: true })).toEqual({ action: 'reveal', reason: REVEAL_REASON });
    const pdf = path.join(root, 'odd.pdf');
    await writeFile(pdf, BYTES);
    await chmod(pdf, 0o755);
    expect(await openable(pdf, { inside: true })).toEqual({ action: 'open' });
  });

  it('opens a PDF in the vault in its app', async () => {
    const pdf = path.join(root, 'q3.pdf');
    await writeFile(pdf, BYTES);
    expect(await service.open(pdf)).toEqual({ action: 'opened', app: 'Preview' });
    expect(platform.openPath).toHaveBeenCalledWith(pdf);
  });

  it('asks first for a file outside the opened folders, naming the app, and opens it once confirmed', async () => {
    const pdf = path.join(outside, 'statement.pdf');
    await writeFile(pdf, BYTES);
    expect(await service.open(pdf)).toEqual({ action: 'confirm', app: 'Preview' });
    expect(platform.openPath).not.toHaveBeenCalled();
    expect(await service.open(pdf, { confirmed: true })).toEqual({ action: 'opened', app: 'Preview' });
    expect(platform.openPath).toHaveBeenCalledWith(await import('fs/promises').then((fs) => fs.realpath(pdf)));
  });

  it('treats a link inside the vault that leads out of it as outside', async () => {
    const pdf = path.join(outside, 'statement.pdf');
    await writeFile(pdf, BYTES);
    await symlink(pdf, path.join(root, 'linked.pdf'));
    expect(await service.open(path.join(root, 'linked.pdf'))).toMatchObject({ action: 'confirm' });
  });

  it('never opens a script outside the vault, even confirmed', async () => {
    const script = path.join(outside, 'install.command');
    await writeFile(script, 'echo hi');
    expect(await service.open(script, { confirmed: true })).toMatchObject({ action: 'revealed' });
    expect(platform.openPath).not.toHaveBeenCalled();
  });

  it('opens an LFS file from a read-only copy of its object and says so, never the placeholder', async () => {
    const deck = path.join(root, 'Library/files/q3.a1b2c3d4.pdf');
    await writeFile(deck, POINTER);
    const object = path.join(root, '.git/lfs/objects', OID.slice(0, 2), OID.slice(2, 4), OID);
    await mkdir(path.dirname(object), { recursive: true });
    await writeFile(object, BYTES);
    const result = await service.open(deck);
    expect(result).toEqual({ action: 'opened', app: 'Preview', notice: READ_ONLY_NOTICE });
    const opened = vi.mocked(platform.openPath).mock.calls[0][0];
    expect(opened.startsWith(path.join(temporary, 'app-data'))).toBe(true);
    expect(path.basename(opened)).toBe('q3.a1b2c3d4.pdf');
    expect(await readFile(opened)).toEqual(BYTES);
    expect((await stat(opened)).mode & 0o777).toBe(0o444);
    expect(await readFile(deck, 'utf8')).toBe(POINTER);
  });

  it('says an LFS file whose bytes are not here must be downloaded, and opens nothing', async () => {
    const deck = path.join(root, 'Library/files/q3.a1b2c3d4.pdf');
    await writeFile(deck, POINTER);
    await expect(service.open(deck)).rejects.toThrow(/not on this Mac yet/);
    expect(platform.openPath).not.toHaveBeenCalled();
  });
});

describe('copies out of the vault', () => {
  let temporary: string, root: string, platform: FilesPlatform, service: FilesService;

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-save-copy-'));
    const registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    await mkdir(path.join(temporary, 'vault/.git'), { recursive: true });
    await mkdir(path.join(temporary, 'Downloads'));
    root = await registry.add(path.join(temporary, 'vault'));
    platform = fakePlatform();
    service = new FilesService({ registry, links: { invalidateDirectories: vi.fn() }, platform, appData: path.join(temporary, 'app-data') });
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('saves a writable copy of an LFS file\'s real bytes under its shown name, and leaves the vault alone', async () => {
    const deck = path.join(root, 'q3.a1b2c3d4.pdf');
    await writeFile(deck, POINTER);
    const object = path.join(root, '.git/lfs/objects', OID.slice(0, 2), OID.slice(2, 4), OID);
    await mkdir(path.dirname(object), { recursive: true });
    await writeFile(object, BYTES);
    const destination = path.join(temporary, 'Downloads/Q3 report.pdf');
    vi.mocked(platform.saveDialog).mockResolvedValueOnce(destination);
    expect(await service.saveCopy(deck, 'Q3 report')).toEqual({ saved: destination });
    expect(platform.saveDialog).toHaveBeenCalledWith('Q3 report.pdf');
    expect(await readFile(destination)).toEqual(BYTES);
    expect((await stat(destination)).mode & 0o777).toBe(0o644);
    expect(await readFile(deck, 'utf8')).toBe(POINTER);
    vi.mocked(platform.saveDialog).mockResolvedValueOnce(null);
    expect(await service.saveCopy(deck)).toEqual({ saved: null });
    expect(platform.saveDialog).toHaveBeenLastCalledWith('q3.pdf');
  });

  it('copies nothing when the copy would land on the file itself', async () => {
    const note = path.join(root, 'plan.pdf');
    await writeFile(note, BYTES);
    vi.mocked(platform.saveDialog).mockResolvedValueOnce(note);
    expect(await service.saveCopy(note)).toEqual({ saved: note });
    expect(await readFile(note)).toEqual(BYTES);
  });

  it('puts the real bytes on the pasteboard and drags them, never the placeholder', async () => {
    const deck = path.join(root, 'q3.a1b2c3d4.pdf');
    await writeFile(deck, POINTER);
    await expect(service.copyFile(deck)).rejects.toThrow(/not on this Mac yet/);
    const object = path.join(root, '.git/lfs/objects', OID.slice(0, 2), OID.slice(2, 4), OID);
    await mkdir(path.dirname(object), { recursive: true });
    await writeFile(object, BYTES);
    await service.copyFile(deck);
    const copied = vi.mocked(platform.copyFileToClipboard).mock.calls[0][0];
    expect(await readFile(copied)).toEqual(BYTES);
    await service.startDrag({} as never, deck);
    expect(vi.mocked(platform.startDrag).mock.calls[0][1]).toBe(copied);
    await expect(service.copyFile(path.join(temporary, 'Downloads'))).rejects.toThrow(/not inside/);
  });
});
