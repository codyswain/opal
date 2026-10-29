import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isFsPathAtOrBelow, parentFsPath } from '@/common/fsPaths';
import {
  FILES_ROUTE_PATH,
  collectionDirectory,
  directoryCollection,
  fileLocation,
  parseFilesLocation,
  sameCollection,
  serializeFilesLocation,
  type FilesLocation,
} from '../navigation/filesLocation';
import {
  FilesNavigationContext,
  type FilesNavigationActions,
} from '../navigation/FilesNavigationContext';
import { filesLocationSnapshots } from '../navigation/filesLocationSnapshots';
import { recordOpened } from '../activity/recordActivity';
import { useDiskStore } from '../store/diskStore';
import { useRecentStore } from '../store/recentStore';
import { selectCurrentLocation, useTabsStore } from '../store/tabsStore';
import { DiskExplorer } from './DiskExplorer';
import { NoPageOpen } from './NoPageOpen';

/**
 * The active tab is the navigation model. This route mirrors it into the URL
 * (always replacing, so tabs own Back and Forward), opens a URL it did not
 * write in the active tab, and loads what the tab shows. Snapshots own only
 * a folder's transient selection.
 */
export function FilesRoute() {
  const roots = useDiskStore((state) => state.roots);
  const current = useTabsStore(selectCurrentLocation);
  const location = useLocation();
  const navigate = useNavigate();
  const applied = React.useRef<FilesLocation | null>(null);
  const restoring = React.useRef(false);
  const search = React.useRef(location.search);
  search.current = location.search;
  /** The last search this route wrote; any other one came from outside. */
  const written = React.useRef<string | null>(null);
  /** A search from outside that waits for the roots before it can be checked. */
  const pending = React.useRef(false);
  const [readyKey, setReadyKey] = React.useState<string | null>(null);
  const currentKey = current ? serializeFilesLocation(current) : null;

  const capture = React.useCallback(() => {
    const shown = applied.current;
    if (!shown || shown.mode !== 'browse' || restoring.current) return;
    const state = useDiskStore.getState();
    if (!sameCollection(state.currentCollection, shown.collection)) return;
    filesLocationSnapshots.patch(shown, {
      selectedPaths: state.selectedPaths,
      focusedPath: state.focusedPath,
    });
  }, []);

  const syncUrl = React.useCallback(() => {
    if (pending.current) return;
    const shown = selectCurrentLocation(useTabsStore.getState());
    const next = shown ? serializeFilesLocation(shown) : '';
    written.current = next;
    if (search.current !== next)
      navigate({ pathname: FILES_ROUTE_PATH, search: next }, { replace: true });
  }, [navigate]);

  React.useEffect(() => {
    void useDiskStore.getState().loadRoots();
  }, []);
  React.useEffect(() => useDiskStore.subscribe(() => capture()), [capture]);

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

  // Load what the active tab shows, once per place.
  React.useEffect(() => {
    const next = current;
    if (!next) {
      capture();
      applied.current = null;
      return;
    }
    const key = serializeFilesLocation(next);
    if (
      applied.current &&
      serializeFilesLocation(applied.current) === key &&
      !restoring.current
    )
      return;
    capture();
    const snapshot = filesLocationSnapshots.read({
      mode: 'browse',
      collection: next.collection,
    });
    restoring.current = true;
    applied.current = next;
    const state = useDiskStore.getState();
    const directory = collectionDirectory(next.collection);
    state.navigateToCollection(next.collection);
    let cancelled = false;
    // Null means the directory could not be listed; Recent always resolves
    // to a (possibly empty) list and reports its own errors in place.
    const visiblePaths: Promise<string[] | null> = directory
      ? state
          .loadDirectory(directory)
          .then(
            () =>
              useDiskStore
                .getState()
                .listings[directory]?.map((entry) => entry.path) ?? null
          )
      : useRecentStore
          .getState()
          .load()
          .then(
            () =>
              useRecentStore
                .getState()
                .result?.items.map((item) => item.entry.path) ?? []
          );
    void visiblePaths.then((paths) => {
      if (cancelled) return;
      if (!paths) {
        restoring.current = false;
        const missing = directory ?? roots[0];
        const parent = parentFsPath(missing);
        const fallback =
          parent && roots.some((root) => isFsPathAtOrBelow(root, parent))
            ? parent
            : roots[0];
        if (fallback && fallback !== missing)
          useTabsStore.getState().open(
            { mode: 'browse', collection: directoryCollection(fallback) },
            { replace: true }
          );
        setReadyKey(key);
        return;
      }
      if (next.mode === 'browse') {
        const visible = new Set(paths);
        const selectedPaths =
          snapshot?.selectedPaths.filter((path) => visible.has(path)) ?? [];
        const focusedPath =
          snapshot?.focusedPath && visible.has(snapshot.focusedPath)
            ? snapshot.focusedPath
            : (selectedPaths.at(-1) ?? null);
        useDiskStore.setState({
          selectedPaths,
          focusedPath,
          selectedPath: focusedPath,
          filter: '',
        });
      }
      restoring.current = false;
      setReadyKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, [current, roots, capture]);

  // Only explicit opens record activity; switching tabs, Back and restoring
  // stay silent.
  const actions = React.useMemo<FilesNavigationActions>(
    () => ({
      navigateDirectory: (directory, options) => {
        recordOpened(directory);
        useTabsStore
          .getState()
          .open({ mode: 'browse', collection: directoryCollection(directory) }, options);
      },
      navigateCollection: (collection) =>
        useTabsStore.getState().open({ mode: 'browse', collection }),
      openFile: (file, options) => {
        recordOpened(file);
        useTabsStore.getState().open(fileLocation(file), options);
      },
    }),
    []
  );

  // A folder or Recent waits for its rows so the selection lands at once; a
  // page shows straight away, which keeps switching tabs from flashing.
  let page: React.ReactNode;
  if (!current) page = roots.length > 0 ? <NoPageOpen /> : <DiskExplorer />;
  else if (current.mode === 'browse' && currentKey !== readyKey)
    page = <div role="status">Loading…</div>;
  else page = <DiskExplorer />;
  return (
    <FilesNavigationContext.Provider value={actions}>
      {page}
    </FilesNavigationContext.Provider>
  );
}
