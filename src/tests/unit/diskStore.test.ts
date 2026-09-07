import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import { pathMutationCoordinator } from '@/renderer/features/disk-explorer/navigation/pathMutationCoordinator';
import type { DiskEntry } from '@/types/disk';

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
    listings: {},
    expanded: {},
    currentDirectory: null,
    currentCollection: null,
    focusedPath: null,
    selectedPath: null,
    selectedPaths: [],
    quickPreviewPath: null,
    isQuickLookOpen: false,
    pendingAction: null,
    pendingDelete: null,
    sort: { field: 'name', direction: 'asc' },
    filter: '',
    density: 'comfortable',
    loading: { isLoading: false, error: null },
  });
  useTabsStore.setState({
    openPaths: [],
    openedPath: null,
    activePath: null,
    previewPath: null,
  });

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
  it('loads roots on demand', async () => {
    await useDiskStore.getState().loadRoots();
    expect(useDiskStore.getState().roots).toEqual([ROOT]);
  });

  it('drops hydrated tabs outside the roots returned at launch', async () => {
    useTabsStore.setState({
      openPaths: ['/Removed/stale.md', '/Vault/note.md'],
      openedPath: '/Removed/stale.md',
      activePath: '/Removed/stale.md',
      previewPath: null,
    });

    await useDiskStore.getState().loadRoots();

    expect(useTabsStore.getState()).toMatchObject({
      openPaths: ['/Vault/note.md'],
      openedPath: '/Vault/note.md',
      activePath: '/Vault/note.md',
    });
  });

  it('opens a folder, adds it as a root, and loads its listing', async () => {
    await useDiskStore.getState().openFolder();
    const state = useDiskStore.getState();
    expect(state.roots).toContain(ROOT);
    expect(state.listings[ROOT]).toHaveLength(2);
    expect(state.currentDirectory).toBe(ROOT);
  });

  it('does not add a duplicate root when the same folder is opened twice', async () => {
    await useDiskStore.getState().openFolder();
    await useDiskStore.getState().openFolder();
    expect(useDiskStore.getState().roots).toEqual([ROOT]);
  });

  it('updates tab hydration authority when a root is added', async () => {
    await useDiskStore.getState().loadRoots();
    openFolder.mockResolvedValue({
      success: true,
      data: { root: OTHER_ROOT },
    });
    readDirectory.mockResolvedValue({
      success: true,
      data: { path: OTHER_ROOT, entries: [] },
    });
    await useDiskStore.getState().openFolder();

    useTabsStore.getState().openFile('/Other/note.md');
    useTabsStore.setState({
      openPaths: [],
      openedPath: null,
      activePath: null,
      previewPath: null,
    });
    useTabsStore.getState().hydrate();

    expect(useTabsStore.getState().openPaths).toEqual(['/Other/note.md']);
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

  it('selects an entry', () => {
    useDiskStore.getState().select('/Vault/note.md');
    expect(useDiskStore.getState().selectedPath).toBe('/Vault/note.md');
    expect(useDiskStore.getState().focusedPath).toBe('/Vault/note.md');
  });

  it('keeps browse directory independent from collection selection', () => {
    useDiskStore.setState({ currentDirectory: ROOT });
    useDiskStore.getState().select(PHOTOS);

    expect(useDiskStore.getState().currentDirectory).toBe(ROOT);
    expect(useDiskStore.getState().focusedPath).toBe(PHOTOS);
  });

  it('navigates explicitly and clears collection focus', () => {
    useDiskStore.getState().select('/Vault/note.md');
    useDiskStore.getState().navigateToDirectory(PHOTOS);

    expect(useDiskStore.getState()).toMatchObject({
      currentDirectory: PHOTOS,
      focusedPath: null,
      selectedPath: null,
      selectedPaths: [],
    });
  });

  it('tracks Quick Preview by path and follows focused selection', () => {
    useDiskStore.getState().select('/Vault/note.md');
    useDiskStore.getState().openQuickLook();
    expect(useDiskStore.getState().quickPreviewPath).toBe('/Vault/note.md');

    useDiskStore.getState().select('/Vault/other.md');
    expect(useDiskStore.getState().quickPreviewPath).toBe('/Vault/other.md');

    useDiskStore.getState().closeQuickLook();
    expect(useDiskStore.getState().quickPreviewPath).toBeNull();
  });

  it('selects all visible entries through a canonical action', () => {
    useDiskStore.getState().selectAll(rootEntries);

    expect(useDiskStore.getState().selectedPaths).toEqual(
      rootEntries.map((candidate) => candidate.path)
    );
    expect(useDiskStore.getState().focusedPath).toBe('/Vault/note.md');
    expect(useDiskStore.getState().selectedPath).toBe('/Vault/note.md');
  });

  it('starts a new-folder action for the current directory', () => {
    useDiskStore.getState().beginNewFolder(ROOT);
    expect(useDiskStore.getState().pendingAction).toEqual({
      kind: 'new-folder',
      target: ROOT,
    });
  });

  it('starts a rename action for the selected item', () => {
    useDiskStore.getState().beginRename('/Vault/note.md');
    expect(useDiskStore.getState().pendingAction).toEqual({
      kind: 'rename',
      target: '/Vault/note.md',
    });
  });

  it('cancels a pending action', () => {
    useDiskStore.setState({
      pendingAction: { kind: 'rename', target: '/Vault/note.md' },
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

  it('closes a root and drops its cached listing and selection', async () => {
    await useDiskStore.getState().openFolder();
    useDiskStore.getState().select('/Vault/note.md');
    await useDiskStore.getState().closeRoot(ROOT);

    const state = useDiskStore.getState();
    expect(state.roots).toEqual([]);
    expect(state.listings[ROOT]).toBeUndefined();
    expect(state.selectedPath).toBeNull();
  });

  it('updates tab hydration authority when a root is closed', async () => {
    await useDiskStore.getState().openFolder();
    await useDiskStore.getState().closeRoot(ROOT);

    useTabsStore.getState().openFile('/Vault/stale.md');
    useTabsStore.setState({
      openPaths: [],
      openedPath: null,
      activePath: null,
      previewPath: null,
    });
    useTabsStore.getState().hydrate();

    expect(useTabsStore.getState().openPaths).toEqual([]);
  });
});

describe('collections', () => {
  it('navigateToDirectory and navigateToRecent keep currentDirectory consistent and clear selection', () => {
    useDiskStore.getState().navigateToDirectory('/Vault/A');
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'directory', directory: '/Vault/A' });
    useDiskStore.getState().select('/Vault/A/x.md');
    useDiskStore.getState().navigateToRecent();
    const state = useDiskStore.getState();
    expect(state.currentCollection).toEqual({ kind: 'recent' });
    expect(state.currentDirectory).toBeNull();
    expect(state.selectedPaths).toEqual([]);
    expect(state.focusedPath).toBeNull();
  });

  it('loadRoots keeps a recent collection current instead of substituting a root', async () => {
    listRoots.mockResolvedValueOnce({ success: true, data: [ROOT] });
    useDiskStore.getState().navigateToRecent();
    await useDiskStore.getState().loadRoots();
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'recent' });
    expect(useDiskStore.getState().currentDirectory).toBeNull();
    // Without a collection, the first root becomes current as before.
    useDiskStore.setState({ currentCollection: null, currentDirectory: null });
    listRoots.mockResolvedValueOnce({ success: true, data: [ROOT] });
    await useDiskStore.getState().loadRoots();
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'directory', directory: ROOT });
  });

  it('remaps and removes the current directory collection with its path', () => {
    useDiskStore.setState({ roots: [ROOT] });
    useDiskStore.getState().navigateToDirectory('/Vault/Old');
    pathMutationCoordinator.applyAppMutation({ kind: 'rename', oldPath: '/Vault/Old', newPath: '/Vault/New' });
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'directory', directory: '/Vault/New' });
    pathMutationCoordinator.applyExternalRemoval(['/Vault/New']);
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'directory', directory: ROOT });
    useDiskStore.getState().navigateToRecent();
    pathMutationCoordinator.applyExternalRemoval(['/Vault/Photos']);
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'recent' });
    expect(useDiskStore.getState().currentDirectory).toBeNull();
  });
});
