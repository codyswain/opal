import { useEffect } from 'react';
import { parentFsPath } from '@/common/fsPaths';
import { useDiskStore } from '../store/diskStore';
import { usePinsStore } from '../store/pinsStore';

/**
 * Reads the pins of the opened folders, and again whenever they could have
 * changed. Mounted once by the shell, so the palette and tab menus know the
 * pins while the sidebar is hidden.
 */
export function usePinsSync(): void {
  useEffect(() => {
    const load = () => {
      void usePinsStore.getState().load();
    };
    load();
    // Pins from another Mac arrive by git pull, which the disk watcher does
    // not report because it skips the hidden .opal folder. Reading them again
    // when the window gains focus covers it: a pull happens in the terminal
    // or on another Mac, and then Cody comes back to Opal.
    window.addEventListener('focus', load);
    const stopRoots = useDiskStore.subscribe((state, previous) => {
      if (state.roots !== previous.roots) load();
    });
    // A pinned file that arrives, moves or goes away outside Opal changes its folder.
    const stopChanges = window.diskAPI.onChanged(({ directories }) => {
      const folders = Object.values(usePinsStore.getState().byRoot).flat().map(parentFsPath);
      if (directories.some((directory) => folders.includes(directory))) load();
    });
    return () => {
      window.removeEventListener('focus', load);
      stopRoots();
      stopChanges();
    };
  }, []);
}
