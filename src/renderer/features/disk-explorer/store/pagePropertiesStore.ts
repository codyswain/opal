import { create } from 'zustand';

interface PagePropertiesState {
  /** Whether pages show their properties block. It stays on from page to page and is never saved, so Opal starts with it closed. */
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const usePagePropertiesStore = create<PagePropertiesState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** The footer line, View > Show Properties and Cmd+Shift+I all do this. */
export function togglePageProperties(): void {
  const { open, setOpen } = usePagePropertiesStore.getState();
  setOpen(!open);
}
