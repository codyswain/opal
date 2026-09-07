import {
  isAbsoluteFsPath,
  isFsPathAtOrBelow,
  normalizeFsPath,
  parentFsPath,
  remapFsPath,
} from '@/common/fsPaths';

export const FILES_ROUTE_PATH = '/files';

export type FilesHistoryMutation = 'push' | 'replace' | 'none';

/**
 * The collection a browse surface shows. A directory lists its children; the
 * built-in Recent collection lists personal activity. Saved views join this
 * union later. A focus location remembers the collection it was opened from,
 * so Return and Back land on the originating collection, never a substitute.
 */
export type FilesCollection =
  | { kind: 'directory'; directory: string }
  | { kind: 'recent' }
  | { kind: 'query'; id: string };

export const RECENT_COLLECTION: FilesCollection = { kind: 'recent' };

const QUERY_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function directoryCollection(directory: string): FilesCollection {
  return { kind: 'directory', directory: normalizeFsPath(directory) };
}

export function queryCollection(id: string): FilesCollection {
  return { kind: 'query', id };
}

export interface FilesLocationOptions {
  /** Transient query definitions live in session state; unknown ids are invalid. */
  isKnownQuery?: (id: string) => boolean;
}

export function collectionDirectory(collection: FilesCollection): string | null {
  return collection.kind === 'directory' ? collection.directory : null;
}

export function locationDirectory(location: FilesLocation): string | null {
  return collectionDirectory(location.collection);
}

export function collectionKey(collection: FilesCollection): string {
  if (collection.kind === 'directory') return `directory:${normalizeFsPath(collection.directory)}`;
  if (collection.kind === 'query') return `query:${collection.id}`;
  return collection.kind;
}

export function sameCollection(
  a: FilesCollection | null | undefined,
  b: FilesCollection | null | undefined
): boolean {
  return !!a && !!b && collectionKey(a) === collectionKey(b);
}

export interface FilesBrowseLocation {
  mode: 'browse';
  collection: FilesCollection;
}

export interface FilesFocusLocation {
  mode: 'focus';
  collection: FilesCollection;
  file: string;
}

export type FilesLocation = FilesBrowseLocation | FilesFocusLocation;

export interface FilesNavigationIntent {
  location: FilesLocation;
  history: FilesHistoryMutation;
}

export interface FilesRouterUpdate {
  pathname: typeof FILES_ROUTE_PATH;
  search: string;
  replace: boolean;
}

function isWithinOneRoot(
  paths: readonly string[],
  roots: readonly string[]
): boolean {
  return roots.some((root) =>
    paths.every((path) => isFsPathAtOrBelow(root, path))
  );
}

function normalizeCollection(
  candidate: FilesCollection,
  roots: readonly string[],
  options: FilesLocationOptions
): FilesCollection | null {
  if (candidate.kind === 'recent') return RECENT_COLLECTION;
  if (candidate.kind === 'query') {
    if (!QUERY_ID.test(candidate.id) || !options.isKnownQuery?.(candidate.id)) return null;
    return { kind: 'query', id: candidate.id };
  }
  const directory = normalizeFsPath(candidate.directory);
  if (!isAbsoluteFsPath(directory) || !isWithinOneRoot([directory], roots)) {
    return null;
  }
  return { kind: 'directory', directory };
}

export function normalizeFilesLocation(
  candidate: FilesLocation | null,
  roots: readonly string[],
  options: FilesLocationOptions = {}
): FilesLocation | null {
  if (!candidate || roots.length === 0) return null;

  const collection = normalizeCollection(candidate.collection, roots, options);
  if (!collection) return null;

  if (candidate.mode === 'browse') {
    return { mode: 'browse', collection };
  }

  const file = normalizeFsPath(candidate.file);
  if (!isAbsoluteFsPath(file)) return null;
  const directory = collectionDirectory(collection);
  if (directory) {
    if (file === directory || !isWithinOneRoot([directory, file], roots)) {
      return null;
    }
  } else if (!isWithinOneRoot([file], roots)) {
    return null;
  }
  return { mode: 'focus', collection, file };
}

function parseCollection(params: URLSearchParams): FilesCollection | null {
  const collection = params.get('collection');
  if (collection !== null) {
    if (collection === 'recent') return RECENT_COLLECTION;
    if (collection === 'query') {
      const id = params.get('id');
      return id ? { kind: 'query', id } : null;
    }
    return null;
  }
  const directory = params.get('dir');
  return directory ? { kind: 'directory', directory } : null;
}

export function parseFilesLocation(
  search: string,
  roots: readonly string[],
  options: FilesLocationOptions = {}
): FilesLocation | null {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search
  );
  const mode = params.get('mode');
  if (mode !== 'browse' && mode !== 'focus') return null;
  const collection = parseCollection(params);
  if (!collection) return null;

  if (mode === 'browse') {
    return normalizeFilesLocation({ mode, collection }, roots, options);
  }

  const file = params.get('file');
  if (!file) return null;
  return normalizeFilesLocation({ mode, collection, file }, roots, options);
}

export function serializeFilesLocation(location: FilesLocation): string {
  const params = new URLSearchParams();
  params.set('mode', location.mode);
  if (location.collection.kind === 'directory') {
    params.set('dir', normalizeFsPath(location.collection.directory));
  } else {
    params.set('collection', location.collection.kind);
    if (location.collection.kind === 'query') params.set('id', location.collection.id);
  }
  if (location.mode === 'focus') {
    params.set('file', normalizeFsPath(location.file));
  }
  return `?${params.toString()}`;
}

export function filesLocationKey(location: FilesLocation): string {
  return serializeFilesLocation(location);
}

export function browseCollection(
  collection: FilesCollection,
  history: FilesHistoryMutation = 'push'
): FilesNavigationIntent {
  return { location: { mode: 'browse', collection }, history };
}

export function browseFiles(
  directory: string,
  history: FilesHistoryMutation = 'push'
): FilesNavigationIntent {
  return browseCollection(directoryCollection(directory), history);
}

export function browseRecent(
  history: FilesHistoryMutation = 'push'
): FilesNavigationIntent {
  return browseCollection(RECENT_COLLECTION, history);
}

export function focusInCollection(
  collection: FilesCollection,
  file: string,
  history: FilesHistoryMutation = 'push'
): FilesNavigationIntent {
  return {
    location: { mode: 'focus', collection, file: normalizeFsPath(file) },
    history,
  };
}

export function focusFile(
  directory: string,
  file: string,
  history: FilesHistoryMutation = 'push'
): FilesNavigationIntent {
  return focusInCollection(directoryCollection(directory), file, history);
}

export function toFilesRouterUpdate(
  intent: FilesNavigationIntent
): FilesRouterUpdate | null {
  if (intent.history === 'none') return null;
  return {
    pathname: FILES_ROUTE_PATH,
    search: serializeFilesLocation(intent.location),
    replace: intent.history === 'replace',
  };
}

export interface ResolvedFilesLocation {
  location: FilesLocation;
  history: Extract<FilesHistoryMutation, 'replace' | 'none'>;
}

/** Resolves a URL to a valid canonical location or the first-root fallback. */
export function resolveFilesLocation(
  search: string,
  roots: readonly string[],
  options: FilesLocationOptions = {}
): ResolvedFilesLocation | null {
  const location = parseFilesLocation(search, roots, options);
  if (!location) {
    const fallback = roots[0] ? normalizeFsPath(roots[0]) : null;
    return fallback
      ? {
          location: { mode: 'browse', collection: directoryCollection(fallback) },
          history: 'replace',
        }
      : null;
  }

  const canonicalSearch = serializeFilesLocation(location);
  const suppliedSearch = search.startsWith('?') ? search : `?${search}`;
  return {
    location,
    history: canonicalSearch === suppliedSearch ? 'none' : 'replace',
  };
}

function remapCollection(
  collection: FilesCollection,
  oldPath: string,
  newPath: string
): FilesCollection {
  return collection.kind === 'directory'
    ? {
        kind: 'directory',
        directory: remapFsPath(collection.directory, oldPath, newPath),
      }
    : collection;
}

export function remapFilesLocation(
  location: FilesLocation,
  oldPath: string,
  newPath: string
): FilesNavigationIntent {
  const collection = remapCollection(location.collection, oldPath, newPath);
  const remapped: FilesLocation =
    location.mode === 'focus'
      ? {
          mode: 'focus',
          collection,
          file: remapFsPath(location.file, oldPath, newPath),
        }
      : { mode: 'browse', collection };

  return {
    location: remapped,
    history:
      filesLocationKey(remapped) === filesLocationKey(location)
        ? 'none'
        : 'replace',
  };
}

export function filesLocationFromState(input: {
  currentDirectory: string | null;
  openedPath: string | null;
}): FilesLocation | null {
  if (!input.currentDirectory) return null;
  const collection = directoryCollection(input.currentDirectory);
  return input.openedPath
    ? { mode: 'focus', collection, file: normalizeFsPath(input.openedPath) }
    : { mode: 'browse', collection };
}

export function stateFromFilesLocation(location: FilesLocation): {
  currentDirectory: string | null;
  openedPath: string | null;
} {
  return {
    currentDirectory: locationDirectory(location),
    openedPath: location.mode === 'focus' ? location.file : null,
  };
}

export type FilesTargetKind =
  | 'file'
  | 'directory'
  | 'sidebar-directory'
  | 'open-file-tab';
export type FilesActivation =
  | 'single-click'
  | 'double-click'
  | 'return'
  | 'open'
  | 'space';

export type FilesInteractionOutcome =
  | { type: 'select'; path: string }
  | { type: 'rename'; path: string }
  | { type: 'quick-preview'; path: string }
  | { type: 'activate-tab'; path: string }
  | {
      type: 'open-file';
      path: string;
      navigation: FilesNavigationIntent;
    }
  | {
      type: 'navigate-directory';
      path: string;
      navigation: FilesNavigationIntent;
    }
  | { type: 'none' };

/** Pure representation of the pointer/keyboard interaction matrix. */
export function resolveFilesInteraction(input: {
  targetKind: FilesTargetKind;
  activation: FilesActivation;
  path: string;
  currentDirectory: string | null;
}): FilesInteractionOutcome {
  const path = normalizeFsPath(input.path);
  const activation = input.activation;

  if (input.targetKind === 'open-file-tab') {
    return activation === 'single-click' || activation === 'double-click'
      ? { type: 'activate-tab', path }
      : { type: 'none' };
  }

  if (input.targetKind === 'sidebar-directory') {
    return activation === 'single-click' ||
      activation === 'double-click' ||
      activation === 'open'
      ? {
          type: 'navigate-directory',
          path,
          navigation: browseFiles(path),
        }
      : { type: 'none' };
  }

  if (activation === 'single-click') {
    return { type: 'select', path };
  }
  if (activation === 'return') {
    return { type: 'rename', path };
  }

  if (input.targetKind === 'directory') {
    return activation === 'double-click' || activation === 'open'
      ? {
          type: 'navigate-directory',
          path,
          navigation: browseFiles(path),
        }
      : { type: 'none' };
  }

  if (activation === 'space') {
    return { type: 'quick-preview', path };
  }
  if (activation === 'double-click' || activation === 'open') {
    const directory =
      input.currentDirectory ?? parentFsPath(path);
    return directory
      ? {
          type: 'open-file',
          path,
          navigation: focusFile(directory, path),
        }
      : { type: 'none' };
  }
  return { type: 'none' };
}

/**
 * Task 7 implements these semantics in the DOM. Both collection layouts use
 * one focus owner so virtualization never creates hundreds of tab stops.
 */
export const FILES_ARIA_CONTRACT = {
  directoryTreeRole: 'tree',
  detailsCollectionRole: 'grid',
  galleryCollectionRole: 'grid',
  multiselectable: true,
  focusStrategy: 'aria-activedescendant',
} as const;
