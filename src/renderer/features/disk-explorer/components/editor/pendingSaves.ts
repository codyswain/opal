/**
 * The saves a window must finish before it closes or the app quits: a flush
 * for each open page, and the writes of pages closed a moment ago.
 */
const pageFlushes = new Set<() => Promise<void>>();
const writes = new Set<Promise<void>>();

export async function flushPendingSaves(): Promise<void> {
  await Promise.allSettled([...pageFlushes].map((flush) => flush()));
  await Promise.allSettled([...writes]);
}

export function registerPageFlush(flush: () => Promise<void>): () => void {
  pageFlushes.add(flush);
  return () => { pageFlushes.delete(flush); };
}

export function trackPendingWrite(write: Promise<void>): void {
  const settled = write.catch(() => undefined);
  writes.add(settled);
  void settled.then(() => writes.delete(settled));
}
