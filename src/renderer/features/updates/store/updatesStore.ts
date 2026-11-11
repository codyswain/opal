import { useEffect } from 'react';
import { create } from 'zustand';
import { toast } from 'sonner';
import type { UpdateState } from '@/types/updates';

/**
 * What the renderer knows about updates. The main process finds builds,
 * installs them and says what changed; this holds its last word and turns
 * the three actions into one-line toasts when they fail.
 */
export interface UpdatesStore {
  state: UpdateState | null;
  /** Set while the renderer waits for an install or a roll back to start. */
  pending: boolean;
  set: (state: UpdateState) => void;
  /** Check for Updates: unlike the automatic checks, it says what it found. */
  check: () => Promise<void>;
  install: () => Promise<void>;
  rollBack: () => Promise<void>;
}

const api = () => (typeof window !== 'undefined' ? window.updatesAPI : undefined);

export const useUpdatesStore = create<UpdatesStore>((set, get) => {
  const act = async (call: 'install' | 'rollBack') => {
    const updates = api();
    if (!updates || get().pending || get().state?.busy) return;
    set({ pending: true });
    const result = await updates[call]().catch(() => ({ success: false as const, error: 'The update failed.' }));
    set({ pending: false });
    if (!result.success) toast.error(result.error);
  };
  return {
    state: null,
    pending: false,
    set: (state) => set({ state }),
    check: async () => {
      const updates = api();
      if (!updates) return;
      const result = await updates.check().catch(() => null);
      if (!result?.success) {
        toast.error('Could not check for updates.');
        return;
      }
      set({ state: result.data });
      if (result.data.available) toast(`Update ready: ${result.data.available.notes || result.data.available.commit}`);
      else toast('Opal is up to date.');
    },
    install: () => act('install'),
    rollBack: () => act('rollBack'),
  };
});

/** "Updating…" from the click until Opal closes. */
export const selectUpdating = (store: Pick<UpdatesStore, 'state' | 'pending'>): boolean =>
  store.pending || store.state?.busy != null;

/** Follows the main process's update state. Mounted once, by AppCommands. */
export function useUpdatesSync(): void {
  useEffect(() => {
    const updates = api();
    if (!updates) return;
    void updates.state().then((result) => {
      if (result.success) useUpdatesStore.getState().set(result.data);
    }).catch(() => undefined);
    return updates.onChanged((state) => useUpdatesStore.getState().set(state));
  }, []);
}
