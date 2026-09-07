import { create } from 'zustand';

interface PaletteState {
  open: boolean;
  /** Text the palette opens with; `>` restricts results to commands. */
  initialQuery: string;
  show: (initialQuery?: string) => void;
  hide: () => void;
  toggle: () => void;
}

/** Whether the command palette is showing; opened by Cmd+K, Cmd+P and the menu. */
export const usePaletteStore = create<PaletteState>((set, get) => ({
  open: false,
  initialQuery: '',
  show: (initialQuery = '') => set({ open: true, initialQuery }),
  hide: () => set({ open: false }),
  toggle: () => (get().open ? set({ open: false }) : set({ open: true, initialQuery: '' })),
}));
