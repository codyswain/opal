import type { FileInfo, FileStatus, FilesResult, ImportedFile, OpenResult, PickedFiles, Rendition } from '@/types/files';

export interface FilesAPI {
  /**
   * Copies a file into the files folder of the vault that holds `page`: one
   * dropped from Finder by its path, one with no path (a paste, or a drag
   * from a browser) by its bytes.
   */
  import: (page: string, file: File) => Promise<FilesResult<ImportedFile>>;
  /** Whether a File stands for a file on disk, as one dropped or copied in Finder does, rather than for bytes alone. */
  hasPath: (file: File) => boolean;
  /**
   * Insert image: asks for images with the open dialog and adds each.
   * `anyType` asks for files of any type (Insert file). Nothing when the
   * dialog is canceled.
   */
  pickAndImport: (page: string, options?: { anyType?: boolean }) => Promise<FilesResult<PickedFiles>>;
  /** Whether a stored file's bytes are on this Mac, on the file store only, or gone. */
  status: (target: string) => Promise<FilesResult<FileStatus>>;
  /** Downloads a stored file's bytes, and answers its status after. */
  fetch: (target: string) => Promise<FilesResult<FileStatus>>;
  /**
   * Size, kind, where its bytes are, and page count, duration or pixel size
   * from its headers, so a preview knows its height before it loads. A file
   * that is gone answers status `missing`.
   */
  info: (target: string) => Promise<FilesResult<FileInfo>>;
  /**
   * A data: URL of the file's picture at most `px` on its long side, or null
   * for a type without one (HTML, SVG, text, archives). Queued a few at a
   * time; `visible` puts it ahead of the rest.
   */
  thumbnail: (target: string, px: number, options?: { visible?: boolean }) => Promise<FilesResult<string | null>>;
  /**
   * A JPEG copy of a HEIC or TIFF, or a copy at twice `width` of a picture
   * more than twice as wide, as a data: URL. Null when the file itself shows.
   */
  rendition: (target: string, width?: number, options?: { visible?: boolean }) => Promise<FilesResult<Rendition | null>>;
  /**
   * Opens the file in its app. Apps and scripts are shown in Finder instead.
   * A file outside the opened folders answers `confirm` with the app's name
   * until it is asked again with `confirmed`. An LFS file opens from a
   * read-only copy and says so in `notice`.
   */
  open: (target: string, options?: { confirmed?: boolean }) => Promise<FilesResult<OpenResult>>;
  /** The name of the app Open would use ("Keynote"), or null. */
  appName: (target: string) => Promise<FilesResult<string | null>>;
  /** Shows the file in the Quick Look panel, by the same rules as `open`. */
  quickLook: (target: string, options?: { confirmed?: boolean }) => Promise<FilesResult<OpenResult>>;
  /** Puts the file itself on the pasteboard, so Slack, Gmail and Finder attach it. */
  copyFile: (target: string) => Promise<FilesResult<void>>;
  /** Saves a copy where the person picks, named `name` when given. `saved` is null when they cancel. */
  saveCopy: (target: string, name?: string) => Promise<FilesResult<{ saved: string | null }>>;
  /** Drags the file itself out of the window. Call from dragstart after preventing its default. */
  startDrag: (target: string) => void;
  /** For a stored file that is gone, the file with the same hash elsewhere in the files folder, or null. */
  findMoved: (target: string) => Promise<FilesResult<string | null>>;
}

declare global {
  interface Window {
    filesAPI: FilesAPI;
  }
}
