import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import os from 'os';
import { RootRegistry, PathNotAllowedError } from '@/main/fs/RootRegistry';
import { FileWriter, DestinationExistsError, InvalidNameError } from '@/main/fs/FileWriter';

let tmp: string;
let root: string;
let registry: RootRegistry;
let trashItem: ReturnType<typeof vi.fn>;
let writer: FileWriter;

const exists = async (target: string) =>
  stat(target).then(() => true).catch(() => false);

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-writer-'));
  root = path.join(tmp, 'Vault');
  await mkdir(path.join(root, 'Photos'), { recursive: true });
  await mkdir(path.join(root, 'Archive'), { recursive: true });
  await writeFile(path.join(root, 'note.md'), '# hello');
  await writeFile(path.join(root, 'Photos', 'a.jpg'), 'jpegbytes');

  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  await registry.load();
  await registry.add(root);

  trashItem = vi.fn(async () => undefined);
  writer = new FileWriter({ registry, trashItem });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('FileWriter.createDirectory', () => {
  it('creates a folder and returns its path', async () => {
    const created = await writer.createDirectory(root, 'New Folder');
    expect(created.endsWith('New Folder')).toBe(true);
    expect(await exists(created)).toBe(true);
  });

  it('refuses a parent outside every root', async () => {
    const outside = path.join(tmp, 'Outside');
    await mkdir(outside);
    await expect(writer.createDirectory(outside, 'x')).rejects.toThrow(PathNotAllowedError);
  });

  it('refuses to overwrite an existing entry', async () => {
    await expect(writer.createDirectory(root, 'Photos')).rejects.toThrow(DestinationExistsError);
  });

  it.each(['', '   ', '.', '..', 'a/b', 'a\\b', 'a\0b'])(
    'rejects the invalid name %j',
    async (name) => {
      await expect(writer.createDirectory(root, name)).rejects.toThrow(InvalidNameError);
    }
  );

  it('rejects a name that would escape the parent', async () => {
    await expect(writer.createDirectory(root, '../escaped')).rejects.toThrow(InvalidNameError);
    expect(await exists(path.join(tmp, 'escaped'))).toBe(false);
  });
});

describe('FileWriter.rename', () => {
  it('renames a file and returns the new path', async () => {
    const renamed = await writer.rename(path.join(root, 'note.md'), 'renamed.md');

    expect(renamed.endsWith('renamed.md')).toBe(true);
    expect(await readFile(renamed, 'utf-8')).toBe('# hello');
    expect(await exists(path.join(root, 'note.md'))).toBe(false);
  });

  it('renames a directory', async () => {
    const renamed = await writer.rename(path.join(root, 'Photos'), 'Pictures');
    expect(await exists(path.join(renamed, 'a.jpg'))).toBe(true);
  });

  it('refuses a target outside every root', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'x');
    await expect(writer.rename(outside, 'renamed.txt')).rejects.toThrow(PathNotAllowedError);
  });

  it('refuses to clobber an existing name', async () => {
    await expect(writer.rename(path.join(root, 'note.md'), 'Photos')).rejects.toThrow(
      DestinationExistsError
    );
    expect(await exists(path.join(root, 'note.md'))).toBe(true);
  });

  it('rejects a name containing a separator', async () => {
    await expect(writer.rename(path.join(root, 'note.md'), '../note.md')).rejects.toThrow(
      InvalidNameError
    );
    await expect(writer.rename(path.join(root, 'note.md'), 'sub/note.md')).rejects.toThrow(
      InvalidNameError
    );
  });

  it('allows renaming to the same name without error', async () => {
    const target = path.join(root, 'note.md');
    const result = await writer.rename(target, 'note.md');
    expect(await exists(result)).toBe(true);
  });
});

describe('FileWriter.move', () => {
  it('moves a file into another directory', async () => {
    const moved = await writer.move(path.join(root, 'note.md'), path.join(root, 'Archive'));

    expect(moved).toContain('Archive');
    expect(await readFile(moved, 'utf-8')).toBe('# hello');
    expect(await exists(path.join(root, 'note.md'))).toBe(false);
  });

  it('refuses a source outside every root', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'x');
    await expect(writer.move(outside, path.join(root, 'Archive'))).rejects.toThrow(
      PathNotAllowedError
    );
  });

  it('refuses a destination outside every root', async () => {
    const outside = path.join(tmp, 'Outside');
    await mkdir(outside);
    await expect(writer.move(path.join(root, 'note.md'), outside)).rejects.toThrow(
      PathNotAllowedError
    );
    expect(await exists(path.join(root, 'note.md'))).toBe(true);
  });

  it('refuses to clobber an existing file at the destination', async () => {
    await writeFile(path.join(root, 'Archive', 'note.md'), 'different');
    await expect(writer.move(path.join(root, 'note.md'), path.join(root, 'Archive'))).rejects.toThrow(
      DestinationExistsError
    );

    expect(await readFile(path.join(root, 'Archive', 'note.md'), 'utf-8')).toBe('different');
    expect(await exists(path.join(root, 'note.md'))).toBe(true);
  });

  it('refuses to move a directory into itself', async () => {
    await expect(writer.move(path.join(root, 'Photos'), path.join(root, 'Photos'))).rejects.toThrow(
      /into itself/i
    );
  });

  it('refuses to move a directory into its own descendant', async () => {
    await mkdir(path.join(root, 'Photos', 'Rwanda'), { recursive: true });
    await expect(
      writer.move(path.join(root, 'Photos'), path.join(root, 'Photos', 'Rwanda'))
    ).rejects.toThrow(/into itself/i);
    expect(await exists(path.join(root, 'Photos', 'a.jpg'))).toBe(true);
  });

  it('is a no-op when the destination is the current parent', async () => {
    const result = await writer.move(path.join(root, 'note.md'), root);
    expect(await exists(result)).toBe(true);
  });

  it('rejects a destination that is a file', async () => {
    await expect(writer.move(path.join(root, 'Photos', 'a.jpg'), path.join(root, 'note.md'))).rejects.toThrow(
      /not a directory/i
    );
  });
});

describe('FileWriter.moveToTrash', () => {
  it('delegates to the OS trash, never unlinking', async () => {
    const target = path.join(root, 'note.md');
    await writer.moveToTrash(target);

    expect(trashItem).toHaveBeenCalledTimes(1);
    expect(trashItem.mock.calls[0][0]).toContain('note.md');
    expect(await exists(target)).toBe(true);
  });

  it('refuses a target outside every root', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'x');

    await expect(writer.moveToTrash(outside)).rejects.toThrow(PathNotAllowedError);
    expect(trashItem).not.toHaveBeenCalled();
  });

  it('refuses to trash an opened root itself', async () => {
    await expect(writer.moveToTrash(root)).rejects.toThrow(/opened folder/i);
    expect(trashItem).not.toHaveBeenCalled();
  });

  it('propagates a trash failure', async () => {
    trashItem.mockRejectedValue(new Error('Trash is full'));
    await expect(writer.moveToTrash(path.join(root, 'note.md'))).rejects.toThrow(/trash is full/i);
  });
});

describe('FileWriter leaves nothing behind on rejection', () => {
  it('does not create partial state when a name is invalid', async () => {
    await expect(writer.createDirectory(root, '..')).rejects.toThrow(InvalidNameError);
    expect((await readdir(root)).sort()).toEqual(['Archive', 'Photos', 'note.md']);
  });
});
