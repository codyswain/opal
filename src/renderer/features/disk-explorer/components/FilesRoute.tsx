import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isFsPathAtOrBelow, parentFsPath } from '@/common/fsPaths';
import {
  FILES_ROUTE_PATH,
  collectionDirectory,
  directoryCollection,
  locationDirectory,
  resolveFilesLocation,
  sameCollection,
  serializeFilesLocation,
  remapFilesLocation,
  type FilesCollection,
  type FilesLocation,
} from '../navigation/filesLocation';
import {
  FilesNavigationContext,
  type FilesNavigationActions,
} from '../navigation/FilesNavigationContext';
import { filesLocationSnapshots } from '../navigation/filesLocationSnapshots';
import { pathMutationCoordinator } from '../navigation/pathMutationCoordinator';
import { recordOpened } from '../activity/recordActivity';
import { useDiskStore } from '../store/diskStore';
import { useRecentStore } from '../store/recentStore';
import { useViewDraftsStore } from '../store/viewDraftsStore';
import { useSavedViewsStore } from '../store/savedViewsStore';
import { useCollectionQueryStore } from '../store/collectionQueryStore';
import { useTabsStore } from '../store/tabsStore';
import { DiskExplorer } from './DiskExplorer';

/** Router owns navigation; snapshots own only the collection's transient state. */
export function FilesRoute() {
  const roots = useDiskStore((state) => state.roots);
  const location = useLocation();
  // Only the URL's own collection id is subscribed to, so unrelated draft or
  // listing churn cannot re-key the apply effect while it is restoring.
  const urlParams = new URLSearchParams(location.search);
  const urlCollection = urlParams.get('collection');
  const urlId = urlParams.get('id');
  const knownQuery = useViewDraftsStore((state) =>
    urlCollection === 'query' && urlId ? urlId in state.drafts : false
  );
  const knownView = useSavedViewsStore((state) =>
    urlCollection === 'view' && urlId ? urlId in state.views : false
  );
  const viewsLoaded = useSavedViewsStore((state) => state.loaded);
  const navigate = useNavigate();
  const applied = React.useRef<FilesLocation | null>(null);
  const restoring = React.useRef(false);
  const [readyKey, setReadyKey] = React.useState<string | null>(null);
  // A view URL cannot be judged until the library listing has loaded.
  const awaitingViews = !viewsLoaded && urlCollection === 'view';
  const resolved = React.useMemo(
    () =>
      awaitingViews
        ? null
        : resolveFilesLocation(location.search, roots, {
            isKnownQuery: () => knownQuery,
            isKnownView: () => knownView,
          }),
    [awaitingViews, location.search, roots, knownQuery, knownView]
  );
  const capture = React.useCallback(() => {
    const current = applied.current;
    if (!current || current.mode !== 'browse' || restoring.current) return;
    const state = useDiskStore.getState();
    if (!sameCollection(state.currentCollection, current.collection)) return;
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
    useSavedViewsStore.getState().subscribe();
    void useSavedViewsStore.getState().load();
  }, []);
  React.useEffect(() => useDiskStore.subscribe(() => capture()), [capture]);
  React.useEffect(() => {
    if (!resolved) {
      if (awaitingViews) return;
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
    const directory = collectionDirectory(next.collection);
    state.navigateToCollection(next.collection);
    if (next.mode === 'focus') useTabsStore.getState().openFile(next.file);
    else useTabsStore.setState({ openedPath: null, activePath: null });
    let cancelled = false;
    // Null means the directory could not be listed; Recent and query
    // collections always resolve to a (possibly empty) list and report their
    // own errors in place.
    const collection = next.collection;
    const visiblePaths: Promise<string[] | null> = directory
      ? state
          .loadDirectory(directory)
          .then(
            () =>
              useDiskStore
                .getState()
                .listings[directory]?.map((entry) => entry.path) ?? null
          )
      : collection.kind === 'query' || collection.kind === 'view'
        ? (() => {
            const draftsStore = useViewDraftsStore.getState();
            if (collection.kind === 'view') {
              const view = useSavedViewsStore.getState().views[collection.id];
              if (view) draftsStore.openSaved(view);
            }
            const draft = useViewDraftsStore.getState().drafts[collection.id];
            if (!draft) return Promise.resolve<string[] | null>([]);
            return useCollectionQueryStore
              .getState()
              .load(collection.id, draft.query, { immediate: true })
              .then(
                () =>
                  useCollectionQueryStore
                    .getState()
                    .results[collection.id]?.rows.map((row) => row.entry.path) ?? []
              );
          })()
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
          go({ mode: 'browse', collection: directoryCollection(fallback) }, true);
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
  }, [resolved, awaitingViews, capture, navigate, go, roots]);

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
          if (!previousDirectory) {
            // Only the focused file vanished; Recent itself is unaffected.
            const back = { mode: 'browse' as const, collection: previous.collection };
            return {
              commit: () => {
                applied.current = null;
                go(back, true);
              },
              rollback: () => go(previous, true),
            };
          }
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

  /**
   * The collection a newly opened file belongs to. Recent keeps its identity;
   * a folder keeps it while the file shares its root; otherwise the file's
   * parent folder becomes the origin.
   */
  const collectionForFile = React.useCallback(
    (file: string, current: FilesCollection | null): FilesCollection | null => {
      if (current && current.kind !== 'directory') return current;
      const allowedRoots = useDiskStore.getState().roots;
      const directory = current ? collectionDirectory(current) : null;
      if (
        directory &&
        allowedRoots.some(
          (root) =>
            isFsPathAtOrBelow(root, directory) && isFsPathAtOrBelow(root, file)
        )
      )
        return current;
      const parent = parentFsPath(file);
      return parent ? directoryCollection(parent) : null;
    },
    []
  );
  const currentCollection = React.useCallback(
    () =>
      applied.current?.collection ??
      useDiskStore.getState().currentCollection ??
      null,
    []
  );
  // Only these explicit actions record activity. The URL-application effect,
  // its fallbacks, returnToFolder and closeFile call the router directly, so
  // restoration, Back/Forward and tab closing stay silent.
  const actions = React.useMemo<FilesNavigationActions>(
    () => ({
      navigateDirectory: (directory) => {
        recordOpened(directory);
        go({ mode: 'browse', collection: directoryCollection(directory) });
      },
      navigateCollection: (collection) => go({ mode: 'browse', collection }),
      openFile: (file) => {
        const collection = collectionForFile(file, currentCollection());
        if (!collection) return;
        recordOpened(file);
        go({ mode: 'focus', collection, file });
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
          const collection = file
            ? collectionForFile(file, active.collection)
            : active.collection;
          if (collection)
            go(
              file
                ? { mode: 'focus', collection, file }
                : { mode: 'browse', collection }
            );
        }
      },
    }),
    [go, collectionForFile, currentCollection]
  );
  const key = resolved ? serializeFilesLocation(resolved.location) : null;
  return (
    <FilesNavigationContext.Provider value={actions}>
      {(key && key !== readyKey) || awaitingViews ? (
        <div role="status">Loading…</div>
      ) : (
        <DiskExplorer showNavigationPane={false} />
      )}
    </FilesNavigationContext.Provider>
  );
}
