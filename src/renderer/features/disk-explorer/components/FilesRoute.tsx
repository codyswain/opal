import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isFsPathAtOrBelow, parentFsPath } from '@/common/fsPaths';
import {
  FILES_ROUTE_PATH,
  directoryCollection,
  locationDirectory,
  resolveFilesLocation,
  serializeFilesLocation,
  remapFilesLocation,
  type FilesLocation,
} from '../navigation/filesLocation';
import {
  FilesNavigationContext,
  type FilesNavigationActions,
} from '../navigation/FilesNavigationContext';
import { filesLocationSnapshots } from '../navigation/filesLocationSnapshots';
import { pathMutationCoordinator } from '../navigation/pathMutationCoordinator';
import { useDiskStore } from '../store/diskStore';
import { useTabsStore } from '../store/tabsStore';
import { DiskExplorer } from './DiskExplorer';

/** Router owns navigation; snapshots own only the collection's transient state. */
export function FilesRoute() {
  const roots = useDiskStore((state) => state.roots);
  const location = useLocation();
  const navigate = useNavigate();
  const applied = React.useRef<FilesLocation | null>(null);
  const restoring = React.useRef(false);
  const [readyKey, setReadyKey] = React.useState<string | null>(null);
  const resolved = React.useMemo(
    () => resolveFilesLocation(location.search, roots),
    [location.search, roots]
  );
  const capture = React.useCallback(() => {
    const current = applied.current;
    if (!current || current.mode !== 'browse' || restoring.current) return;
    const state = useDiskStore.getState();
    const directory = locationDirectory(current);
    if (!directory || state.currentDirectory !== directory) return;
    filesLocationSnapshots.patch(current, {
      selectedPaths: state.selectedPaths,
      focusedPath: state.focusedPath,
    });
  }, []);
  const go = React.useCallback(
    (next: FilesLocation, replace = false) => {
      capture();
      navigate(
        { pathname: FILES_ROUTE_PATH, search: serializeFilesLocation(next) },
        { replace }
      );
    },
    [capture, navigate]
  );

  React.useEffect(() => {
    useTabsStore.getState().hydrate();
    void useDiskStore.getState().loadRoots();
  }, []);
  React.useEffect(() => useDiskStore.subscribe(() => capture()), [capture]);
  React.useEffect(() => {
    if (!resolved) {
      applied.current = null;
      useTabsStore.setState({ openedPath: null, activePath: null });
      return;
    }
    const next = resolved.location;
    const key = serializeFilesLocation(next);
    if (resolved.history === 'replace')
      navigate({ pathname: FILES_ROUTE_PATH, search: key }, { replace: true });
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
    // Task 9 adds the Recent collection; until then a non-directory
    // collection cannot reach this route because parsing requires roots.
    const nextDirectory = locationDirectory(next) ?? roots[0];
    state.navigateToDirectory(nextDirectory);
    if (next.mode === 'focus') useTabsStore.getState().openFile(next.file);
    else useTabsStore.setState({ openedPath: null, activePath: null });
    let cancelled = false;
    void state.loadDirectory(nextDirectory).then(() => {
      if (cancelled) return;
      const entries = useDiskStore.getState().listings[nextDirectory];
      if (!entries) {
        restoring.current = false;
        const parent = parentFsPath(nextDirectory);
        const fallback =
          parent && roots.some((root) => isFsPathAtOrBelow(root, parent))
            ? parent
            : roots[0];
        if (fallback && fallback !== nextDirectory)
          go({ mode: 'browse', collection: directoryCollection(fallback) }, true);
        setReadyKey(key);
        return;
      }
      if (next.mode === 'browse') {
        const visible = new Set(entries.map((entry) => entry.path));
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
  }, [resolved, capture, navigate, go, roots]);

  React.useEffect(
    () =>
      pathMutationCoordinator.register({
        id: 'files-route',
        prepareAppMutation: ({ oldPath, newPath }) => {
          const previous = applied.current;
          if (!previous) return;
          const intent = remapFilesLocation(previous, oldPath, newPath);
          if (intent.history === 'none') return;
          return {
            commit: () => {
              applied.current = null;
              go(intent.location, true);
            },
            rollback: () => go(previous, true),
          };
        },
        preparePathRemoval: (paths) => {
          const previous = applied.current;
          if (!previous) return;
          const removed = (path: string) =>
            paths.some((prefix) => isFsPathAtOrBelow(prefix, path));
          const previousDirectory = locationDirectory(previous);
          if (
            !(previousDirectory && removed(previousDirectory)) &&
            !(previous.mode === 'focus' && removed(previous.file))
          )
            return;
          let directory: string | null = previousDirectory;
          while (directory && removed(directory))
            directory = parentFsPath(directory);
          const allowed = useDiskStore
            .getState()
            .roots.filter((root) => !removed(root));
          const candidate = directory;
          if (
            !candidate ||
            !allowed.some((root) => isFsPathAtOrBelow(root, candidate))
          )
            directory = allowed[0] ?? null;
          const next = directory
            ? { mode: 'browse' as const, collection: directoryCollection(directory) }
            : null;
          return {
            commit: () => {
              applied.current = null;
              if (next) go(next, true);
              else navigate(FILES_ROUTE_PATH, { replace: true });
            },
            rollback: () => go(previous, true),
          };
        },
      }),
    [go, navigate]
  );

  const directoryForFile = React.useCallback(
    (file: string, current: string | null) => {
      const allowedRoots = useDiskStore.getState().roots;
      return current &&
        allowedRoots.some(
          (root) =>
            isFsPathAtOrBelow(root, current) && isFsPathAtOrBelow(root, file)
        )
        ? current
        : parentFsPath(file);
    },
    []
  );
  const actions = React.useMemo<FilesNavigationActions>(
    () => ({
      navigateDirectory: (directory) =>
        go({ mode: 'browse', collection: directoryCollection(directory) }),
      openFile: (file) => {
        const directory = directoryForFile(
          file,
          (applied.current && locationDirectory(applied.current)) ??
            useDiskStore.getState().currentDirectory
        );
        if (directory)
          go({ mode: 'focus', collection: directoryCollection(directory), file });
      },
      returnToFolder: () => {
        if (applied.current)
          go({ mode: 'browse', collection: applied.current.collection });
      },
      closeFile: (path) => {
        const active = applied.current;
        useTabsStore.getState().close(path);
        if (active?.mode === 'focus' && active.file === path) {
          const file = useTabsStore.getState().openedPath;
          const activeDirectory = locationDirectory(active);
          const directory = file
            ? directoryForFile(file, activeDirectory)
            : activeDirectory;
          if (directory)
            go(
              file
                ? { mode: 'focus', collection: directoryCollection(directory), file }
                : { mode: 'browse', collection: directoryCollection(directory) }
            );
        }
      },
    }),
    [go, directoryForFile]
  );
  const key = resolved ? serializeFilesLocation(resolved.location) : null;
  return (
    <FilesNavigationContext.Provider value={actions}>
      {key && key !== readyKey ? (
        <div role="status">Loading folder…</div>
      ) : (
        <DiskExplorer showNavigationPane={false} />
      )}
    </FilesNavigationContext.Provider>
  );
}
