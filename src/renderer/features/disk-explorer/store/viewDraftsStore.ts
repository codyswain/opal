import { create } from 'zustand';
import { CollectionQueryError, emptyQuery, sameQuery, validateCollectionQuery } from '@/common/collectionQuery';
import type { CollectionQuery, CollectionScope } from '@/types/collectionQuery';
import type { SavedView, ViewLayout } from '@/types/savedView';

export interface ViewBaseline {
  name: string;
  query: CollectionQuery;
  layout: ViewLayout;
  revision: string;
}

/**
 * The working copy of a collection definition. A transient draft has no
 * baseline; a saved view's draft carries the definition it was opened from so
 * edits can be saved against that revision, reset, or saved as a new view.
 */
export interface ViewDraft {
  id: string;
  name: string;
  query: CollectionQuery;
  layout: ViewLayout;
  /** The folder this draft was created from, offered as a scope choice. */
  origin: string | null;
  saved: ViewBaseline | null;
  createdAt: number;
}

export interface ViewDraftsState {
  /** Session-only; never persisted. */
  drafts: Record<string, ViewDraft>;
  /** Transient (unsaved) draft ids in creation order. */
  order: string[];
}

export interface ViewDraftPatch {
  name?: string;
  query?: CollectionQuery;
  layout?: ViewLayout;
}

export interface ViewDraftsActions {
  create: (initial?: { scope?: CollectionScope; origin?: string | null; name?: string }) => string;
  /** Ensures a draft for a saved view; keeps existing edits and their baseline. */
  openSaved: (view: SavedView) => void;
  update: (id: string, patch: ViewDraftPatch) => void;
  /** After a successful save: definition and baseline both become the saved view. */
  markSaved: (id: string, view: SavedView) => void;
  /** Reload from disk: discard edits and adopt the file as both draft and baseline. */
  adoptBaseline: (id: string, view: SavedView) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
  get: (id: string) => ViewDraft | null;
  has: (id: string) => boolean;
  clearAll: () => void;
}

export type ViewDraftsStore = ViewDraftsState & ViewDraftsActions;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `q${Date.now().toString(36)}${counter.toString(36)}`;
}

export function isDraftEdited(draft: ViewDraft): boolean {
  if (!draft.saved) return false;
  return (
    draft.name !== draft.saved.name ||
    draft.layout !== draft.saved.layout ||
    !sameQuery(draft.query, draft.saved.query)
  );
}

function baselineOf(view: SavedView): ViewBaseline {
  return { name: view.name, query: view.query, layout: view.layout, revision: view.revision };
}

export const useViewDraftsStore = create<ViewDraftsStore>((set, get) => ({
  drafts: {},
  order: [],

  create: (initial = {}) => {
    const id = nextId();
    const draft: ViewDraft = {
      id,
      name: initial.name ?? 'Untitled view',
      query: validateCollectionQuery(emptyQuery(initial.scope)),
      layout: 'list',
      origin: initial.origin ?? null,
      saved: null,
      createdAt: Date.now(),
    };
    set((state) => ({ drafts: { ...state.drafts, [id]: draft }, order: [...state.order, id] }));
    return id;
  },

  openSaved: (view) =>
    set((state) => {
      if (state.drafts[view.id]) return {};
      const draft: ViewDraft = {
        id: view.id,
        name: view.name,
        query: view.query,
        layout: view.layout,
        origin: null,
        saved: baselineOf(view),
        createdAt: Date.now(),
      };
      return { drafts: { ...state.drafts, [view.id]: draft } };
    }),

  update: (id, patch) =>
    set((state) => {
      const draft = state.drafts[id];
      if (!draft) return {};
      // Only validated values reach main; an invalid edit is refused here
      // without throwing, because callers run inside React effects.
      let query = draft.query;
      if (patch.query) {
        try {
          query = validateCollectionQuery(patch.query);
        } catch (error) {
          if (error instanceof CollectionQueryError) return {};
          throw error;
        }
      }
      const name = patch.name !== undefined ? patch.name.trim().slice(0, 120) || draft.name : draft.name;
      const layout = patch.layout ?? draft.layout;
      return { drafts: { ...state.drafts, [id]: { ...draft, name, query, layout } } };
    }),

  markSaved: (id, view) =>
    set((state) => {
      const draft = state.drafts[id];
      if (!draft) return {};
      return {
        drafts: { ...state.drafts, [id]: { ...draft, name: view.name, query: view.query, layout: view.layout, saved: baselineOf(view) } },
      };
    }),

  adoptBaseline: (id, view) =>
    set((state) => {
      const draft = state.drafts[id];
      if (!draft) return {};
      return {
        drafts: { ...state.drafts, [id]: { ...draft, name: view.name, query: view.query, layout: view.layout, saved: baselineOf(view) } },
      };
    }),

  reset: (id) =>
    set((state) => {
      const draft = state.drafts[id];
      if (!draft?.saved) return {};
      return {
        drafts: { ...state.drafts, [id]: { ...draft, name: draft.saved.name, query: draft.saved.query, layout: draft.saved.layout } },
      };
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
  clearAll: () => set({ drafts: {}, order: [] }),
}));
