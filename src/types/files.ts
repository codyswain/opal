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
}

/** What Insert image stored, and a message for each picked file it refused. */
export interface PickedFiles {
  files: ImportedFile[];
  skipped: string[];
}

/** Narrows on `success` without strict null checks, as DiskResult does. */
export type FilesResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; error: string; data?: undefined };
