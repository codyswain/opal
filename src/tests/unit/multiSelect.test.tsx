import { describe, it, expect, beforeEach } from 'vitest';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import type { DiskEntry } from '@/types/disk';

const ENTRIES: DiskEntry[] = ['a', 'b', 'c', 'd', 'e'].map((n) =>
  entry({ path: `/V/${n}`, name: n })
);

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({
    focusedPath: null,
    selectedPath: null,
    selectedPaths: [],
    quickPreviewPath: null,
    isQuickLookOpen: false,
  });
});

describe('multi-select', () => {
  it('select replaces the whole selection', () => {
    useDiskStore.getState().select('/V/a');
    useDiskStore.getState().select('/V/b');

    expect(useDiskStore.getState().selectedPath).toBe('/V/b');
    expect(useDiskStore.getState().focusedPath).toBe('/V/b');
    expect(useDiskStore.getState().selectedPaths).toEqual(['/V/b']);
  });

  it('toggle adds and removes', () => {
    useDiskStore.getState().select('/V/a');
    useDiskStore.getState().toggleSelected('/V/c');
    expect(useDiskStore.getState().selectedPaths).toEqual(['/V/a', '/V/c']);

    useDiskStore.getState().toggleSelected('/V/a');
    expect(useDiskStore.getState().selectedPaths).toEqual(['/V/c']);
  });

  it('toggle moves the anchor to the newly added item', () => {
    useDiskStore.getState().select('/V/a');
    useDiskStore.getState().toggleSelected('/V/c');
    expect(useDiskStore.getState().selectedPath).toBe('/V/c');
  });

  it('range selects everything between the anchor and the target', () => {
    useDiskStore.getState().select('/V/b');
    useDiskStore.getState().selectRange(ENTRIES, '/V/d');
    expect(useDiskStore.getState().selectedPaths).toEqual(['/V/b', '/V/c', '/V/d']);
  });

  it('range works backwards', () => {
    useDiskStore.getState().select('/V/d');
    useDiskStore.getState().selectRange(ENTRIES, '/V/b');
    expect(useDiskStore.getState().selectedPaths).toEqual(['/V/b', '/V/c', '/V/d']);
  });

  it('range with no anchor selects just the target', () => {
    useDiskStore.getState().selectRange(ENTRIES, '/V/c');
    expect(useDiskStore.getState().selectedPaths).toEqual(['/V/c']);
  });

  it('clearing empties both fields', () => {
    useDiskStore.getState().select('/V/a');
    useDiskStore.getState().clearSelection();

    expect(useDiskStore.getState().selectedPath).toBeNull();
    expect(useDiskStore.getState().focusedPath).toBeNull();
    expect(useDiskStore.getState().selectedPaths).toEqual([]);
  });

  it('removing the last toggled item leaves no anchor', () => {
    useDiskStore.getState().select('/V/a');
    useDiskStore.getState().toggleSelected('/V/a');

    expect(useDiskStore.getState().selectedPaths).toEqual([]);
    expect(useDiskStore.getState().selectedPath).toBeNull();
  });
});
