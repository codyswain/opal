import { create } from 'zustand';

interface PaletteState {
  open: boolean;
  /** Text the palette opens with; `>` restricts results to commands. */
  initialQuery: string;
  /** Set by New Tab (Cmd+T and the + button): the pick opens in a new tab. */
  newTab: boolean;
  show: (initialQuery?: string, options?: { newTab?: boolean }) => void;
  hide: () => void;
  toggle: () => void;
}

/** Whether the command palette is showing; opened by Cmd+K, Cmd+P, Cmd+T and the menu. */
export const usePaletteStore = create<PaletteState>((set, get) => ({
  open: false,
  initialQuery: '',
  newTab: false,
  show: (initialQuery = '', options = {}) =>
    set({ open: true, initialQuery, newTab: options.newTab ?? false }),
  hide: () => set({ open: false }),
  toggle: () =>
    get().open
      ? set({ open: false })
      : set({ open: true, initialQuery: '', newTab: false }),
}));
