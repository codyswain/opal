import { useEffect, useState } from 'react';
import type { TagCount } from '@/types/collectionQuery';

/** The library's tags for chip suggestions; refreshed when the index changes. */
export function useTagSuggestions(): TagCount[] {
  const [tags, setTags] = useState<TagCount[]>([]);
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.collectionsAPI : undefined;
    if (!api?.tags) return undefined;
    let alive = true;
    const load = () => {
      void Promise.resolve(api.tags()).then((response) => {
        if (alive && response.success) setTags(response.data);
      }).catch(() => undefined);
    };
    load();
    const unsubscribe = api.onChanged?.(load);
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);
  return tags;
}
