export interface MarkdownDocument {
  path: string;
  /** Everything after the frontmatter block, decoded as UTF-8 with LF newlines. */
  body: string;
  /** SHA-256 of the whole file; writes must present the revision they were based on. */
  revision: string;
  size: number;
  /** How many keys the frontmatter holds. The page hides the block and shows this count. */
  properties: number;
}

/** One frontmatter key and its value as text: one entry for a single value, one per item for a list, none when empty. */
export interface PageProperty {
  key: string;
  values: string[];
}

/** What a page's properties block shows: its frontmatter, then facts about its file. */
export interface MarkdownProperties {
  path: string;
  /** The path below the opened folder that holds the file, such as "Library/daily/2026-10-28.md". */
  relativePath: string;
  properties: PageProperty[];
  /** When the file was created, or null where the file system does not record it. */
  createdMs: number | null;
  modifiedMs: number;
  /** Bytes on disk, frontmatter included. */
  size: number;
}

export interface MarkdownWriteResult {
  revision: string;
}

/** Wiki link targets and the files they resolve to, or null when nothing matches. */
export type MarkdownLinks = Record<string, string | null>;

export const MARKDOWN_DOCUMENT_LIMIT = 16 * 1024 * 1024;
export const LINK_TARGET_LIMIT = 500;

/** What a copy of a page's text is called: "<name> (conflicted copy).md" or "<name> (unsaved copy).md". */
export type MarkdownCopyLabel = 'conflicted copy' | 'unsaved copy';

/** A page whose text did not reach its file when it closed or the app quit, and the copy that holds it, if any. */
export interface UnsavedPage {
  name: string;
  copy: string | null;
}
