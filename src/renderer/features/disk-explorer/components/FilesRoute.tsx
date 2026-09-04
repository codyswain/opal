import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  FILES_ROUTE_PATH,
  resolveFilesLocation,
  serializeFilesLocation,
} from '../navigation/filesLocation';
import { useDiskStore } from '../store/diskStore';
import { useTabsStore } from '../store/tabsStore';
import { DiskExplorer } from './DiskExplorer';

/**
 * Keeps route bootstrap and URL-driven directory state alive independently of
 * the optional workspace sidebar. Task 7 extends this boundary with complete
 * selection/scroll snapshot restoration and removes the remaining adapters.
 */
export function FilesRoute() {
  const roots = useDiskStore((state) => state.roots);
  const currentDirectory = useDiskStore((state) => state.currentDirectory);
  const loadRoots = useDiskStore((state) => state.loadRoots);
  const navigateToDirectory = useDiskStore(
    (state) => state.navigateToDirectory
  );
  const location = useLocation();
  const navigate = useNavigate();

  React.useEffect(() => {
    void loadRoots();
  }, [loadRoots]);

  const resolved = React.useMemo(
    () => resolveFilesLocation(location.search, roots),
    [location.search, roots]
  );

  React.useEffect(() => {
    if (!resolved) return;

    const next = resolved.location;
    if (resolved.history === 'replace') {
      navigate(
        {
          pathname: FILES_ROUTE_PATH,
          search: serializeFilesLocation(next),
        },
        { replace: true }
      );
    }

    if (currentDirectory !== next.directory) {
      navigateToDirectory(next.directory);
    }

    const tabs = useTabsStore.getState();
    if (next.mode === 'focus') {
      if (tabs.openedPath !== next.file) tabs.openFile(next.file);
    } else if (tabs.openedPath || tabs.activePath) {
      useTabsStore.setState({ openedPath: null, activePath: null });
    }
  }, [currentDirectory, navigate, navigateToDirectory, resolved]);

  return <DiskExplorer showNavigationPane={false} />;
}
