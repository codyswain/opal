import { create } from 'zustand';
import type { RecentResult } from '@/types/activity';

export interface RecentState {
  result: RecentResult | null;
  loading: boolean;
  error: string | null;
}

export interface RecentActions {
  load: () => Promise<void>;
  clear: () => Promise<void>;
  reset: () => void;
}

export type RecentStore = RecentState & RecentActions;

type RecentResponse = Awaited<ReturnType<Window['activityAPI']['recent']>>;

// Requests are numbered so a slow earlier response never replaces a newer one.
let request = 0;

export const useRecentStore = create<RecentStore>((set, get) => ({
  result: null,
  loading: false,
  error: null,

  load: async () => {
    const token = ++request;
    set({ loading: true });
    let response: RecentResponse;
    try {
      response = await window.activityAPI.recent({});
    } catch {
      response = { success: false, error: 'Could not load recent activity.' };
    }
    if (token !== request) return;
    if (!response.success) {
      set({ loading: false, error: response.error });
      return;
    }
    set({ loading: false, error: null, result: response.data });
  },

  clear: async () => {
    const response = await window.activityAPI.clear();
    if (!response.success) {
      set({ error: response.error });
      return;
    }
    await get().load();
  },

  reset: () => {
    request++;
    set({ result: null, loading: false, error: null });
  },
}));
