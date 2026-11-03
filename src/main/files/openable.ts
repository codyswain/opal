import { stat } from 'fs/promises';
import path from 'path';
import { classifyFile, extensionOf, withoutHash } from '@/common/fileKind';
import type { OpenResult } from '@/types/files';
import { FilesError } from './FileStore';
import { materialize, READ_ONLY_NOTICE } from './materialize';

/**
 * Files that run something when opened: apps and other bundles, launchers,
 * installers, scripts, and links to other files or apps. Opal shows them
 * in Finder and never opens them.
 */
export const LAUNCHERS: ReadonlySet<string> = new Set([
  // Apps, bundles and installers.
  'app', 'appex', 'bundle', 'framework', 'kext', 'plugin', 'prefpane', 'saver', 'qlgenerator', 'mdimporter', 'osax',
  'pkg', 'mpkg', 'dmg', 'jar', 'mobileconfig', 'configprofile', 'shortcut',
  // Launchers and links.
  'command', 'terminal', 'tool', 'workflow', 'action', 'fileloc', 'inetloc', 'webloc', 'url',
  // Scripts.
  'sh', 'zsh', 'bash', 'csh', 'ksh', 'tcsh', 'fish', 'py', 'pyw', 'rb', 'pl', 'scpt', 'scptd', 'applescript',
]);

/** Extensions macOS opens in a document app even when the file has its executable bit. */
const DOCUMENTS = new Set(['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'key', 'pages', 'numbers', '3mf', 'stl', 'obj', 'step', 'stp', 'zip', 'gz', 'tar', 'excalidraw', 'canvas', 'base']);

export type Openable = { action: 'open' } | { action: 'reveal'; reason: string } | { action: 'confirm' };

export const REVEAL_REASON = 'Opal shows apps and scripts in Finder instead of opening them.';

/**
 * The one check before Opal hands a file to another app: Open, Open in
 * default app and Quick Look all ask it. Launchers and scripts are shown
 * in Finder only, as is a file with its executable bit that macOS would
 * run in Terminal. A file outside the opened folders opens only after the
 * page has asked, naming the app.
 */
export async function openable(resolved: string, options: { inside: boolean }): Promise<Openable> {
  const name = path.basename(resolved);
  const extension = extensionOf(name);
  if (LAUNCHERS.has(extension)) return { action: 'reveal', reason: REVEAL_REASON };
  const info = await stat(resolved).catch(() => null);
  if (!info) throw new FilesError(`Could not find "${withoutHash(name)}".`);
  if (info.isFile() && (info.mode & 0o111) !== 0 && classifyFile(name) === 'other' && !DOCUMENTS.has(extension)) {
    return { action: 'reveal', reason: REVEAL_REASON };
  }
  if (!options.inside) return { action: 'confirm' };
  return { action: 'open' };
}

export interface OpenDependencies {
  /** Where read-only copies of LFS objects go, under Opal's app data. */
  copiesDir: string;
  openPath: (file: string) => Promise<string>;
  showItemInFolder: (file: string) => void;
  appName?: (file: string) => Promise<string | null>;
}

/**
 * Opens a resolved file in its app after `openable` allows it: shows a
 * launcher in Finder, asks first outside the opened folders (unless the
 * page already did), and opens an LFS file from a read-only copy of its
 * object, never the placeholder.
 */
export async function openFile(resolved: string, options: { inside: boolean; confirmed?: boolean }, deps: OpenDependencies): Promise<OpenResult> {
  const check = await openable(resolved, options);
  if (check.action === 'reveal') {
    deps.showItemInFolder(resolved);
    return { action: 'revealed', reason: check.reason };
  }
  const app = (await deps.appName?.(resolved).catch(() => null)) ?? null;
  if (check.action === 'confirm' && !options.confirmed) return { action: 'confirm', app };
  const real = await materialize(resolved, deps.copiesDir);
  if (!real) throw new FilesError(`"${withoutHash(path.basename(resolved))}" is not on this Mac yet. Download it first.`);
  const failure = await deps.openPath(real.path);
  if (failure) throw new FilesError(failure);
  return { action: 'opened', app, ...(real.copy ? { notice: READ_ONLY_NOTICE } : {}) };
}
