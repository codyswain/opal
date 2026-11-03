// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { RootRegistry } from '@/main/fs/RootRegistry';
import type { RunFile } from '@/main/files/FileStore';
import { FilesService } from '@/main/files/FilesService';
import { fileStem, storedName } from '@/main/files/FolderStore';
import { gitEnvironment } from '@/main/files/GitLfsStore';
import { classifyFile, storedExtension, withoutHash } from '@/common/fileKind';

const git = (cwd: string, ...args: string[]) => promisify(execFile)('git', args, { cwd, env: gitEnvironment() });
const NOW = () => new Date(2026, 10, 2, 9, 30);
const hash8 = (bytes: Buffer) => storedName('x', bytes).split('.')[1];

describe('stored names', () => {
  it('keeps letters and marks from any script, in NFC', () => {
    // As macOS can hand a name over: e and a combining acute accent.
    const decomposed = 'Rapport été.pdf';
    expect(decomposed).not.toBe(decomposed.normalize('NFC'));
    expect(fileStem(decomposed)).toBe('rapport-été');
    expect(fileStem(decomposed)).toBe('rapport-été'.normalize('NFC'));
    expect(fileStem('रिपोर्ट नोट्स.pdf')).toBe('रिपोर्ट-नोट्स');
    expect(fileStem('日本語の資料 第2版.pdf')).toBe('日本語の資料-第2版');
    expect(fileStem('Ünïcödé — Notes (final).docx')).toBe('ünïcödé-notes-final');
  });

  it('never cuts a character in two at the length cap, and stays inside 255 bytes', () => {
    const long = `${'नोट्स'.repeat(40)}.pdf`;
    const stem = fileStem(long);
    expect(stem.length).toBeLessThanOrEqual(80);
    expect(Buffer.byteLength(stem)).toBeLessThanOrEqual(200);
    expect('नोट्स'.repeat(40).startsWith(stem)).toBe(true);
    expect(Buffer.byteLength(storedName(`${'日'.repeat(300)}.tar.gz`, Buffer.from('x')))).toBeLessThan(255);
  });

  it('keeps compound extensions whole, after the hash', () => {
    const bytes = Buffer.from('archive');
    expect(storedName('Backup 2026.tar.gz', bytes)).toBe(`backup-2026.${hash8(bytes)}.tar.gz`);
    expect(storedName('events.JSONL.gz', bytes)).toBe(`events.${hash8(bytes)}.jsonl.gz`);
    expect(storedName('Bracket v3.gcode.3mf', bytes)).toBe(`bracket-v3.${hash8(bytes)}.gcode.3mf`);
    expect(storedName('notes.v2.gz', bytes)).toBe(`notes-v2.${hash8(bytes)}.gz`);
    expect(storedExtension('.tar.gz')).toBe('gz');
    expect(withoutHash(`bracket-v3.${hash8(bytes)}.gcode.3mf`)).toBe('bracket-v3.gcode.3mf');
    expect(withoutHash('q3-report.a3f9c2e1.pdf')).toBe('q3-report.pdf');
    expect(withoutHash('plain.pdf')).toBe('plain.pdf');
  });

  it('knows jsonl and ndjson as text and aiff as audio', () => {
    expect(classifyFile('events.jsonl')).toBe('text');
    expect(classifyFile('events.ndjson')).toBe('text');
    expect(classifyFile('take.aiff')).toBe('audio');
    expect(classifyFile('take.aif')).toBe('audio');
  });
});

describe('importing files', () => {
  let temporary: string, root: string, page: string, outside: string, service: FilesService;
  let sips: ReturnType<typeof vi.fn<RunFile>>;
  const month = () => path.join(root, 'Library/files/2026-11');

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-file-import-'));
    const registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    await mkdir(path.join(temporary, 'vault/Library/notes'), { recursive: true });
    await mkdir(path.join(temporary, 'vault/.opal'), { recursive: true });
    await writeFile(path.join(temporary, 'vault/.opal/files.json'), '{ "version": 1, "folder": "Library/files", "store": "folder" }');
    root = await registry.add(path.join(temporary, 'vault'));
    await git(root, 'init', '-q');
    await writeFile(path.join(root, '.gitignore'), '.trash/\n.claude/state/\n');
    page = path.join(root, 'Library/notes/plan.mdo');
    await writeFile(page, '');
    outside = path.join(temporary, 'Desktop');
    await mkdir(outside);
    // sips says every picture is 5000 pixels wide and marks what it scaled.
    sips = vi.fn<RunFile>(async (_file, args) => {
      if (args[0] === '-g') return { stdout: '  pixelWidth: 5000\n  pixelHeight: 3000\n', stderr: '' };
      if (args[0] === '-Z') await writeFile(args[2], 'scaled');
      return { stdout: '', stderr: '' };
    });
    service = new FilesService({ registry, links: { invalidateDirectories: vi.fn() }, now: NOW, run: sips, appData: path.join(temporary, 'app-data') });
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('links a file already in the vault where it is, notes included, and copies nothing', async () => {
    await mkdir(path.join(root, 'Library/parametric'), { recursive: true });
    await writeFile(path.join(root, 'Library/parametric/q3.pdf'), '%PDF');
    expect(await service.import(page, { path: path.join(root, 'Library/parametric/q3.pdf') })).toEqual({
      path: path.join(root, 'Library/parametric/q3.pdf'), vaultPath: 'Library/parametric/q3.pdf', name: 'q3.pdf',
    });
    await writeFile(path.join(root, 'Library/notes/Other note.md'), '# Other');
    expect((await service.import(page, { path: path.join(root, 'Library/notes/Other note.md') })).vaultPath).toBe('Library/notes/Other note.md');
    await expect(readdir(path.join(root, 'Library/files'))).rejects.toThrow();
  });

  it('copies a file from a folder git ignores, since its link would break on the other Macs', async () => {
    await mkdir(path.join(root, '.claude/state'), { recursive: true });
    await writeFile(path.join(root, '.claude/state/render.png'), 'png bytes');
    const imported = await service.import(page, { path: path.join(root, '.claude/state/render.png') });
    expect(imported.vaultPath).toBe(`Library/files/2026-11/render.${hash8(Buffer.from('png bytes'))}.png`);
    expect(await readFile(imported.path, 'utf8')).toBe('png bytes');
  });

  it('copies a file from outside the vault', async () => {
    await writeFile(path.join(outside, 'Deck.pdf'), '%PDF deck');
    expect((await service.import(page, { path: path.join(outside, 'Deck.pdf') })).vaultPath).toMatch(/^Library\/files\/2026-11\/deck\.[0-9a-f]{8}\.pdf$/);
  });

  it('keeps a PNG at full size: sips never runs for it', async () => {
    const imported = await service.import(page, { bytes: new Uint8Array(Buffer.from('a 5000 pixel screenshot')), name: 'Screen Shot.png' });
    expect(await readFile(imported.path, 'utf8')).toBe('a 5000 pixel screenshot');
    expect(sips).not.toHaveBeenCalled();
    // A JPEG photo is still scaled.
    const photo = await service.import(page, { bytes: new Uint8Array(Buffer.from('jpeg')), name: 'IMG_1.jpg' });
    expect(await readFile(photo.path, 'utf8')).toBe('scaled');
  });

  it('keeps .tar.gz, .jsonl.gz and .gcode.3mf whole', async () => {
    for (const name of ['Backup.tar.gz', 'events.jsonl.gz', 'Bracket.gcode.3mf']) {
      await writeFile(path.join(outside, name), `bytes of ${name}`);
      const imported = await service.import(page, { path: path.join(outside, name) });
      expect(imported.vaultPath.endsWith(name.toLowerCase().replace(/^[^.]+/, ''))).toBe(true);
    }
    expect((await readdir(month())).sort()).toEqual([
      expect.stringMatching(/^backup\.[0-9a-f]{8}\.tar\.gz$/),
      expect.stringMatching(/^bracket\.[0-9a-f]{8}\.gcode\.3mf$/),
      expect.stringMatching(/^events\.[0-9a-f]{8}\.jsonl\.gz$/),
    ]);
  });

  it('stores the same bytes once, under any name', async () => {
    const first = await service.import(page, { bytes: new Uint8Array(Buffer.from('%PDF same')), name: 'Q3 report.pdf' });
    const again = await service.import(page, { bytes: new Uint8Array(Buffer.from('%PDF same')), name: 'q3 final (copy).pdf' });
    expect(again.vaultPath).toBe(first.vaultPath);
    // Another file whose name happens to carry the same hash is not taken for it.
    await writeFile(path.join(month(), `forged.${hash8(Buffer.from('%PDF other'))}.pdf`), 'not the same bytes');
    const other = await service.import(page, { bytes: new Uint8Array(Buffer.from('%PDF other')), name: 'other.pdf' });
    expect(path.basename(other.vaultPath)).toBe(`other.${hash8(Buffer.from('%PDF other'))}.pdf`);
    expect(await readdir(month())).toHaveLength(3);
  });

  it('names stored files in their own script', async () => {
    const decomposed = await service.import(page, { bytes: new Uint8Array(Buffer.from('a')), name: 'Rapport été.pdf' });
    expect(path.basename(decomposed.vaultPath).startsWith('rapport-été.')).toBe(true);
    const japanese = await service.import(page, { bytes: new Uint8Array(Buffer.from('b')), name: '日本語.pdf' });
    expect(path.basename(japanese.vaultPath).startsWith('日本語.')).toBe(true);
    expect(japanese.name).toBe('日本語.pdf');
  });

  it('turns a .webloc or .url into its address and stores nothing', async () => {
    await writeFile(path.join(outside, 'Opal PR.webloc'), '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>URL</key><string>https://github.com/codyswain/opal/pull/13?a=1&amp;b=2</string></dict></plist>\n');
    expect(await service.import(page, { path: path.join(outside, 'Opal PR.webloc') })).toEqual({
      path: '', vaultPath: '', name: 'Opal PR', url: 'https://github.com/codyswain/opal/pull/13?a=1&b=2',
    });
    await writeFile(path.join(outside, 'Docs.url'), '[InternetShortcut]\r\nURL=https://docs.google.com/document/d/1\r\n');
    expect((await service.import(page, { path: path.join(outside, 'Docs.url') })).url).toBe('https://docs.google.com/document/d/1');
    await writeFile(path.join(outside, 'App.webloc'), '<plist><dict><key>URL</key><string>file:///Applications/Calculator.app</string></dict></plist>');
    await expect(service.import(page, { path: path.join(outside, 'App.webloc') })).rejects.toThrow(/does not hold a web address/);
    await expect(readdir(path.join(root, 'Library/files'))).rejects.toThrow();
  });

  it('reads a binary .webloc through plutil, run without a shell', async () => {
    await writeFile(path.join(outside, 'Binary.webloc'), Buffer.concat([Buffer.from('bplist00'), Buffer.alloc(40)]));
    sips.mockResolvedValueOnce({ stdout: 'https://linear.app/parametricpbc/issue/SW-640\n', stderr: '' });
    expect((await service.import(page, { path: path.join(outside, 'Binary.webloc') })).url).toBe('https://linear.app/parametricpbc/issue/SW-640');
    expect(sips).toHaveBeenCalledWith('/usr/bin/plutil', ['-extract', 'URL', 'raw', '-o', '-', '--', path.join(outside, 'Binary.webloc')], expect.anything());
  });

  it('links a file over 100 MB in the vault, with a warning unless git sends it to LFS', async () => {
    const big = path.join(root, 'Library/clip.mov');
    await writeFile(big, '');
    await truncate(big, 100 * 1024 * 1024 + 1);
    const linked = await service.import(page, { path: big });
    expect(linked.vaultPath).toBe('Library/clip.mov');
    expect(linked.warning).toBe('"clip.mov" is larger than 100 MB and is not in Git LFS, so GitHub will refuse it.');
    await writeFile(path.join(root, '.gitattributes'), '*.mov filter=lfs diff=lfs merge=lfs -text\n');
    expect((await service.import(page, { path: big })).warning).toBeUndefined();
  });

  it('refuses a folder and never links git\'s own files', async () => {
    await expect(service.import(page, { path: path.join(root, 'Library') })).rejects.toThrow("Folders can't be added yet.");
    await writeFile(path.join(root, '.git/description'), 'repo');
    const copied = await service.import(page, { path: path.join(root, '.git/description') });
    expect(copied.vaultPath).toMatch(/^Library\/files\/2026-11\/description\.[0-9a-f]{8}$/);
  });
});
