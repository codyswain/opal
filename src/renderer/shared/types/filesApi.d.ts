import type { FileStatus, FilesResult, ImportedFile, PickedFiles } from '@/types/files';

export interface FilesAPI {
  /**
   * Copies a file into the files folder of the vault that holds `page`: one
   * dropped from Finder by its path, one with no path (a paste, or a drag
   * from a browser) by its bytes.
   */
  import: (page: string, file: File) => Promise<FilesResult<ImportedFile>>;
  /** Whether a File stands for a file on disk, as one dropped or copied in Finder does, rather than for bytes alone. */
  hasPath: (file: File) => boolean;
  /** Insert image: asks for images with the open dialog and copies each in. Nothing when the dialog is canceled. */
  pickAndImport: (page: string) => Promise<FilesResult<PickedFiles>>;
  /** Whether a stored file's bytes are on this Mac, on the file store only, or gone. */
  status: (target: string) => Promise<FilesResult<FileStatus>>;
  /** Downloads a stored file's bytes, and answers its status after. */
  fetch: (target: string) => Promise<FilesResult<FileStatus>>;
}

declare global {
  interface Window {
    filesAPI: FilesAPI;
  }
}
