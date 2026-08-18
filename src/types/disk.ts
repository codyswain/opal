import type { FileKind } from '@/common/fileKind';

export type { FileKind };
export type { TextFileContents } from '@/main/fs/DiskReader';

/** A single file or directory on disk, as seen by the renderer. */
export interface DiskEntry {
  /** Absolute, POSIX-normalized, symlinks resolved. */
  path: string;
  name: string;
  kind: FileKind;
  isDirectory: boolean;
  /** Bytes. 0 for directories. */
  size: number;
  mtimeMs: number;
}

export interface DirectoryListing {
  path: string;
  entries: DiskEntry[];
}

/**
 * A discriminated version of IPCResponse for the disk API.
 *
 * The shared `IPCResponse<T>` declares `data?: T`, so checking `success` does
 * not narrow `data` to non-undefined and every renderer access would need a
 * non-null assertion. This union is structurally compatible with what the
 * handlers return, and gives the renderer real narrowing instead.
 */
export type DiskResult<T = undefined> =
  | { success: true; data: T; error?: undefined }
  | { success: false; error: string; data?: undefined };
