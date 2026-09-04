import {
  isAbsoluteFsPath,
  isFsPathAtOrBelow,
  normalizeFsPath,
  parentFsPath,
  remapFsPath,
} from '@/common/fsPaths';

export const FILES_ROUTE_PATH = '/files';

export type FilesHistoryMutation = 'push' | 'replace' | 'none';

export interface FilesBrowseLocation {
  mode: 'browse';
  directory: string;
}

export interface FilesFocusLocation {
  mode: 'focus';
  directory: string;
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

export function normalizeFilesLocation(
  candidate: FilesLocation | null,
  roots: readonly string[]
): FilesLocation | null {
  if (!candidate || roots.length === 0) return null;

  const directory = normalizeFsPath(candidate.directory);
  if (
    !isAbsoluteFsPath(directory) ||
    !isWithinOneRoot([directory], roots)
  ) {
    return null;
  }

  if (candidate.mode === 'browse') {
    return { mode: 'browse', directory };
  }

  const file = normalizeFsPath(candidate.file);
  if (
    !isAbsoluteFsPath(file) ||
    file === directory ||
    !isWithinOneRoot([directory, file], roots)
  ) {
    return null;
  }
  return { mode: 'focus', directory, file };
}

export function parseFilesLocation(
  search: string,
  roots: readonly string[]
): FilesLocation | null {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search
  );
  const mode = params.get('mode');
  const directory = params.get('dir');
  if (!directory || (mode !== 'browse' && mode !== 'focus')) return null;

  if (mode === 'browse') {
    return normalizeFilesLocation({ mode, directory }, roots);
  }

  const file = params.get('file');
  if (!file) return null;
  return normalizeFilesLocation({ mode, directory, file }, roots);
}

export function serializeFilesLocation(location: FilesLocation): string {
  const params = new URLSearchParams();
  params.set('mode', location.mode);
  params.set('dir', normalizeFsPath(location.directory));
  if (location.mode === 'focus') {
    params.set('file', normalizeFsPath(location.file));
  }
  return `?${params.toString()}`;
}

export function filesLocationKey(location: FilesLocation): string {
  return serializeFilesLocation(location);
}

export function browseFiles(
  directory: string,
  history: FilesHistoryMutation = 'push'
): FilesNavigationIntent {
  return {
    location: { mode: 'browse', directory: normalizeFsPath(directory) },
    history,
  };
}

export function focusFile(
  directory: string,
  file: string,
  history: FilesHistoryMutation = 'push'
): FilesNavigationIntent {
  return {
    location: {
      mode: 'focus',
      directory: normalizeFsPath(directory),
      file: normalizeFsPath(file),
    },
    history,
  };
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
  roots: readonly string[]
): ResolvedFilesLocation | null {
  const location = parseFilesLocation(search, roots);
  if (!location) {
    const fallback = roots[0] ? normalizeFsPath(roots[0]) : null;
    return fallback
      ? {
          location: { mode: 'browse', directory: fallback },
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

export function remapFilesLocation(
  location: FilesLocation,
  oldPath: string,
  newPath: string
): FilesNavigationIntent {
  const remapped: FilesLocation =
    location.mode === 'focus'
      ? {
          mode: 'focus',
          directory: remapFsPath(location.directory, oldPath, newPath),
          file: remapFsPath(location.file, oldPath, newPath),
        }
      : {
          mode: 'browse',
          directory: remapFsPath(location.directory, oldPath, newPath),
        };

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
  return input.openedPath
    ? {
        mode: 'focus',
        directory: normalizeFsPath(input.currentDirectory),
        file: normalizeFsPath(input.openedPath),
      }
    : {
        mode: 'browse',
        directory: normalizeFsPath(input.currentDirectory),
      };
}

export function stateFromFilesLocation(location: FilesLocation): {
  currentDirectory: string;
  openedPath: string | null;
} {
  return {
    currentDirectory: location.directory,
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
