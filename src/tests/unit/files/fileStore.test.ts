// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, truncate, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { RootRegistry, PathNotAllowedError } from '@/main/fs/RootRegistry';
import { FilesError, runFile, type RunFile } from '@/main/files/FileStore';
import { FilesService } from '@/main/files/FilesService';
import { DEFAULT_FILES_SETTINGS, parseFilesSettings, readFilesSettings } from '@/main/files/filesSettings';
import { FolderStore, LONG_EDGE_LIMIT, SIPS, fileStem, storedName } from '@/main/files/FolderStore';
import { FILE_IMPORT_LIMIT } from '@/types/files';

const NOW = () => new Date(2026, 10, 2, 9, 30);
const PNG = Buffer.from('png bytes');
const hash8 = (bytes: Buffer) => storedName('x', bytes).split('.')[1];

describe('file names', () => {
  it('keeps lowercase letters, digits and single hyphens in the stem', () => {
    expect(fileStem('Nest Frame.JPG')).toBe('nest-frame');
    expect(fileStem('IMG 2041 (1).HEIC')).toBe('img-2041-1');
    expect(fileStem('Café plan, v2.png')).toBe('cafe-plan-v2');
    expect(fileStem('--a__b--.pdf')).toBe('a-b');
    expect(fileStem('.gitignore')).toBe('gitignore');
    expect(fileStem('照片.png')).toBe('file');
    expect(fileStem(`${'a'.repeat(200)}.png`)).toHaveLength(80);
  });

  it('names a file <stem>.<first 8 hex of its SHA-256>.<ext>, with JPEG for HEIC, HEIF and TIFF', () => {
    // sha256("png bytes")
    expect(storedName('Nest Frame.PNG', PNG)).toMatch(/^nest-frame\.[0-9a-f]{8}\.png$/);
    expect(storedName('Nest Frame.PNG', PNG)).toBe(`nest-frame.${hash8(PNG)}.png`);
    expect(storedName('IMG_1.HEIC', PNG)).toBe(`img-1.${hash8(PNG)}.jpg`);
    expect(storedName('scan.tiff', PNG)).toBe(`scan.${hash8(PNG)}.jpg`);
    expect(storedName('Makefile', PNG)).toBe(`makefile.${hash8(PNG)}`);
    expect(storedName('a.p n/g', PNG)).toBe(`a.${hash8(PNG)}.png`);
  });
});

describe('files settings', () => {
  it('reads a version 1 file naming a store and a folder below the top', () => {
    expect(parseFilesSettings('{ "version": 1, "folder": "Library/files", "store": "git-lfs" }')).toEqual({ folder: 'Library/files', store: 'git-lfs' });
    expect(parseFilesSettings('{ "version": 1, "folder": "./media/", "store": "folder" }')).toEqual({ folder: 'media', store: 'folder' });
  });

  it('uses files/ in a plain folder for anything else', () => {
    for (const text of [
      'not json',
      'null',
      '{ "folder": "Library/files", "store": "git-lfs" }',
      '{ "version": 2, "folder": "Library/files", "store": "git-lfs" }',
      '{ "version": 1, "folder": "Library/files", "store": "s3" }',
      '{ "version": 1, "store": "folder" }',
      '{ "version": 1, "folder": "/Users/cody/files", "store": "folder" }',
      '{ "version": 1, "folder": "../outside", "store": "folder" }',
      '{ "version": 1, "folder": "Library/../../outside", "store": "folder" }',
      '{ "version": 1, "folder": ".git/lfs", "store": "folder" }',
      '{ "version": 1, "folder": ".", "store": "folder" }',
      '{ "version": 1, "folder": "a\\\\b", "store": "folder" }',
    ]) expect(parseFilesSettings(text)).toEqual(DEFAULT_FILES_SETTINGS);
  });

  describe('on disk', () => {
    let temporary: string, root: string;
    beforeEach(async () => {
      temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-files-settings-'));
      root = path.join(temporary, 'vault');
      await mkdir(root);
    });
    afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

    it('reads .opal/files.json, and the defaults when it is missing, linked or too large', async () => {
      expect(await readFilesSettings(root)).toEqual(DEFAULT_FILES_SETTINGS);
      await mkdir(path.join(root, '.opal'));
      await writeFile(path.join(root, '.opal/files.json'), '{ "version": 1, "folder": "Library/files", "store": "git-lfs" }\n');
      expect(await readFilesSettings(root)).toEqual({ folder: 'Library/files', store: 'git-lfs' });

      await writeFile(path.join(root, '.opal/files.json'), `{ "version": 1, "folder": "Library/files", "store": "git-lfs", "pad": "${'x'.repeat(20_000)}" }`);
      expect(await readFilesSettings(root)).toEqual(DEFAULT_FILES_SETTINGS);

      const elsewhere = path.join(temporary, 'elsewhere');
      await mkdir(elsewhere);
      await writeFile(path.join(elsewhere, 'files.json'), '{ "version": 1, "folder": "Library/files", "store": "git-lfs" }');
      await rm(path.join(root, '.opal'), { recursive: true });
      await symlink(elsewhere, path.join(root, '.opal'));
      expect(await readFilesSettings(root)).toEqual(DEFAULT_FILES_SETTINGS);
    });
  });
});

describe('FolderStore', () => {
  let temporary: string, root: string, outside: string;
  let links: { invalidateDirectories: ReturnType<typeof vi.fn> };
  let sips: ReturnType<typeof vi.fn<RunFile>>;
  /** What sips -g reports for the image being read. */
  let size: { width: number; height: number };
  const store = () => new FolderStore({ root, folder: 'Library/files', links, run: sips, now: NOW });
  const month = () => path.join(root, 'Library/files/2026-11');

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-file-store-'));
    const registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    await mkdir(path.join(temporary, 'vault'));
    root = await registry.add(path.join(temporary, 'vault'));
    outside = path.join(temporary, 'Desktop');
    await mkdir(outside);
    links = { invalidateDirectories: vi.fn() };
    size = { width: 1200, height: 800 };
    // Stands in for /usr/bin/sips: converts by writing "jpeg:" before the input, scales by writing "scaled:".
    sips = vi.fn<RunFile>(async (_file, args) => {
      if (args[0] === '-g') return { stdout: `${args[4]}\n  pixelWidth: ${size.width}\n  pixelHeight: ${size.height}\n`, stderr: '' };
      if (args[0] === '-s') await writeFile(args[5], `jpeg:${await readFile(args[3], 'utf8')}`);
      if (args[0] === '-Z') await writeFile(args[2], `scaled:${await readFile(args[2], 'utf8')}`);
      return { stdout: '', stderr: '' };
    });
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('writes pasted bytes to <folder>/YYYY-MM/<stem>.<hash>.<ext> and tells the link index', async () => {
    const stored = await store().import({ bytes: new Uint8Array(PNG), name: 'Screen Shot.png' });
    expect(stored).toBe(`Library/files/2026-11/screen-shot.${hash8(PNG)}.png`);
    expect(await readFile(path.join(root, stored))).toEqual(PNG);
    // Written through a hidden temp file that is gone now.
    expect(await readdir(month())).toEqual([`screen-shot.${hash8(PNG)}.png`]);
    expect(links.invalidateDirectories).toHaveBeenCalledWith([root, month(), path.join(root, 'Library/files'), path.join(root, 'Library')]);
  });

  it('copies a dropped file by its path, and stores the same file under the same stem once', async () => {
    await writeFile(path.join(outside, 'Nest Frame.png'), PNG);
    const first = await store().import({ path: path.join(outside, 'Nest Frame.png') });
    sips.mockClear();
    const second = await store().import({ bytes: new Uint8Array(PNG), name: 'nest frame.PNG' });
    expect(second).toBe(first);
    // Found by name before any conversion runs.
    expect(sips).not.toHaveBeenCalled();
    const other = await store().import({ bytes: new Uint8Array(PNG), name: 'other.png' });
    expect(other).not.toBe(first);
    expect((await readdir(month())).sort()).toEqual([path.basename(first), path.basename(other)].sort());
  });

  it('links a dropped file already in the folder where it is', async () => {
    const stored = await store().import({ bytes: new Uint8Array(PNG), name: 'a.png' });
    expect(await store().import({ path: path.join(root, stored) })).toBe(stored);
    expect(await readdir(month())).toHaveLength(1);
  });

  it('refuses files over 100 MB, and folders', async () => {
    const big = path.join(outside, 'big.mov');
    await writeFile(big, '');
    await truncate(big, FILE_IMPORT_LIMIT + 1);
    await expect(store().import({ path: big })).rejects.toThrow(new FilesError('"big.mov" is larger than 100 MB, so it was not added.'));
    const bytes = new Uint8Array(FILE_IMPORT_LIMIT + 1);
    await expect(store().import({ bytes, name: 'paste.png' })).rejects.toThrow(/larger than 100 MB/);
    await expect(store().import({ path: outside })).rejects.toThrow(/not a file Opal can add/);
    await expect(readdir(month())).rejects.toThrow();
  });

  it('turns HEIC into JPEG and scales a photo over 2400 px with sips, run without a shell', async () => {
    size = { width: 4032, height: 3024 };
    const stored = await store().import({ bytes: new Uint8Array(Buffer.from('heic')), name: 'IMG_2041.HEIC' });
    expect(stored).toMatch(/^Library\/files\/2026-11\/img-2041\.[0-9a-f]{8}\.jpg$/);
    expect(await readFile(path.join(root, stored), 'utf8')).toBe('scaled:jpeg:heic');
    const calls = sips.mock.calls.map(([file, args]) => [file, args.map((arg) => arg.replace(/^.*\//, ''))]);
    expect(calls).toEqual([
      [SIPS, ['-s', 'format', 'jpeg', 'source.heic', '--out', 'converted.jpg']],
      [SIPS, ['-g', 'pixelWidth', '-g', 'pixelHeight', 'converted.jpg']],
      [SIPS, ['-Z', String(LONG_EDGE_LIMIT), 'converted.jpg']],
    ]);
    // The scratch files are outside the vault and removed after.
    expect(path.dirname(sips.mock.calls[0][1][3]).startsWith(root)).toBe(false);
  });

  it('leaves a small photo and a file that is not a photo as they are', async () => {
    const photo = await store().import({ bytes: new Uint8Array(PNG), name: 'small.png' });
    expect(await readFile(path.join(root, photo))).toEqual(PNG);
    expect(sips.mock.calls.map(([, args]) => args[0])).toEqual(['-g']);
    sips.mockClear();
    await store().import({ bytes: new Uint8Array(Buffer.from('%PDF')), name: 'Deck.pdf' });
    expect(sips).not.toHaveBeenCalled();
  });

  it('refuses an image sips cannot read', async () => {
    sips.mockRejectedValueOnce(new Error('sips: not an image'));
    await expect(store().import({ bytes: new Uint8Array(PNG), name: 'broken.png' })).rejects.toThrow('Opal could not read "broken.png" as an image.');
  });

  it('waits while git rewrites the repo, then writes', async () => {
    await mkdir(path.join(root, '.git'));
    await writeFile(path.join(root, '.git', 'MERGE_AUTOSTASH'), 'abc\n');
    let done = false;
    const importing = store().import({ bytes: new Uint8Array(PNG), name: 'held.pdf' }).then((stored) => { done = true; return stored; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(done).toBe(false);
    expect((await readdir(month())).filter((name) => !name.startsWith('.opal-edit-'))).toEqual([]);
    await rm(path.join(root, '.git', 'MERGE_AUTOSTASH'));
    expect(await readFile(path.join(root, await importing))).toEqual(PNG);
  });

  it('refuses a files folder that is a link out of the vault', async () => {
    await mkdir(path.join(root, 'Library'));
    await symlink(outside, path.join(root, 'Library/files'));
    await expect(store().import({ bytes: new Uint8Array(PNG), name: 'a.pdf' })).rejects.toThrow(/Symlinks/);
    expect(await readdir(outside)).toEqual([]);
  });

  it('says a plain file is here and a gone one missing', async () => {
    const stored = await store().import({ bytes: new Uint8Array(PNG), name: 'a.pdf' });
    expect(await store().status(path.join(root, stored))).toBe('here');
    expect(await store().fetch(path.join(root, stored))).toBe('here');
    expect(await store().status(path.join(root, 'Library/files/gone.png'))).toBe('missing');
  });
});

describe('FilesService', () => {
  let temporary: string, root: string, registry: RootRegistry, service: FilesService;
  const links = { invalidateDirectories: vi.fn() };

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-files-service-'));
    registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    await mkdir(path.join(temporary, 'vault/Notes'), { recursive: true });
    root = await registry.add(path.join(temporary, 'vault'));
    await writeFile(path.join(root, 'Notes/plan.mdo'), '');
    service = new FilesService({ registry, links, now: NOW });
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('imports into the folder the vault settings name, or files/ without settings', async () => {
    const plain = await service.import(path.join(root, 'Notes/plan.mdo'), { bytes: new Uint8Array(PNG), name: 'Deck.pdf' });
    expect(plain).toEqual({ path: path.join(root, plain.vaultPath), vaultPath: `files/2026-11/deck.${hash8(PNG)}.pdf`, name: 'Deck.pdf' });

    await mkdir(path.join(root, '.opal'));
    await writeFile(path.join(root, '.opal/files.json'), '{ "version": 1, "folder": "Library/files", "store": "git-lfs" }');
    const lfs = await service.import(path.join(root, 'Notes/plan.mdo'), { bytes: new Uint8Array(PNG), name: 'Deck.pdf' });
    expect(lfs.vaultPath).toBe(`Library/files/2026-11/deck.${hash8(PNG)}.pdf`);
    expect(await service.status(lfs.path)).toBe('here');
  });

  it('uses the outermost opened folder, where a vault keeps its settings', async () => {
    const notes = await registry.add(path.join(root, 'Notes'));
    const imported = await service.import(path.join(notes, 'plan.mdo'), { bytes: new Uint8Array(PNG), name: 'a.pdf' });
    expect(imported.vaultPath).toMatch(/^files\/2026-11\//);
    expect(imported.path.startsWith(path.join(root, 'files'))).toBe(true);
  });

  it('refuses pages and files outside the opened folders, and says a gone file inside one is missing', async () => {
    await writeFile(path.join(temporary, 'outside.md'), '');
    await expect(service.import(path.join(temporary, 'outside.md'), { bytes: new Uint8Array(PNG), name: 'a.pdf' })).rejects.toThrow(PathNotAllowedError);
    await expect(service.status(path.join(temporary, 'outside.md'))).rejects.toThrow(PathNotAllowedError);
    await expect(service.fetch(path.join(temporary, 'gone.png'))).rejects.toThrow(PathNotAllowedError);
    expect(await service.status(path.join(root, 'files/2026-11/gone.png'))).toBe('missing');
  });
});

describe('runFile', () => {
  it('passes arguments to the program as they are, with no shell between', async () => {
    expect((await runFile('/bin/echo', ['a;b', '$(whoami)', '*'], { timeout: 5000 })).stdout).toBe('a;b $(whoami) *\n');
  });
});
