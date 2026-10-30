import * as React from 'react';
import { toast } from 'sonner';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import {
  FILES_ROUTE_PATH,
  filesLocationKey,
  focusFile,
} from '@/renderer/features/disk-explorer/navigation';
import {
  canonical,
  tabLocation,
  useTabsStore,
} from '@/renderer/features/disk-explorer/store/tabsStore';
import { useShell } from '../context/ShellContext';

/**
 * Opens the file an opal:// link names in a new tab, or switches to the tab
 * that already shows it. Listens only once the app is on the files route, so
 * the start page's Today never opens over a linked file.
 */
export function PageLinks(): null {
  const { location, navigateFiles } = useShell();
  const navigate = React.useRef(navigateFiles);
  navigate.current = navigateFiles;
  const started = location.pathname === FILES_ROUTE_PATH;

  React.useEffect(() => {
    if (!started) return;
    return window.systemAPI.onOpenPage((request) => {
      if ('error' in request) {
        toast.error(request.error);
        return;
      }
      recordOpened(request.path);
      const intent = focusFile(request.path);
      const key = filesLocationKey(canonical(intent.location));
      const tabs = useTabsStore.getState();
      const shown = tabs.tabs.find((tab) => filesLocationKey(tabLocation(tab)) === key);
      if (shown) tabs.activate(shown.id);
      else navigate.current(intent, { newTab: true });
    });
  }, [started]);

  return null;
}
