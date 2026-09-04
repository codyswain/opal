import {
  isAbsoluteFsPath,
  isFsPathAtOrBelow,
  normalizeFsPath,
  remapFsPath,
} from '@/common/fsPaths';
import {
  filesLocationKey,
  remapFilesLocation,
  type FilesLocation,
} from './filesLocation';

export interface FilesScrollSnapshot {
  view: 'details' | 'gallery';
  offset: number;
}

export interface FilesLocationSnapshot {
  selectedPaths: string[];
  focusedPath: string | null;
  scroll: FilesScrollSnapshot | null;
}

function sanitizeScrollSnapshot(value: unknown): FilesScrollSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<FilesScrollSnapshot>;
  if (
    (candidate.view !== 'details' && candidate.view !== 'gallery') ||
    typeof candidate.offset !== 'number' ||
    !Number.isFinite(candidate.offset) ||
    candidate.offset < 0
  ) {
    return null;
  }
  return { view: candidate.view, offset: candidate.offset };
}

export function sanitizeFilesLocationSnapshot(
  value: unknown,
  options: {
    location?: FilesLocation;
    roots?: readonly string[];
  } = {}
): FilesLocationSnapshot {
  if (!value || typeof value !== 'object') {
    return { selectedPaths: [], focusedPath: null, scroll: null };
  }
  const candidate = value as Partial<FilesLocationSnapshot>;
  const isAllowed = (path: string) => {
    if (
      options.location &&
      !isFsPathAtOrBelow(options.location.directory, path)
    ) {
      return false;
    }
    if (
      options.roots &&
      !options.roots.some((root) => isFsPathAtOrBelow(root, path))
    ) {
      return false;
    }
    return true;
  };
  const selectedPaths = Array.isArray(candidate.selectedPaths)
    ? [
        ...new Set(
          candidate.selectedPaths
            .filter(
              (path): path is string =>
                typeof path === 'string' &&
                isAbsoluteFsPath(path) &&
                isAllowed(path)
            )
            .map(normalizeFsPath)
        ),
      ]
    : [];
  const focusedPath =
    typeof candidate.focusedPath === 'string' &&
    isAbsoluteFsPath(candidate.focusedPath) &&
    isAllowed(candidate.focusedPath)
      ? normalizeFsPath(candidate.focusedPath)
      : null;
  return {
    selectedPaths,
    focusedPath,
    scroll: sanitizeScrollSnapshot(candidate.scroll),
  };
}

export interface FilesLocationSnapshotStore {
  capture(location: FilesLocation, snapshot: FilesLocationSnapshot): void;
  patch(location: FilesLocation, patch: Partial<FilesLocationSnapshot>): void;
  read(location: FilesLocation): FilesLocationSnapshot | null;
  remapSubtree(oldPath: string, newPath: string): void;
  removeSubtrees(paths: readonly string[]): void;
  retainRoots(roots: readonly string[]): void;
  checkpoint(): () => void;
  clear(): void;
  size(): number;
}

interface SnapshotRecord {
  location: FilesLocation;
  snapshot: FilesLocationSnapshot;
}

function cloneSnapshot(snapshot: FilesLocationSnapshot): FilesLocationSnapshot {
  return {
    selectedPaths: [...snapshot.selectedPaths],
    focusedPath: snapshot.focusedPath,
    scroll: snapshot.scroll ? { ...snapshot.scroll } : null,
  };
}

function isWithinOneRoot(
  paths: readonly string[],
  roots: readonly string[]
): boolean {
  return roots.some((root) =>
    paths.every((path) => isFsPathAtOrBelow(root, path))
  );
}

export function createFilesLocationSnapshotStore(
  maxEntries = 50
): FilesLocationSnapshotStore {
  const limit = Number.isFinite(maxEntries)
    ? Math.max(1, Math.floor(maxEntries))
    : 50;
  const records = new Map<string, SnapshotRecord>();

  const storeRecord = (record: SnapshotRecord) => {
    const key = filesLocationKey(record.location);
    records.delete(key);
    records.set(key, record);
    while (records.size > limit) {
      const oldest = records.keys().next().value;
      if (typeof oldest !== 'string') break;
      records.delete(oldest);
    }
  };

  return {
    capture(location, snapshot) {
      storeRecord({
        location,
        snapshot: sanitizeFilesLocationSnapshot(snapshot, { location }),
      });
    },
    patch(location, patch) {
      const key = filesLocationKey(location);
      const current = records.get(key)?.snapshot ?? {
        selectedPaths: [],
        focusedPath: null,
        scroll: null,
      };
      storeRecord({
        location,
        snapshot: sanitizeFilesLocationSnapshot(
          { ...current, ...patch },
          { location }
        ),
      });
    },
    read(location) {
      const key = filesLocationKey(location);
      const record = records.get(key);
      if (!record) return null;
      storeRecord(record);
      return cloneSnapshot(record.snapshot);
    },
    remapSubtree(oldPath, newPath) {
      const remappedRecords = [...records.values()].map((record) => {
        const navigation = remapFilesLocation(
          record.location,
          oldPath,
          newPath
        );
        return {
          location: navigation.location,
          snapshot: {
            selectedPaths: record.snapshot.selectedPaths.map((path) =>
              remapFsPath(path, oldPath, newPath)
            ),
            focusedPath: record.snapshot.focusedPath
              ? remapFsPath(record.snapshot.focusedPath, oldPath, newPath)
              : null,
            scroll: record.snapshot.scroll
              ? { ...record.snapshot.scroll }
              : null,
          },
        };
      });
      records.clear();
      remappedRecords.forEach(storeRecord);
    },
    removeSubtrees(paths) {
      const removed = paths.map(normalizeFsPath);
      const isRemoved = (path: string) =>
        removed.some((prefix) => isFsPathAtOrBelow(prefix, path));

      for (const [key, record] of records) {
        if (
          isRemoved(record.location.directory) ||
          (record.location.mode === 'focus' && isRemoved(record.location.file))
        ) {
          records.delete(key);
          continue;
        }
        record.snapshot.selectedPaths =
          record.snapshot.selectedPaths.filter((path) => !isRemoved(path));
        if (
          record.snapshot.focusedPath &&
          isRemoved(record.snapshot.focusedPath)
        ) {
          record.snapshot.focusedPath =
            record.snapshot.selectedPaths.at(-1) ?? null;
        }
      }
    },
    retainRoots(roots) {
      const normalizedRoots = roots
        .filter(isAbsoluteFsPath)
        .map(normalizeFsPath);
      if (normalizedRoots.length === 0) {
        records.clear();
        return;
      }

      for (const [key, record] of records) {
        const locationPaths =
          record.location.mode === 'focus'
            ? [record.location.directory, record.location.file]
            : [record.location.directory];
        if (!isWithinOneRoot(locationPaths, normalizedRoots)) {
          records.delete(key);
          continue;
        }
        record.snapshot = sanitizeFilesLocationSnapshot(record.snapshot, {
          location: record.location,
          roots: normalizedRoots,
        });
      }
    },
    checkpoint() {
      const saved = [...records.entries()].map(([key, record]) => [
        key,
        {
          location: { ...record.location } as FilesLocation,
          snapshot: cloneSnapshot(record.snapshot),
        },
      ] as const);
      return () => {
        records.clear();
        saved.forEach(([key, record]) => records.set(key, record));
      };
    },
    clear() {
      records.clear();
    },
    size() {
      return records.size;
    },
  };
}

export const filesLocationSnapshots = createFilesLocationSnapshotStore();

export interface CollectionFocusState {
  focusedPath: string | null;
  selectedPaths: string[];
}

interface FocusFallbackInput extends CollectionFocusState {
  previousVisiblePaths: readonly string[];
  visiblePaths: readonly string[];
}

function survivingFocus(input: FocusFallbackInput): CollectionFocusState | null {
  const visible = new Set(input.visiblePaths);
  const selectedPaths = input.selectedPaths.filter((path) => visible.has(path));
  if (input.focusedPath && visible.has(input.focusedPath)) {
    return { focusedPath: input.focusedPath, selectedPaths };
  }
  if (selectedPaths.length > 0) {
    return {
      focusedPath: selectedPaths[selectedPaths.length - 1] ?? null,
      selectedPaths,
    };
  }
  return null;
}

function fallbackVisiblePath(input: FocusFallbackInput): string | null {
  if (input.visiblePaths.length === 0) return null;
  const previousIndex = input.focusedPath
    ? input.previousVisiblePaths.indexOf(input.focusedPath)
    : -1;
  const nextIndex =
    previousIndex < 0
      ? 0
      : Math.min(previousIndex, input.visiblePaths.length - 1);
  return input.visiblePaths[nextIndex] ?? null;
}

export function focusAfterRemoval(
  input: FocusFallbackInput
): CollectionFocusState {
  const survivor = survivingFocus(input);
  if (survivor) return survivor;
  const fallback = fallbackVisiblePath(input);
  return {
    focusedPath: fallback,
    selectedPaths: fallback ? [fallback] : [],
  };
}

export function focusAfterFilter(
  input: FocusFallbackInput
): CollectionFocusState {
  const survivor = survivingFocus(input);
  if (survivor) return survivor;
  return {
    focusedPath: fallbackVisiblePath(input),
    selectedPaths: [],
  };
}

export function focusAfterNavigation(): CollectionFocusState {
  return { focusedPath: null, selectedPaths: [] };
}
