import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * Channels the renderer invokes that the main process has never implemented.
 *
 * These are pre-existing and deliberately NOT fixed here — the features they
 * belong to (drag-to-embed, note move, note delete) are retired wholesale in a
 * later slice. Freezing them as a baseline means the test passes today while
 * still catching any NEW dead channel the moment it is introduced.
 *
 * This list may only shrink. If you implement a handler, delete its entry.
 */
const KNOWN_DEAD_CHANNELS: readonly string[] = [
  'create-embedded-item',
  'delete-embedded-item',
  'delete-note',
  'get-embedded-item',
  'get-note-embedded-items',
  'move-note',
  'update-embedded-item',
  'vfs:get-folder',
  'vfs:move-folder',
];

/** Recursively collect .ts files. Hand-rolled so this works on any Node 18+. */
function collectTsFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectTsFiles(full, found);
    else if (full.endsWith('.ts')) found.push(full);
  }
  return found;
}

/**
 * Matches ipcRenderer.invoke('x') and ipcRenderer.send('x') across newlines.
 * The [^'"`$] class excludes '$', which skips template literals containing an
 * interpolation — those channel names are dynamic and cannot be checked here.
 */
const INVOCATION = /ipcRenderer\s*\.\s*(?:invoke|send)\s*\(\s*(['"`])([^'"`$]+)\1/g;

/**
 * Matches .handle('x') and .on('x') on any receiver, which covers ipcMain
 * directly as well as the injected `this.deps.ipc` used by the handler classes.
 * Deliberately permissive: it also matches app.on('before-quit') and similar,
 * which can only mask a dead channel, never invent one.
 */
const REGISTRATION = /\.\s*(?:handle|on)\s*\(\s*(['"`])([^'"`$]+)\1/g;

function matchAll(source: string, pattern: RegExp): string[] {
  // Fresh lastIndex per call — these are module-level /g regexes.
  pattern.lastIndex = 0;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) found.push(match[2]);
  return found;
}

const preloadSource = readFileSync(path.join(REPO_ROOT, 'src/preload.ts'), 'utf-8');
const invokedChannels = [...new Set(matchAll(preloadSource, INVOCATION))].sort();

const mainSourceFiles = [
  ...collectTsFiles(path.join(REPO_ROOT, 'src/main')),
  path.join(REPO_ROOT, 'src/main.ts'),
];
const registeredChannels = new Set(
  mainSourceFiles.flatMap((file) => matchAll(readFileSync(file, 'utf-8'), REGISTRATION))
);

const deadChannels = invokedChannels
  .filter((channel) => !registeredChannels.has(channel))
  .sort();

describe('IPC contract between preload and main', () => {
  it('finds channels on both sides (guards against a silently broken scan)', () => {
    // If a refactor made these regexes match nothing, every other assertion in
    // this file would pass vacuously forever. Fail loudly instead.
    expect(invokedChannels.length).toBeGreaterThan(30);
    expect(registeredChannels.size).toBeGreaterThan(30);
  });

  it('introduces no new dead channels', () => {
    const introduced = deadChannels.filter((c) => !KNOWN_DEAD_CHANNELS.includes(c));
    expect(
      introduced,
      `preload.ts invokes ${introduced.length} channel(s) that no main-process ` +
        `handler registers:\n  ${introduced.join('\n  ')}\n\n` +
        `Register a handler (see src/main/services/vfs/VfsHandlers.ts for the ` +
        `pattern), or remove the call from preload.ts.`
    ).toEqual([]);
  });

  it('keeps the known-dead baseline from going stale', () => {
    const nowImplemented = KNOWN_DEAD_CHANNELS.filter((c) => !deadChannels.includes(c));
    expect(
      nowImplemented,
      `These channels are listed as known-dead but now HAVE handlers:\n  ` +
        `${nowImplemented.join('\n  ')}\n\n` +
        `Delete them from KNOWN_DEAD_CHANNELS in this file — the list may only shrink.`
    ).toEqual([]);
  });
});
