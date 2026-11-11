import { useEffect } from 'react';
import { useDiskStore } from '../store/diskStore';
import { useHiddenStore } from '../store/hiddenStore';
import { usePinsStore } from '../store/pinsStore';
import { tabFile, useTabsStore } from '../store/tabsStore';

const tabFiles = () =>
  useTabsStore.getState().tabs.map(tabFile).filter((path): path is string => path !== null);

/**
 * Keeps the renderer in step with hidden files. When what is hidden or
 * whether it shows changes, every folder the tree has read is read again,
 * the pins are read again and the tabs are checked, so a hidden file leaves
 * every view at once. The main process also reports the folders that
 * changed, which Recent, stacks and open pages follow as for any change on
 * disk. Mounted once by the shell.
 */
export function useHiddenSync(): void {
  useEffect(() => {
    if (!window.hiddenAPI) return;
    void useHiddenStore.getState().refresh(tabFiles());
    const stopTabs = useTabsStore.subscribe((state, previous) => {
      if (state.tabs !== previous.tabs) void useHiddenStore.getState().check(tabFiles());
    });
    const stopHidden = window.hiddenAPI.onChanged(() => {
      void useHiddenStore.getState().refresh(tabFiles());
      void useDiskStore.getState().invalidate(Object.keys(useDiskStore.getState().listings));
      void usePinsStore.getState().load();
    });
    return () => {
      stopTabs();
      stopHidden();
    };
  }, []);
}
