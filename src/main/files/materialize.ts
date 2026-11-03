import { randomUUID } from 'crypto';
import { constants } from 'fs';
import { chmod, copyFile, mkdir, readdir, rename, rm, stat, utimes } from 'fs/promises';
import path from 'path';
import { withoutHash } from '@/common/fileKind';
import { localObject, readPlaceholder } from './lfsPlaceholder';

/** Copies not handed out for this long are removed when Opal starts and whenever it makes a new one. */
export const COPY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const READ_ONLY_NOTICE = "Opened a read-only copy. Changes won't reach the vault.";

/** A real file holding a vault file's bytes: the file itself, or a read-only copy of its Git LFS object. */
export interface Materialized {
  path: string;
  copy: boolean;
}

/**
 * A path an app can open with the file's real bytes. A plain file is
 * itself. A Git LFS placeholder becomes a read-only copy of its object under
 * `copiesDir`, named as the page shows the file (without Opal's hash) so
 * apps know its type and title it well: cloned where the disk allows
 * (APFS), mode 0444, and never a link, so an app that saves can't change
 * git's object. Null when the object is not on this Mac; nothing is
 * downloaded here.
 */
export async function materialize(resolved: string, copiesDir: string): Promise<Materialized | null> {
  const info = await stat(resolved);
  const placeholder = info.isFile() && info.size < 1024 ? await readPlaceholder(resolved).catch(() => null) : null;
  if (!placeholder) return { path: resolved, copy: false };
  const object = await localObject(resolved, placeholder);
  if (!object) return null;

  const folder = path.join(copiesDir, placeholder.oid);
  const copy = path.join(folder, withoutHash(path.basename(resolved)));
  const existing = await stat(copy).catch(() => null);
  if (existing?.isFile() && existing.size === placeholder.size) {
    // The sweep goes by the folder's time, so a copy handed out again is kept another day.
    const now = new Date();
    await utimes(folder, now, now).catch(() => undefined);
    return { path: copy, copy: true };
  }

  await mkdir(folder, { recursive: true });
  const temporary = path.join(folder, `.copy-${process.pid}-${Date.now()}`);
  try {
    await copyFile(object, temporary, constants.COPYFILE_FICLONE);
    await chmod(temporary, 0o444);
    await rename(temporary, copy);
  } finally {
    await rm(temporary, { force: true });
  }
  void sweepCopies(copiesDir, COPY_MAX_AGE_MS);
  return { path: copy, copy: true };
}

/** Removes copies older than `maxAgeMs`; all of them at 0, as on quit. */
export async function sweepCopies(copiesDir: string, maxAgeMs: number, now = Date.now()): Promise<void> {
  const entries = await readdir(copiesDir).catch(() => [] as string[]);
  await Promise.all(entries.map(async (entry) => {
    const folder = path.join(copiesDir, entry);
    const info = await stat(folder).catch(() => null);
    if (info && (maxAgeMs <= 0 || now - info.mtimeMs >= maxAgeMs)) await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }));
}

/**
 * A writable copy of a file's real bytes for Copy file and dragging out,
 * named as the page shows it, in a folder of its own under `outgoingDir`.
 * Never the vault file itself, which a drag to Finder on the same disk
 * could move. The pasteboard may be read after Opal quits, so these are
 * removed by age only. Null when an LFS object is not on this Mac.
 */
export async function handOut(resolved: string, copiesDir: string, outgoingDir: string): Promise<string | null> {
  const real = await materialize(resolved, copiesDir);
  if (!real) return null;
  const folder = path.join(outgoingDir, randomUUID());
  await mkdir(folder, { recursive: true });
  const copy = path.join(folder, withoutHash(path.basename(resolved)));
  await copyFile(real.path, copy, constants.COPYFILE_FICLONE);
  await chmod(copy, 0o644);
  void sweepCopies(outgoingDir, COPY_MAX_AGE_MS);
  return copy;
}
