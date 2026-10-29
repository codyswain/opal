import { useEffect } from 'react';
import { useDiskStore } from '../store/diskStore';

/**
 * Loads the opened folders and keeps their cached listings live. Mounted once
 * by the shell, so the sidebar tree stays current on every route.
 */
export function useDiskSync(): void {
  useEffect(() => {
    const store = useDiskStore.getState();
    void store.loadRoots().then(() => useDiskStore.getState().loadTree());
    return window.diskAPI.onChanged(({ directories }) => {
      void useDiskStore.getState().invalidate(directories);
    });
  }, []);
}
