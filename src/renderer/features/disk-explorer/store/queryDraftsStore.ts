import { create } from 'zustand';
import { emptyQuery, validateCollectionQuery } from '@/common/collectionQuery';
import type { CollectionQuery, CollectionScope } from '@/types/collectionQuery';

export interface QueryDraft {
  id: string;
  name: string;
  query: CollectionQuery;
  /** The folder this draft was created from, offered as a scope choice. */
  origin: string | null;
  createdAt: number;
}

export interface QueryDraftsState {
  /** Session-only; slice 3 layers these over durable view definitions. */
  drafts: Record<string, QueryDraft>;
  order: string[];
}

export interface QueryDraftsActions {
  create: (initial?: { scope?: CollectionScope; origin?: string | null; name?: string }) => string;
  update: (id: string, query: CollectionQuery) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  get: (id: string) => QueryDraft | null;
  has: (id: string) => boolean;
  reset: () => void;
}

export type QueryDraftsStore = QueryDraftsState & QueryDraftsActions;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `q${Date.now().toString(36)}${counter.toString(36)}`;
}

export const useQueryDraftsStore = create<QueryDraftsStore>((set, get) => ({
  drafts: {},
  order: [],

  create: (initial = {}) => {
    const id = nextId();
    const draft: QueryDraft = {
      id,
      name: initial.name ?? 'Untitled view',
      query: validateCollectionQuery(emptyQuery(initial.scope)),
      origin: initial.origin ?? null,
      createdAt: Date.now(),
    };
    set((state) => ({ drafts: { ...state.drafts, [id]: draft }, order: [...state.order, id] }));
    return id;
  },

  update: (id, query) =>
    set((state) => {
      const draft = state.drafts[id];
      if (!draft) return {};
      // Only validated values reach main; an invalid edit is rejected here.
      return { drafts: { ...state.drafts, [id]: { ...draft, query: validateCollectionQuery(query) } } };
    }),

  rename: (id, name) =>
    set((state) => {
      const draft = state.drafts[id];
      const trimmed = name.trim();
      if (!draft || !trimmed) return {};
      return { drafts: { ...state.drafts, [id]: { ...draft, name: trimmed.slice(0, 120) } } };
    }),

  remove: (id) =>
    set((state) => {
      if (!state.drafts[id]) return {};
      const drafts = { ...state.drafts };
      delete drafts[id];
      return { drafts, order: state.order.filter((candidate) => candidate !== id) };
    }),

  get: (id) => get().drafts[id] ?? null,
  has: (id) => id in get().drafts,
  reset: () => set({ drafts: {}, order: [] }),
}));
