import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  FILES_ROUTE_PATH,
  parseFilesLocation,
  serializeFilesLocation,
} from '../navigation/filesLocation';
import { useDiskStore } from '../store/diskStore';
import { selectCurrentLocation, useTabsStore } from '../store/tabsStore';
import { DiskExplorer } from './DiskExplorer';
import { NoFolderOpen } from './NoFolderOpen';
import { NoPageOpen } from './NoPageOpen';

/**
 * The active tab is the navigation model. This route mirrors it into the URL
 * (always replacing, so tabs own Back and Forward) and opens a URL it did not
 * write in the active tab.
 */
export function FilesRoute() {
  const roots = useDiskStore((state) => state.roots);
  const rootsLoaded = useDiskStore((state) => state.rootsLoaded);
  const current = useTabsStore(selectCurrentLocation);
  const location = useLocation();
  const navigate = useNavigate();
  const search = React.useRef(location.search);
  search.current = location.search;
  /** The last search this route wrote; any other one came from outside. */
  const written = React.useRef<string | null>(null);
  /** A search from outside that waits for the roots before it can be checked. */
  const pending = React.useRef(false);
  const currentKey = current ? serializeFilesLocation(current) : null;

  const syncUrl = React.useCallback(() => {
    if (pending.current) return;
    const shown = selectCurrentLocation(useTabsStore.getState());
    const next = shown ? serializeFilesLocation(shown) : '';
    written.current = next;
    if (search.current !== next)
      navigate({ pathname: FILES_ROUTE_PATH, search: next }, { replace: true });
  }, [navigate]);

  // A link, a reload or a test can set the URL; it shows in the active tab.
  React.useEffect(() => {
    if (location.search === written.current) return;
    pending.current = location.search !== '' && roots.length === 0;
    if (pending.current) return;
    const target = parseFilesLocation(location.search, roots);
    if (target) useTabsStore.getState().open(target);
    syncUrl();
  }, [location.search, roots, syncUrl]);

  React.useEffect(() => syncUrl(), [currentKey, syncUrl]);

  if (rootsLoaded && roots.length === 0) return <NoFolderOpen />;
  if (current) return <DiskExplorer />;
  // Until the opened folders are known, show nothing rather than claim there are none.
  return roots.length > 0 ? <NoPageOpen /> : null;
}
