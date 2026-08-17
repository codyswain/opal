import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import type { DiskEntry } from '@/types/disk';

const ROOT = '/Vault';
const PHOTOS = '/Vault/Photos';

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
    roots: [], listings: {}, expanded: {}, selectedPath: null,
    sort: { field: 'name', direction: 'asc' },
    loading: { isLoading: false, error: null },
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

  it('opens a folder, adds it as a root, and loads its listing', async () => {
    await useDiskStore.getState().openFolder();
    const state = useDiskStore.getState();
    expect(state.roots).toContain(ROOT);
    expect(state.listings[ROOT]).toHaveLength(2);
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
});
