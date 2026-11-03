import {
  fileLocation,
  type FilesLocation,
} from '@/renderer/features/disk-explorer/navigation/filesLocation';
import {
  selectOpenedPath,
  tabFile,
  useTabsStore,
} from '@/renderer/features/disk-explorer/store/tabsStore';

export function resetTabs(): void {
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastSessionDate: null });
}

/** Opens one tab per file or place, left to right, and activates the one at `active`. */
export function openTabs(places: readonly (string | FilesLocation)[], active = 0): void {
  resetTabs();
  for (const place of places) {
    useTabsStore
      .getState()
      .open(typeof place === 'string' ? fileLocation(place) : place, { newTab: true });
  }
  const tab = useTabsStore.getState().tabs.at(active);
  if (tab) useTabsStore.getState().activate(tab.id);
}

/** The file each tab shows, left to right; null for Recent. */
export function tabPaths(): (string | null)[] {
  return useTabsStore.getState().tabs.map(tabFile);
}

export function openedPath(): string | null {
  return selectOpenedPath(useTabsStore.getState());
}

export function tabId(index: number): string {
  const tab = useTabsStore.getState().tabs.at(index);
  if (!tab) throw new Error(`No tab at ${index}`);
  return tab.id;
}
