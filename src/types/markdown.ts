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

export interface MarkdownWriteResult {
  revision: string;
}

/** Wiki link targets and the files they resolve to, or null when nothing matches. */
export type MarkdownLinks = Record<string, string | null>;

export const MARKDOWN_DOCUMENT_LIMIT = 16 * 1024 * 1024;
export const LINK_TARGET_LIMIT = 500;
