export interface MarkdownDocument {
  path: string;
  /** Everything after the frontmatter block, decoded as UTF-8 with LF newlines. */
  body: string;
  /** SHA-256 of the whole file; writes must present the revision they were based on. */
  revision: string;
  size: number;
  hasFrontmatter: boolean;
}

export interface MarkdownWriteResult {
  revision: string;
}

export const MARKDOWN_DOCUMENT_LIMIT = 16 * 1024 * 1024;
