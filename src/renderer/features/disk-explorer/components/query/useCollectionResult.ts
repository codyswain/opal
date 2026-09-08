import { useEffect, useMemo, useRef } from 'react';
import { sameQuery } from '@/common/collectionQuery';
import type { CollectionQuery } from '@/types/collectionQuery';
import { EMPTY_RESULT, useCollectionQueryStore } from '../../store/collectionQueryStore';

/** Relative-time filters drift; re-evaluate at least once a minute while visible. */
export const TIME_REFRESH_MS = 60_000;

function hasRelativeTimeFilter(query: CollectionQuery): boolean {
  return query.filters.some((filter) => filter.op === 'within');
}

/**
 * Keeps a collection result in step with its query: loads on change (with the
 * store's edit debounce), reloads when main reports a change, and refreshes
 * rolling windows once a minute and on focus. `null` means no query yet.
 */
export function useCollectionResult(id: string, query: CollectionQuery | null, options: { initialLoaded?: boolean } = {}) {
  const result = useCollectionQueryStore((state) => state.results[id] ?? EMPTY_RESULT);
  const load = useCollectionQueryStore((state) => state.load);
  const lastLoaded = useRef<CollectionQuery | null>(options.initialLoaded ? query : null);
  const latest = useRef(query);
  latest.current = query;

  useEffect(() => {
    if (!query) return;
    if (lastLoaded.current && sameQuery(lastLoaded.current, query)) return;
    lastLoaded.current = query;
    void load(id, query);
  }, [query, id, load]);

  useEffect(() => {
    const api = window.collectionsAPI;
    if (!api?.onChanged || !query) return undefined;
    return api.onChanged(() => { if (latest.current) void load(id, latest.current, { immediate: true }); });
  }, [id, load, query]);

  const relativeTime = query ? hasRelativeTimeFilter(query) : false;
  useEffect(() => {
    if (!relativeTime) return undefined;
    const refresh = () => { if (latest.current) void load(id, latest.current, { immediate: true }); };
    const timer = setInterval(refresh, TIME_REFRESH_MS);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [relativeTime, id, load]);

  const byPath = useMemo(() => new Map(result.rows.map((row) => [row.entry.path, row])), [result.rows]);
  const entries = useMemo(() => result.rows.map((row) => row.entry), [result.rows]);
  const reload = () => { if (latest.current) void load(id, latest.current, { immediate: true }); };
  const loadMore = () => { if (latest.current) void load(id, latest.current, { append: true }); };
  return { result, byPath, entries, reload, loadMore };
}
