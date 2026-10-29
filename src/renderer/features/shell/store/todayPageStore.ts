import { create } from 'zustand';

/**
 * The page Today last opened, as the main process named it, and for which
 * date. Only the main process knows the vault layout, so the sidebar marks
 * Today active by this path.
 */
export const useTodayPage = create<{ date: string | null; path: string | null }>(() => ({
  date: null,
  path: null,
}));
