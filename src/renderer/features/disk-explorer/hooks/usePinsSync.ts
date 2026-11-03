import { useEffect } from 'react';
import { parentFsPath } from '@/common/fsPaths';
import { useDiskStore } from '../store/diskStore';
import { usePinsStore } from '../store/pinsStore';

const pinned = () => Object.values(usePinsStore.getState().byRoot).flat();

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
    // A pinned file that arrives, moves or goes away outside Opal changes its
    // folder. A folder the tree has listed is read again by useDiskSync, and
    // the listing below shows whether the file came or went, so saving a
    // pinned page does not read the pins again. Any other folder is not
    // listed here, so its pins are read again.
    const stopChanges = window.diskAPI.onChanged(({ directories }) => {
      const { listings } = useDiskStore.getState();
      const folders = pinned().map(parentFsPath);
      if (directories.some((directory) => folders.includes(directory) && !listings[directory])) load();
    });
    const stopDisk = useDiskStore.subscribe((state, previous) => {
      if (state.roots !== previous.roots) {
        load();
        return;
      }
      if (state.listings === previous.listings) return;
      const { missing } = usePinsStore.getState();
      const changed = pinned().some((pin) => {
        const folder = parentFsPath(pin);
        const listing = folder ? state.listings[folder] : undefined;
        if (!folder || !listing || listing === previous.listings[folder]) return false;
        const present = listing.some((entry) => entry.path === pin && !entry.isDirectory);
        return present === missing.includes(pin);
      });
      if (changed) load();
    });
    return () => {
      window.removeEventListener('focus', load);
      stopChanges();
      stopDisk();
    };
  }, []);
}
