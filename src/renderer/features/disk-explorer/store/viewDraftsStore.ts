import { create } from 'zustand';
import { CollectionQueryError, emptyQuery, sameQuery, validateCollectionQuery } from '@/common/collectionQuery';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
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
  /**
   * Unsaved drafts and unsaved edits to saved views survive a relaunch
   * through the prefs store; a draft that matches its saved view does not
   * need to.
   */
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

export const VIEW_DRAFTS_PREF = 'viewDrafts';
/** Unsaved drafts kept across launches; the oldest fall off first. */
export const MAX_PERSISTED_DRAFTS = 20;

const LAYOUTS: readonly ViewLayout[] = ['list', 'gallery'];

/** Accepts only a draft whose every field still validates; anything else is dropped silently. */
function reviveDraft(candidate: unknown): ViewDraft | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const raw = candidate as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || !LAYOUTS.includes(raw.layout as ViewLayout)) return null;
  if (raw.origin !== null && typeof raw.origin !== 'string') return null;
  try {
    const query = validateCollectionQuery(raw.query);
    let saved: ViewBaseline | null = null;
    if (raw.saved !== null && raw.saved !== undefined) {
      const base = raw.saved as Record<string, unknown>;
      if (typeof base.name !== 'string' || typeof base.revision !== 'string' || !LAYOUTS.includes(base.layout as ViewLayout)) return null;
      saved = { name: base.name, layout: base.layout as ViewLayout, revision: base.revision, query: validateCollectionQuery(base.query) };
    }
    return {
      id: raw.id,
      name: raw.name.trim().slice(0, 120) || 'Untitled view',
      query,
      layout: raw.layout as ViewLayout,
      origin: (raw.origin as string | null) ?? null,
      saved,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    };
  } catch (error) {
    if (error instanceof CollectionQueryError) return null;
    throw error;
  }
}

export function readPersistedDrafts(): ViewDraftsState {
  const stored = readPref<{ drafts?: unknown; order?: unknown } | null>(VIEW_DRAFTS_PREF, null);
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.order) || typeof stored.drafts !== 'object' || stored.drafts === null) {
    return { drafts: {}, order: [] };
  }
  const drafts: Record<string, ViewDraft> = {};
  for (const [id, candidate] of Object.entries(stored.drafts as Record<string, unknown>)) {
    const draft = reviveDraft(candidate);
    if (draft && draft.id === id) drafts[id] = draft;
  }
  const order = (stored.order as unknown[]).filter((id): id is string => typeof id === 'string' && !!drafts[id] && drafts[id].saved === null);
  // Edited saved views are worth keeping; a transient draft must be listed to be reachable.
  for (const id of Object.keys(drafts)) {
    if (drafts[id].saved === null ? !order.includes(id) : !isDraftEdited(drafts[id])) delete drafts[id];
  }
  return { drafts, order };
}

/** Writes what is worth restoring: listed transient drafts (newest MAX_PERSISTED_DRAFTS) and edited saved views. */
export function persistDrafts(state: ViewDraftsState): void {
  const order = state.order.filter((id) => state.drafts[id]?.saved === null).slice(-MAX_PERSISTED_DRAFTS);
  const drafts: Record<string, ViewDraft> = {};
  for (const id of order) drafts[id] = state.drafts[id];
  for (const draft of Object.values(state.drafts)) {
    if (draft.saved && isDraftEdited(draft)) drafts[draft.id] = draft;
  }
  writePref(VIEW_DRAFTS_PREF, { drafts, order });
}

export const useViewDraftsStore = create<ViewDraftsStore>((set, get) => ({
  ...readPersistedDrafts(),

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

useViewDraftsStore.subscribe((state, previous) => {
  if (state.drafts !== previous.drafts || state.order !== previous.order) persistDrafts(state);
});
