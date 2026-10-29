import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import type { DiskEntry } from '@/types/disk';
import { openedPath, openTabs, resetTabs, tabPaths } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const PHOTOS = '/Vault/Photos';
const OTHER_ROOT = '/Other';

const rootEntries: DiskEntry[] = [
  entry({ path: PHOTOS, name: 'Photos', kind: 'directory', isDirectory: true }),
  entry({ path: '/Vault/note.md', name: 'note.md', kind: 'markdown' }),
];

const photoEntries: DiskEntry[] = [
  entry({ path: '/Vault/Photos/a.jpg', name: 'a.jpg', kind: 'image', size: 100 }),
];

let readDirectory: ReturnType<typeof vi.fn>;
let openFolder: ReturnType<typeof vi.fn>;
let listRoots: ReturnType<typeof vi.fn>;
let removeRoot: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useDiskStore.setState({
    roots: [],
    rootsLoaded: false,
    listings: {},
    expanded: {},
    pendingAction: null,
    pendingDelete: null,
    loading: { isLoading: false, error: null },
  });
  resetTabs();

  readDirectory = vi.fn(async (p: string) => ({
    success: true,
    data: { path: p, entries: p === ROOT ? rootEntries : photoEntries },
  }));
  openFolder = vi.fn(async () => ({ success: true, data: { root: ROOT } }));
  listRoots = vi.fn(async () => ({ success: true as const, data: [ROOT] }));
  removeRoot = vi.fn(async () => ({ success: true }));

  // Assign the property rather than replacing `window` wholesale. Spreading
  // `globalThis.window` drops every non-enumerable DOM property, which breaks
  // Testing Library's render() in the component tests that follow.
  installDiskApi({ readDirectory, openFolder, listRoots, removeRoot, stat: vi.fn() });
});

describe('useDiskStore', () => {
  it('loads roots on demand and says when they are known', async () => {
    expect(useDiskStore.getState().rootsLoaded).toBe(false);
    await useDiskStore.getState().loadRoots();
    expect(useDiskStore.getState()).toMatchObject({ roots: [ROOT], rootsLoaded: true });
  });

  it('counts a failed root listing as known, so the page can still offer Open folder', async () => {
    listRoots.mockResolvedValueOnce({ success: false, error: 'Nope' });
    await useDiskStore.getState().loadRoots();
    expect(useDiskStore.getState()).toMatchObject({ roots: [], rootsLoaded: true, loading: { error: 'Nope' } });
  });

  it('drops hydrated tabs outside the roots returned at launch', async () => {
    openTabs(['/Removed/stale.md', '/Vault/note.md'], 0);

    await useDiskStore.getState().loadRoots();

    expect(tabPaths()).toEqual(['/Vault/note.md']);
    expect(openedPath()).toBe('/Vault/note.md');
  });

  it('opens a folder, adds it as a root, and loads its listing', async () => {
    await useDiskStore.getState().openFolder();
    const state = useDiskStore.getState();
    expect(state.roots).toContain(ROOT);
    expect(state.listings[ROOT]).toHaveLength(2);
    expect(state.expanded[ROOT]).toBe(true);
  });

  it('does not add a duplicate root when the same folder is opened twice', async () => {
    await useDiskStore.getState().openFolder();
    await useDiskStore.getState().openFolder();
    expect(useDiskStore.getState().roots).toEqual([ROOT]);
  });

  it('leaves state untouched when the dialog is cancelled', async () => {
    openFolder.mockResolvedValue({ success: true, data: { root: null } });
    await useDiskStore.getState().openFolder();
    expect(useDiskStore.getState().roots).toEqual([]);
  });

  it('caches a listing and does not re-read it', async () => {
    await useDiskStore.getState().loadDirectory(ROOT);
    await useDiskStore.getState().loadDirectory(ROOT);
    expect(readDirectory).toHaveBeenCalledTimes(1);
  });

  it('re-reads a listing when forced', async () => {
    await useDiskStore.getState().loadDirectory(ROOT);
    await useDiskStore.getState().loadDirectory(ROOT, { force: true });
    expect(readDirectory).toHaveBeenCalledTimes(2);
  });

  it('invalidates only cached directories and force-reloads them', async () => {
    useDiskStore.setState({
      listings: {
        [ROOT]: rootEntries,
        [PHOTOS]: photoEntries,
      },
    });

    await useDiskStore.getState().invalidate([ROOT, '/Vault/Missing']);

    expect(readDirectory).toHaveBeenCalledTimes(1);
    expect(readDirectory).toHaveBeenCalledWith(ROOT);
  });

  it('records an error when a read fails, without throwing', async () => {
    readDirectory.mockResolvedValue({ success: false, error: 'Nope' });
    await useDiskStore.getState().loadDirectory(ROOT);
    expect(useDiskStore.getState().loading.error).toBe('Nope');
    expect(useDiskStore.getState().listings[ROOT]).toBeUndefined();
  });

  it('keeps an error when a different folder then loads fine', async () => {
    readDirectory.mockResolvedValueOnce({ success: false, error: 'Nope' });
    await useDiskStore.getState().loadDirectory(PHOTOS);
    await useDiskStore.getState().loadDirectory(ROOT);
    expect(useDiskStore.getState().loading).toEqual({ isLoading: false, error: 'Nope' });
  });

  it('loads children the first time a folder is expanded', async () => {
    await useDiskStore.getState().toggleExpanded(PHOTOS);
    expect(useDiskStore.getState().expanded[PHOTOS]).toBe(true);
    expect(useDiskStore.getState().listings[PHOTOS]).toHaveLength(1);
  });

  it('collapsing does not discard the cached listing', async () => {
    await useDiskStore.getState().toggleExpanded(PHOTOS);
    await useDiskStore.getState().toggleExpanded(PHOTOS);
    expect(useDiskStore.getState().expanded[PHOTOS]).toBe(false);
    expect(useDiskStore.getState().listings[PHOTOS]).toHaveLength(1);
    expect(readDirectory).toHaveBeenCalledTimes(1);
  });

  it('starts a new-folder action for the current directory', () => {
    useDiskStore.getState().beginNewFolder(ROOT);
    expect(useDiskStore.getState().pendingAction).toEqual({
      kind: 'new-folder',
      target: ROOT,
    });
  });

  it('cancels a pending action', () => {
    useDiskStore.setState({
      pendingAction: { kind: 'new-folder', target: ROOT },
    });

    useDiskStore.getState().cancelAction();
    expect(useDiskStore.getState().pendingAction).toBeNull();
  });

  it('clears a recorded error', async () => {
    readDirectory.mockResolvedValue({ success: false, error: 'Nope' });
    await useDiskStore.getState().loadDirectory(ROOT);
    expect(useDiskStore.getState().loading.error).toBe('Nope');

    useDiskStore.getState().clearError();
    expect(useDiskStore.getState().loading.error).toBeNull();
  });

  it('closes a root and drops its cached listing and pending actions', async () => {
    await useDiskStore.getState().openFolder();
    useDiskStore.getState().beginDelete('/Vault/note.md');
    await useDiskStore.getState().closeRoot(ROOT);

    const state = useDiskStore.getState();
    expect(state.roots).toEqual([]);
    expect(state.listings[ROOT]).toBeUndefined();
    expect(state.pendingDelete).toBeNull();
  });
});

describe('tree expansion', () => {
  it('collapses and reopens one of several roots, which start open', async () => {
    useDiskStore.setState({ roots: [ROOT, OTHER_ROOT] });
    await useDiskStore.getState().toggleExpanded(ROOT);
    expect(useDiskStore.getState().expanded[ROOT]).toBe(false);
    await useDiskStore.getState().toggleExpanded(ROOT);
    expect(useDiskStore.getState().expanded[ROOT]).toBe(true);
  });

  it('loads open roots and the expanded folders they show, and nothing hidden', async () => {
    useDiskStore.setState({
      roots: [ROOT],
      expanded: { [PHOTOS]: true, '/Vault/Closed/Deep': true },
    });
    await useDiskStore.getState().loadTree();
    expect(readDirectory.mock.calls.map(([path]) => path).sort()).toEqual([ROOT, PHOTOS]);
  });

  it('expands and loads every folder above a revealed path', async () => {
    useDiskStore.setState({ roots: [ROOT] });
    await useDiskStore.getState().revealPath('/Vault/Photos/a.jpg');
    expect(useDiskStore.getState().expanded[PHOTOS]).toBe(true);
    expect(useDiskStore.getState().listings[PHOTOS]).toHaveLength(1);
    expect(useDiskStore.getState().listings[ROOT]).toHaveLength(2);

    readDirectory.mockClear();
    await useDiskStore.getState().revealPath('/Outside/file.md');
    expect(readDirectory).not.toHaveBeenCalled();
  });

  it('forgets folders moved away while Opal was closed, without reading them or raising an error', async () => {
    const gone = '/Vault/Gone';
    readDirectory.mockImplementation(async (p: string) =>
      p === ROOT || p === PHOTOS
        ? { success: true, data: { path: p, entries: p === ROOT ? rootEntries : photoEntries } }
        : { success: false, error: `Path is not inside any folder you have opened: ${p}` }
    );
    useDiskStore.setState({
      roots: [ROOT],
      expanded: { [PHOTOS]: true, [gone]: true, [`${gone}/Deeper`]: true },
    });

    await useDiskStore.getState().loadTree();
    await useDiskStore.getState().revealPath(`${gone}/Deeper/note.md`);

    expect(readDirectory.mock.calls.map(([path]) => path).sort()).toEqual([ROOT, PHOTOS]);
    expect(useDiskStore.getState().expanded).toEqual({ [PHOTOS]: true });
    expect(readPref('tree.expanded', null)).toEqual({ [PHOTOS]: true });
    expect(useDiskStore.getState().loading.error).toBeNull();
  });

  it('persists expanded folders and a collapsed root, but not collapsed folders', async () => {
    useDiskStore.setState({ roots: [ROOT, OTHER_ROOT] });
    await useDiskStore.getState().toggleExpanded(PHOTOS);
    await useDiskStore.getState().toggleExpanded(OTHER_ROOT);
    expect(readPref('tree.expanded', null)).toEqual({ [PHOTOS]: true, [OTHER_ROOT]: false });

    await useDiskStore.getState().toggleExpanded(PHOTOS);
    expect(readPref('tree.expanded', null)).toEqual({ [OTHER_ROOT]: false });
  });

  it('restores expanded folders at launch and forgets those outside the opened roots', async () => {
    writePref('tree.expanded', { [PHOTOS]: true, '/Gone/A': true, '/Vault/bad': 'yes' });
    vi.resetModules();
    const { useDiskStore: launched } = await import(
      '@/renderer/features/disk-explorer/store/diskStore'
    );
    expect(launched.getState().expanded).toEqual({ [PHOTOS]: true, '/Gone/A': true });

    await launched.getState().loadRoots();
    expect(launched.getState().expanded).toEqual({ [PHOTOS]: true });
  });
});
