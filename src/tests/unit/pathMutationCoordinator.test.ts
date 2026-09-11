import { beforeEach, describe, expect, it, vi } from 'vitest';
import { directoryCollection } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { filesLocationSnapshots } from '@/renderer/features/disk-explorer/navigation/filesLocationSnapshots';
import {
  createPathMutationCoordinator,
  pathMutationCoordinator,
} from '@/renderer/features/disk-explorer/navigation/pathMutationCoordinator';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { writePref } from '@/renderer/shared/prefs/prefs';
import { entry } from '@/tests/helpers/diskApi';

const ROOT = '/Vault';
const NOTES = '/Vault/Notes';
const WRITING = '/Vault/Writing';
const NOTE = '/Vault/Notes/today.md';
const REMAPPED_NOTE = '/Vault/Writing/today.md';

beforeEach(() => {
  window.localStorage.clear();
  filesLocationSnapshots.clear();
  useDiskStore.setState({
    roots: [ROOT],
    listings: {
      [ROOT]: [
        entry({
          path: NOTES,
          name: 'Notes',
          kind: 'directory',
          isDirectory: true,
        }),
        entry({
          path: '/Vault/Photos-backup',
          name: 'Photos-backup',
          kind: 'directory',
          isDirectory: true,
        }),
      ],
      [NOTES]: [entry({ path: NOTE, name: 'today.md', kind: 'markdown' })],
    },
    expanded: { [ROOT]: true, [NOTES]: true },
    currentDirectory: NOTES,
    focusedPath: NOTE,
    selectedPath: NOTE,
    selectedPaths: [NOTE],
    quickPreviewPath: NOTE,
    isQuickLookOpen: true,
    pendingAction: { kind: 'rename', target: NOTE },
    pendingDelete: NOTE,
  });
  useTabsStore.setState({
    openPaths: [NOTE, '/Vault/keep.md'],
    openedPath: NOTE,
    activePath: NOTE,
    previewPath: null,
  });
});

describe('path mutation coordination', () => {
  it('prepares every participant before committing any state', () => {
    const coordinator = createPathMutationCoordinator();
    const commit = vi.fn();
    const rollback = vi.fn();
    coordinator.register({
      id: 'first',
      prepareAppMutation: () => ({ commit, rollback }),
    });
    coordinator.register({
      id: 'second',
      prepareAppMutation: () => {
        throw new Error('Cannot prepare');
      },
    });

    expect(() =>
      coordinator.applyAppMutation({
        kind: 'rename',
        oldPath: NOTES,
        newPath: WRITING,
      })
    ).toThrow('Cannot prepare');
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it('rolls back every committed participant if a commit fails', () => {
    const coordinator = createPathMutationCoordinator();
    const value = { current: 'before' };
    coordinator.register({
      id: 'first',
      prepareAppMutation: () => ({
        commit: () => {
          value.current = 'changed';
        },
        rollback: () => {
          value.current = 'before';
        },
      }),
    });
    coordinator.register({
      id: 'second',
      prepareAppMutation: () => ({
        commit: () => {
          throw new Error('Cannot commit');
        },
        rollback: vi.fn(),
      }),
    });

    expect(() =>
      coordinator.applyAppMutation({
        kind: 'rename',
        oldPath: NOTES,
        newPath: WRITING,
      })
    ).toThrow('Cannot commit');
    expect(value.current).toBe('before');
  });

  it('rejects corrupt, no-op, and descendant mappings', () => {
    const coordinator = createPathMutationCoordinator();
    const prepare = vi.fn();
    coordinator.register({ id: 'listener', prepareAppMutation: prepare });

    expect(
      coordinator.applyAppMutation({
        kind: 'rename',
        oldPath: 'relative',
        newPath: WRITING,
      })
    ).toBe(false);
    expect(
      coordinator.applyAppMutation({
        kind: 'rename',
        oldPath: NOTES,
        newPath: NOTES,
      })
    ).toBe(false);
    expect(
      coordinator.applyAppMutation({
        kind: 'move',
        oldPath: NOTES,
        newPath: `${NOTES}/Archive`,
      })
    ).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('deduplicates nested external removals', () => {
    const coordinator = createPathMutationCoordinator();
    const prepare = vi.fn(() => ({
      commit: vi.fn(),
      rollback: vi.fn(),
    }));
    coordinator.register({ id: 'listener', preparePathRemoval: prepare });

    coordinator.applyExternalRemoval([
      `${NOTES}/Archive`,
      NOTES,
      `${NOTES}/Archive/draft.md`,
    ]);

    expect(prepare).toHaveBeenCalledWith([NOTES], 'external');
  });

  it('keeps its allowed-root authority aligned with root mutations', () => {
    const coordinator = createPathMutationCoordinator();
    coordinator.reconcileAllowedRoots([ROOT, '/Other']);
    coordinator.applyRootRemoval(ROOT);

    expect(coordinator.getAllowedRoots()).toEqual(['/Other']);
  });

  it('atomically remaps disk state, tabs, and location snapshots', () => {
    filesLocationSnapshots.capture(
      { mode: 'browse', collection: directoryCollection(NOTES)},
      {
        selectedPaths: [NOTE],
        focusedPath: NOTE,
        scroll: { view: 'details', offset: 120 },
      }
    );

    expect(
      pathMutationCoordinator.applyAppMutation({
        kind: 'rename',
        oldPath: NOTES,
        newPath: WRITING,
      })
    ).toBe(true);

    const disk = useDiskStore.getState();
    expect(disk.currentDirectory).toBe(WRITING);
    expect(disk.focusedPath).toBe(REMAPPED_NOTE);
    expect(disk.selectedPath).toBe(REMAPPED_NOTE);
    expect(disk.selectedPaths).toEqual([REMAPPED_NOTE]);
    expect(disk.quickPreviewPath).toBe(REMAPPED_NOTE);
    expect(disk.listings[NOTES]).toBeUndefined();
    expect(disk.listings[WRITING]?.[0]?.path).toBe(REMAPPED_NOTE);
    expect(disk.listings[ROOT]?.[0]).toMatchObject({
      path: WRITING,
      name: 'Writing',
    });
    expect(disk.pendingAction?.target).toBe(REMAPPED_NOTE);
    expect(disk.pendingDelete).toBe(REMAPPED_NOTE);

    expect(useTabsStore.getState()).toMatchObject({
      openPaths: [REMAPPED_NOTE, '/Vault/keep.md'],
      openedPath: REMAPPED_NOTE,
      activePath: REMAPPED_NOTE,
    });
    expect(
      filesLocationSnapshots.read({
        mode: 'browse',
        collection: directoryCollection(WRITING),
      })
    ).toMatchObject({
      selectedPaths: [REMAPPED_NOTE],
      focusedPath: REMAPPED_NOTE,
    });
  });

  it('conservatively clears removed state without guessing a remap', () => {
    pathMutationCoordinator.applyExternalRemoval([NOTES]);

    const disk = useDiskStore.getState();
    expect(disk.currentDirectory).toBe(ROOT);
    expect(disk.focusedPath).toBeNull();
    expect(disk.selectedPaths).toEqual([]);
    expect(disk.quickPreviewPath).toBeNull();
    expect(disk.isQuickLookOpen).toBe(false);
    expect(disk.listings[NOTES]).toBeUndefined();
    expect(disk.listings[ROOT]?.map((item) => item.path)).toEqual([
      '/Vault/Photos-backup',
    ]);
    expect(useTabsStore.getState()).toMatchObject({
      openPaths: ['/Vault/keep.md'],
      openedPath: '/Vault/keep.md',
      activePath: '/Vault/keep.md',
    });
  });

  it('purges a removed root across registered state', () => {
    pathMutationCoordinator.applyRootRemoval(ROOT);

    expect(useDiskStore.getState()).toMatchObject({
      roots: [],
      listings: {},
      expanded: {},
      currentDirectory: null,
      focusedPath: null,
      selectedPaths: [],
    });
    expect(useTabsStore.getState()).toMatchObject({
      openPaths: [],
      openedPath: null,
      activePath: null,
      previewPath: null,
    });
  });

  it('retains restored tabs only while they belong to an allowed root', () => {
    useTabsStore.setState({
      openPaths: [NOTE, '/Removed/stale.md'],
      openedPath: '/Removed/stale.md',
      activePath: '/Removed/stale.md',
      previewPath: null,
    });

    expect(pathMutationCoordinator.reconcileAllowedRoots([ROOT])).toBe(true);

    expect(useTabsStore.getState()).toMatchObject({
      openPaths: [NOTE],
      openedPath: NOTE,
      activePath: NOTE,
      previewPath: null,
    });

    writePref('tabs.open', [NOTE, '/Removed/restored.md']);
    useTabsStore.getState().hydrate();
    expect(useTabsStore.getState().openPaths).toEqual([NOTE]);
  });

  it('does not treat a similarly prefixed sibling as part of the subtree', () => {
    pathMutationCoordinator.applyExternalRemoval(['/Vault/Photos']);

    expect(useDiskStore.getState().listings[ROOT]?.map((item) => item.path)).toContain(
      '/Vault/Photos-backup'
    );
  });

  it('is state-idempotent if the same exact mapping is reported twice', () => {
    const mutation = {
      kind: 'rename' as const,
      oldPath: NOTES,
      newPath: WRITING,
    };
    pathMutationCoordinator.applyAppMutation(mutation);
    const afterFirst = {
      disk: useDiskStore.getState().selectedPaths,
      tabs: useTabsStore.getState().openPaths,
    };
    pathMutationCoordinator.applyAppMutation(mutation);

    expect(useDiskStore.getState().selectedPaths).toEqual(afterFirst.disk);
    expect(useTabsStore.getState().openPaths).toEqual(afterFirst.tabs);
  });
});
