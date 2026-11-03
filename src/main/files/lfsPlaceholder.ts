import { constants } from 'fs';
import { lstat, open } from 'fs/promises';
import path from 'path';
import { commonDirOf, gitDirOf } from '@/main/fs/gitActivity';

/** A Git LFS placeholder is a few short lines; a larger file is the bytes themselves. */
export const PLACEHOLDER_LIMIT = 1024;
const SPEC_LINE = 'version https://git-lfs.github.com/spec/v1';

/** What a placeholder names: the SHA-256 of the bytes and their size. */
export interface Placeholder {
  oid: string;
  size: number;
}

/** The pointer in a placeholder's text, or null when the text is not one. */
export function parsePlaceholder(text: string): Placeholder | null {
  if (text.split('\n', 1)[0].replace(/\r$/, '') !== SPEC_LINE) return null;
  const oid = /^oid sha256:([0-9a-f]{64})\r?$/m.exec(text)?.[1];
  const size = /^size (\d+)\r?$/m.exec(text)?.[1];
  return oid && size ? { oid, size: Number(size) } : null;
}

/** The pointer a working file holds in place of its bytes, or null when the file is the bytes. */
export async function readPlaceholder(file: string): Promise<Placeholder | null> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size >= PLACEHOLDER_LIMIT) return null;
    return parsePlaceholder(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}

/**
 * Where git keeps a placeholder's bytes once they are on this Mac:
 * `<git common dir>/lfs/objects/<aa>/<bb>/<oid>`. Null while they are not,
 * or when the object there is cut short.
 */
export async function localObject(file: string, placeholder: Placeholder): Promise<string | null> {
  const gitDir = await gitDirOf(path.dirname(file));
  if (!gitDir) return null;
  const { oid } = placeholder;
  const object = path.join(await commonDirOf(gitDir), 'lfs', 'objects', oid.slice(0, 2), oid.slice(2, 4), oid);
  const info = await lstat(object).catch(() => null);
  return info?.isFile() && info.size === placeholder.size ? object : null;
}
