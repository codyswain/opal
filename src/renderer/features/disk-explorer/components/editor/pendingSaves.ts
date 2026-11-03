import type { UnsavedPage } from '@/types/markdown';

/**
 * The saves a window must finish before it closes or the app quits: a flush
 * for each open page, and the writes of pages closed a moment ago. The
 * renderer entry hands `flushPendingSaves` to `markdownAPI.setFlushHandler`,
 * and the main process holds the close until it settles. Each one reports
 * its page when the text did not reach the file.
 */
const pageFlushes = new Set<() => Promise<UnsavedPage | null>>();
const writes = new Set<Promise<UnsavedPage | null>>();

export async function flushPendingSaves(): Promise<UnsavedPage[]> {
  const results = await Promise.all([...[...pageFlushes].map((flush) => flush()), ...writes]);
  return results.filter((page): page is UnsavedPage => page !== null);
}

export function registerPageFlush(flush: () => Promise<UnsavedPage | null>): () => void {
  pageFlushes.add(flush);
  return () => { pageFlushes.delete(flush); };
}

export function trackPendingWrite(write: Promise<UnsavedPage | null>): void {
  writes.add(write);
  void write.then(() => writes.delete(write));
}
