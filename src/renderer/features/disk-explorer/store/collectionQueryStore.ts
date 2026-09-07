import { create } from 'zustand';
import type { CollectionQuery, CollectionQueryResult, CollectionRow } from '@/types/collectionQuery';
import { COLLECTION_PAGE_DEFAULT } from '@/types/collectionQuery';

export interface QueryResultState {
  rows: CollectionRow[];
  total: number;
  incomplete: boolean;
  warnings: string[];
  indexState: CollectionQueryResult['indexState'];
  unavailableScopes: string[];
  loading: boolean;
  error: string | null;
  /** The query the rows answer; a newer draft is pending until it loads. */
  query: CollectionQuery | null;
}

export interface CollectionQueryState {
  results: Record<string, QueryResultState>;
}

export interface LoadOptions {
  /** Append the next page instead of replacing rows. */
  append?: boolean;
  /** Skip the edit debounce (initial load, change events, retries). */
  immediate?: boolean;
}

export interface CollectionQueryActions {
  load: (id: string, query: CollectionQuery, options?: LoadOptions) => Promise<void>;
  reset: (id?: string) => void;
}

export type CollectionQueryStore = CollectionQueryState & CollectionQueryActions;

export const EMPTY_RESULT: QueryResultState = {
  rows: [], total: 0, incomplete: false, warnings: [], indexState: 'ready',
  unavailableScopes: [], loading: false, error: null, query: null,
};

export const QUERY_EDIT_DEBOUNCE_MS = 150;

type Response = Awaited<ReturnType<Window['collectionsAPI']['query']>>;

// Per-draft request tokens and debounce timers live outside React state.
const tokens = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function nextToken(id: string): number {
  const token = (tokens.get(id) ?? 0) + 1;
  tokens.set(id, token);
  return token;
}

export const useCollectionQueryStore = create<CollectionQueryStore>((set, get) => ({
  results: {},

  load: (id, query, options = {}) => {
    const existing = timers.get(id);
    if (existing) { clearTimeout(existing); timers.delete(id); }
    const token = nextToken(id);
    const current = get().results[id] ?? EMPTY_RESULT;
    const offset = options.append ? current.rows.length : 0;
    set((state) => ({ results: { ...state.results, [id]: { ...current, loading: true } } }));

    const run = async () => {
      timers.delete(id);
      if (token !== tokens.get(id)) return;
      let response: Response;
      try {
        response = await window.collectionsAPI.query(query, { offset, limit: COLLECTION_PAGE_DEFAULT });
      } catch {
        response = { success: false, error: 'Could not load the collection.' };
      }
      if (token !== tokens.get(id)) return;
      const previous = get().results[id] ?? EMPTY_RESULT;
      if (!response.success) {
        set((state) => ({ results: { ...state.results, [id]: { ...previous, loading: false, error: response.error } } }));
        return;
      }
      const data = response.data;
      const rows = options.append && previous.query && sameQuery(previous.query, query)
        ? [...previous.rows, ...data.rows]
        : data.rows;
      set((state) => ({
        results: {
          ...state.results,
          [id]: {
            rows, total: data.total, incomplete: data.incomplete, warnings: data.warnings,
            indexState: data.indexState, unavailableScopes: data.unavailableScopes,
            loading: false, error: null, query,
          },
        },
      }));
    };

    if (options.immediate || options.append) return run();
    return new Promise<void>((resolve) => {
      timers.set(id, setTimeout(() => { void run().then(resolve); }, QUERY_EDIT_DEBOUNCE_MS));
    });
  },

  reset: (id) => {
    if (id === undefined) {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const key of [...tokens.keys()]) nextToken(key);
      set({ results: {} });
      return;
    }
    const timer = timers.get(id);
    if (timer) { clearTimeout(timer); timers.delete(id); }
    nextToken(id);
    set((state) => {
      const results = { ...state.results };
      delete results[id];
      return { results };
    });
  },
}));

function sameQuery(a: CollectionQuery, b: CollectionQuery): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
