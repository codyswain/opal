import type { MarkdownCopyLabel, MarkdownDocument, MarkdownLinks, MarkdownProperties, MarkdownWriteResult, PageExtension, UnsavedPage } from '@/types/markdown';

/** `hidden` marks a refused hidden file; `hiddenTargets` the link targets that point at one. */
export type MarkdownResult<T> =
  | { success: true; data: T; error?: undefined; conflict?: undefined; gitBusy?: undefined; hidden?: undefined; hiddenTargets?: string[] }
  | { success: false; error: string; data?: undefined; conflict?: true; gitBusy?: true; hidden?: true; hiddenTargets?: undefined };

export interface MarkdownAPI {
  read: (target: string) => Promise<MarkdownResult<MarkdownDocument>>;
  /** The page's frontmatter as text and its file's path, times and size. */
  properties: (target: string) => Promise<MarkdownResult<MarkdownProperties>>;
  write: (target: string, body: string, expectedRevision: string) => Promise<MarkdownResult<MarkdownWriteResult>>;
  /** Creates "<baseName>.<extension>", a note (`md`) unless asked for a document (`mdo`). */
  create: (parentDir: string, baseName?: string, extension?: PageExtension) => Promise<MarkdownResult<{ path: string }>>;
  /** Writes a page's text to a new copy next to the page, with its extension, or in the recovery folder when that fails. */
  saveCopy: (target: string, body: string, label: MarkdownCopyLabel) => Promise<MarkdownResult<{ path: string }>>;
  /** Resolves wiki link targets written in `from` to files under the opened roots. */
  resolveLinks: (from: string, targets: string[]) => Promise<MarkdownResult<MarkdownLinks>>;
  /** What runs before this window closes or the app quits; the close waits for it and asks before dropping unsaved pages. */
  setFlushHandler: (flush: () => Promise<UnsavedPage[]>) => void;
}

declare global {
  interface Window {
    markdownAPI: MarkdownAPI;
  }
}
