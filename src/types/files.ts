import type { FileKind } from '@/common/fileKind';

/** Whether a stored file's bytes are on this Mac, still on the store, or gone. */
export type FileStatus = 'here' | 'remote' | 'missing';

/** Every Mac downloads every stored file, so larger files are refused. */
export const FILE_IMPORT_LIMIT = 100 * 1024 * 1024;
export const fileTooLarge = (name: string) => `"${name}" is larger than 100 MB, so it was not added.`;

/** A file put in the files folder. */
export interface ImportedFile {
  /** Absolute path of the stored file. */
  path: string;
  /** The same path from the vault's top, as an embed writes it: "Library/files/2026-11/nest-frame.a3f9c2e1.jpg". */
  vaultPath: string;
  /** The name the file had before it was stored. */
  name: string;
  /**
   * Set when a dropped `.webloc` or `.url` was read as the address it holds:
   * the page links to it and nothing was stored, so `path` and `vaultPath`
   * are empty.
   */
  url?: string;
  /** Something to tell the person, as when a file over 100 MB linked in place is not in Git LFS. */
  warning?: string;
}

/** What Insert image stored, and a message for each picked file it refused. */
export interface PickedFiles {
  files: ImportedFile[];
  skipped: string[];
}

/** Narrows on `success` without strict null checks, as DiskResult does. */
export type FilesResult<T> =
  | { success: true; data: T; error?: undefined; hidden?: undefined }
  | { success: false; error: string; data?: undefined; hidden?: true };

/**
 * Where a file's bytes are: a plain file, a Git LFS file whose object is on
 * this Mac or only on the file store, or nothing at that path.
 */
export type FileInfoStatus = 'local' | 'lfs-present' | 'lfs-missing' | 'missing';

/** What the page shows about a file before it loads it. */
export interface FileInfo {
  /** Absolute and resolved. */
  path: string;
  name: string;
  /** Bytes; for an LFS file, its object's size from the placeholder. 0 when missing. */
  size: number;
  /** Milliseconds since the epoch. 0 when missing. */
  mtimeMs: number;
  kind: FileKind;
  status: FileInfoStatus;
  /** The SHA-256 a Git LFS placeholder names. */
  oid?: string;
  /** From the file's own headers, with Spotlight as the fallback. Missing when neither says. */
  pages?: number;
  /** Seconds. */
  duration?: number;
  /** Pixels as the picture or video shows. */
  width?: number;
  height?: number;
  /** A Retina screenshot: two pixels to a point. */
  retina?: boolean;
}

/**
 * What Open did: opened the file (from a read-only copy for an LFS file,
 * with `notice` saying so), showed it in Finder because Opal never opens
 * apps and scripts, or nothing yet because the file is outside the opened
 * folders and the page must ask first, naming the app.
 */
export type OpenResult =
  | { action: 'opened'; app: string | null; notice?: string }
  | { action: 'revealed'; reason: string }
  | { action: 'confirm'; app: string | null };

/** A JPEG or PNG copy of a picture for display, as a data: URL. */
export interface Rendition {
  url: string;
  width: number;
  height: number;
}
