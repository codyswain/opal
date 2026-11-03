import { constants } from 'fs';
import { open } from 'fs/promises';
import path from 'path';
import { inVault } from '@/main/vault/vaultPaths';

export const FILES_SETTINGS = '.opal/files.json';
/** A settings file larger than this is not one a person wrote. */
const SETTINGS_LIMIT = 16 * 1024;

export type StoreKind = 'folder' | 'git-lfs';

/** Where an opened folder stores imported files and how they sync, from `<root>/.opal/files.json`. */
export interface FilesSettings {
  /** From the folder's top, with forward slashes. */
  folder: string;
  store: StoreKind;
}

export const DEFAULT_FILES_SETTINGS: FilesSettings = { folder: 'files', store: 'folder' };

/**
 * The settings a file's text holds, or the defaults when it is not a version
 * 1 file naming a store and a folder below the opened folder's top that is
 * not hidden.
 */
export function parseFilesSettings(text: string): FilesSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return DEFAULT_FILES_SETTINGS;
  }
  const file = parsed as { version?: unknown; folder?: unknown; store?: unknown } | null;
  if (!file || typeof file !== 'object' || file.version !== 1) return DEFAULT_FILES_SETTINGS;
  const { folder, store } = file;
  if (store !== 'folder' && store !== 'git-lfs') return DEFAULT_FILES_SETTINGS;
  if (typeof folder !== 'string' || !folder || folder.includes('\0') || folder.includes('\\') || path.posix.isAbsolute(folder)) return DEFAULT_FILES_SETTINGS;
  const normalized = path.posix.normalize(folder).replace(/\/$/, '');
  // A hidden folder, ".git" or ".." among them, is out of the tree and the link index, or out of the root.
  if (normalized.split('/').some((segment) => segment.startsWith('.'))) return DEFAULT_FILES_SETTINGS;
  return { folder: normalized, store };
}

/**
 * Reads an opened folder's files settings the way PinsService reads its
 * pins: inside the folder, never through a link, and only a small file. A
 * missing or unreadable file means the defaults.
 */
export async function readFilesSettings(root: string): Promise<FilesSettings> {
  let handle;
  try {
    handle = await open(await inVault(root, path.join(root, FILES_SETTINGS)), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return DEFAULT_FILES_SETTINGS;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > SETTINGS_LIMIT) return DEFAULT_FILES_SETTINGS;
    return parseFilesSettings(await handle.readFile('utf8'));
  } catch {
    return DEFAULT_FILES_SETTINGS;
  } finally {
    await handle.close();
  }
}
