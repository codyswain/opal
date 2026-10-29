import type { MarkdownCopyLabel, MarkdownDocument, MarkdownLinks, MarkdownWriteResult, UnsavedPage } from '@/types/markdown';

export type MarkdownResult<T> =
  | { success: true; data: T; error?: undefined; conflict?: undefined }
  | { success: false; error: string; data?: undefined; conflict?: true };

export interface MarkdownAPI {
  read: (target: string) => Promise<MarkdownResult<MarkdownDocument>>;
  write: (target: string, body: string, expectedRevision: string) => Promise<MarkdownResult<MarkdownWriteResult>>;
  create: (parentDir: string, baseName?: string) => Promise<MarkdownResult<{ path: string }>>;
  /** Writes a page's text to a new copy next to the note, or in the recovery folder when that fails. */
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
