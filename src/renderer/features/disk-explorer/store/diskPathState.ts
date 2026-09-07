import {
  basenameFsPath,
  isFsPathAtOrBelow,
  normalizeFsPath,
  parentFsPath,
  remapFsPath,
} from '@/common/fsPaths';
import type { DiskEntry } from '@/types/disk';
import {
  directoryCollection,
  type FilesCollection,
} from '../navigation/filesLocation';
import type {
  AppPathMutation,
  PathRemovalReason,
} from '../navigation/pathMutationCoordinator';
import type { DiskState } from './diskStore';

function collectionFor(
  previous: FilesCollection | null,
  currentDirectory: string | null
): FilesCollection | null {
  if (previous && previous.kind !== 'directory') return previous;
  return currentDirectory ? directoryCollection(currentDirectory) : null;
}

function remapNullablePath(
  path: string | null,
  oldPath: string,
  newPath: string
): string | null {
  return path ? remapFsPath(path, oldPath, newPath) : null;
}

function remapListings(
  listings: Record<string, DiskEntry[]>,
  oldPath: string,
  newPath: string
): Record<string, DiskEntry[]> {
  const remapped: Record<string, DiskEntry[]> = {};

  for (const [directory, entries] of Object.entries(listings)) {
    const nextDirectory = remapFsPath(directory, oldPath, newPath);
    const nextEntries = entries.map((entry) => {
      const nextPath = remapFsPath(entry.path, oldPath, newPath);
      if (nextPath === entry.path) return entry;
      return {
        ...entry,
        path: nextPath,
        name:
          normalizeFsPath(entry.path) === normalizeFsPath(oldPath)
            ? basenameFsPath(newPath)
            : entry.name,
      };
    });
    const byPath = new Map(
      [...(remapped[nextDirectory] ?? []), ...nextEntries].map((entry) => [
        entry.path,
        entry,
      ])
    );
    remapped[nextDirectory] = [...byPath.values()];
  }

  return remapped;
}

export function remapDiskState(
  state: DiskState,
  mutation: AppPathMutation
): Partial<DiskState> {
  const { oldPath, newPath } = mutation;
  const focusedPath = remapNullablePath(
    state.focusedPath ?? state.selectedPath,
    oldPath,
    newPath
  );
  const expanded: Record<string, boolean> = {};
  for (const [path, value] of Object.entries(state.expanded)) {
    const remappedPath = remapFsPath(path, oldPath, newPath);
    expanded[remappedPath] = Boolean(expanded[remappedPath] || value);
  }

  const currentDirectory = remapNullablePath(
    state.currentDirectory,
    oldPath,
    newPath
  );

  return {
    roots: [
      ...new Set(
        state.roots.map((path) => remapFsPath(path, oldPath, newPath))
      ),
    ],
    listings: remapListings(state.listings, oldPath, newPath),
    expanded,
    currentCollection: collectionFor(state.currentCollection, currentDirectory),
    currentDirectory,
    focusedPath,
    selectedPath: focusedPath,
    selectedPaths: [
      ...new Set(
        state.selectedPaths.map((path) =>
          remapFsPath(path, oldPath, newPath)
        )
      ),
    ],
    quickPreviewPath: remapNullablePath(
      state.quickPreviewPath,
      oldPath,
      newPath
    ),
    pendingAction: state.pendingAction
      ? {
          ...state.pendingAction,
          target: remapFsPath(
            state.pendingAction.target,
            oldPath,
            newPath
          ),
        }
      : null,
    pendingDelete: remapNullablePath(
      state.pendingDelete,
      oldPath,
      newPath
    ),
  };
}

function fallbackDirectoryAfterRemoval(
  currentDirectory: string | null,
  roots: readonly string[],
  isRemoved: (path: string) => boolean
): string | null {
  if (!currentDirectory || !isRemoved(currentDirectory)) {
    return currentDirectory;
  }

  let candidate = parentFsPath(currentDirectory);
  while (candidate) {
    const path = candidate;
    if (
      !isRemoved(path) &&
      roots.some((root) => isFsPathAtOrBelow(root, path))
    ) {
      return path;
    }
    candidate = parentFsPath(path);
  }
  return roots[0] ?? null;
}

export function removePathsFromDiskState(
  state: DiskState,
  paths: readonly string[],
  reason: PathRemovalReason
): Partial<DiskState> {
  const removed = paths.map(normalizeFsPath);
  const isRemoved = (path: string) =>
    removed.some((root) => isFsPathAtOrBelow(root, path));
  const roots =
    reason === 'root-removed'
      ? state.roots.filter((root) => !isRemoved(root))
      : state.roots;
  const selectedPaths = state.selectedPaths.filter((path) => !isRemoved(path));
  const previousFocus = state.focusedPath ?? state.selectedPath;
  const focusedPath =
    previousFocus && !isRemoved(previousFocus)
      ? previousFocus
      : selectedPaths[selectedPaths.length - 1] ?? null;
  const quickPreviewWasRemoved =
    state.quickPreviewPath !== null &&
    isRemoved(state.quickPreviewPath);
  const currentDirectory = fallbackDirectoryAfterRemoval(
    state.currentDirectory,
    roots,
    isRemoved
  );

  return {
    roots,
    listings: Object.fromEntries(
      Object.entries(state.listings)
        .filter(([directory]) => !isRemoved(directory))
        .map(([directory, entries]) => [
          directory,
          entries.filter((entry) => !isRemoved(entry.path)),
        ])
    ),
    expanded: Object.fromEntries(
      Object.entries(state.expanded).filter(([path]) => !isRemoved(path))
    ),
    currentCollection: collectionFor(state.currentCollection, currentDirectory),
    currentDirectory,
    focusedPath,
    selectedPath: focusedPath,
    selectedPaths,
    quickPreviewPath: quickPreviewWasRemoved
      ? null
      : state.quickPreviewPath,
    isQuickLookOpen: quickPreviewWasRemoved
      ? false
      : state.isQuickLookOpen,
    pendingAction:
      state.pendingAction && isRemoved(state.pendingAction.target)
        ? null
        : state.pendingAction,
    pendingDelete:
      state.pendingDelete && isRemoved(state.pendingDelete)
        ? null
        : state.pendingDelete,
  };
}
