import { create } from 'zustand';

interface SettingsState {
  open: boolean;
  show: () => void;
  setOpen: (open: boolean) => void;
}

/** Whether the Settings dialog is showing; opened by Cmd+, and the sidebar gear. */
export const useSettingsStore = create<SettingsState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  setOpen: (open) => set({ open }),
}));
