import { create } from 'zustand';
import type { SavedView, SavedViewsListing, UnreadableView } from '@/types/savedView';

export interface SavedViewsState {
  views: Record<string, SavedView>;
  order: string[];
  unreadable: UnreadableView[];
  loaded: boolean;
  error: string | null;
}

export interface SavedViewsActions {
  load: () => Promise<void>;
  apply: (listing: SavedViewsListing) => void;
  has: (id: string) => boolean;
  /** Registers the main-process change listener once; later calls are no-ops. */
  subscribe: () => void;
  reset: () => void;
}

export type SavedViewsStore = SavedViewsState & SavedViewsActions;

let unsubscribe: (() => void) | null = null;

export const useSavedViewsStore = create<SavedViewsStore>((set, get) => ({
  views: {},
  order: [],
  unreadable: [],
  loaded: false,
  error: null,

  load: async () => {
    const api = typeof window !== 'undefined' ? window.viewsAPI : undefined;
    if (!api) { set({ loaded: true }); return; }
    let response: Awaited<ReturnType<typeof api.list>>;
    try {
      response = await api.list();
    } catch {
      response = { success: false, error: 'Could not load views.' };
    }
    if (!response.success) { set({ loaded: true, error: response.error }); return; }
    get().apply(response.data);
  },

  apply: (listing) =>
    set({
      views: Object.fromEntries(listing.views.map((view) => [view.id, view])),
      order: listing.views.map((view) => view.id),
      unreadable: listing.unreadable,
      loaded: true,
      error: null,
    }),

  has: (id) => id in get().views,

  subscribe: () => {
    if (unsubscribe) return;
    const api = typeof window !== 'undefined' ? window.viewsAPI : undefined;
    if (!api?.onChanged) return;
    unsubscribe = api.onChanged(() => { void get().load(); });
  },

  reset: () => {
    unsubscribe?.();
    unsubscribe = null;
    set({ views: {}, order: [], unreadable: [], loaded: false, error: null });
  },
}));
