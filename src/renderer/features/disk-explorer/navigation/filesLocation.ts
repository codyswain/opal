import {
  isAbsoluteFsPath,
  isFsPathAtOrBelow,
  normalizeFsPath,
  remapFsPath,
} from '@/common/fsPaths';

export const FILES_ROUTE_PATH = '/files';

/** Recent is the one list a tab can browse; folders browse in the sidebar tree. */
export interface FilesCollection {
  kind: 'recent';
}

export const RECENT_COLLECTION: FilesCollection = { kind: 'recent' };

export interface FilesBrowseLocation {
  mode: 'browse';
  collection: FilesCollection;
}

export interface FilesFocusLocation {
  mode: 'focus';
  file: string;
}

/** What a tab shows: Recent, or one file. */
export type FilesLocation = FilesBrowseLocation | FilesFocusLocation;

export interface FilesNavigationIntent {
  location: FilesLocation;
}

/** The file a place shows; Recent has none. */
export function locationPath(location: FilesLocation): string | null {
  return location.mode === 'focus' ? location.file : null;
}

export function normalizeFilesLocation(
  candidate: FilesLocation | null,
  roots: readonly string[]
): FilesLocation | null {
  if (!candidate || roots.length === 0) return null;
  if (candidate.mode === 'browse') {
    return candidate.collection.kind === 'recent'
      ? { mode: 'browse', collection: RECENT_COLLECTION }
      : null;
  }
  const file = normalizeFsPath(candidate.file);
  if (!isAbsoluteFsPath(file) || !roots.some((root) => isFsPathAtOrBelow(root, file))) {
    return null;
  }
  return { mode: 'focus', file };
}

export function parseFilesLocation(
  search: string,
  roots: readonly string[]
): FilesLocation | null {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search
  );
  const mode = params.get('mode');
  if (mode === 'browse') {
    return params.get('collection') === 'recent'
      ? normalizeFilesLocation({ mode, collection: RECENT_COLLECTION }, roots)
      : null;
  }
  const file = params.get('file');
  if (mode !== 'focus' || !file) return null;
  return normalizeFilesLocation({ mode, file }, roots);
}

export function serializeFilesLocation(location: FilesLocation): string {
  const params = new URLSearchParams();
  params.set('mode', location.mode);
  if (location.mode === 'browse') {
    params.set('collection', location.collection.kind);
  } else {
    params.set('file', normalizeFsPath(location.file));
  }
  return `?${params.toString()}`;
}

export function filesLocationKey(location: FilesLocation): string {
  return serializeFilesLocation(location);
}

export function browseRecent(): FilesNavigationIntent {
  return { location: { mode: 'browse', collection: RECENT_COLLECTION } };
}

/** A file shown in a tab. */
export function fileLocation(file: string): FilesFocusLocation {
  return { mode: 'focus', file: normalizeFsPath(file) };
}

export function focusFile(file: string): FilesNavigationIntent {
  return { location: fileLocation(file) };
}

/** The place after a rename or move; Recent and files outside it stay as they are. */
export function remapFilesLocation(
  location: FilesLocation,
  oldPath: string,
  newPath: string
): FilesLocation {
  if (location.mode === 'browse') return location;
  return fileLocation(remapFsPath(location.file, oldPath, newPath));
}
