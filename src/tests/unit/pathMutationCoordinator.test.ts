import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPathMutationCoordinator,
  pathMutationCoordinator,
} from '@/renderer/features/disk-explorer/navigation/pathMutationCoordinator';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { entry } from '@/tests/helpers/diskApi';
import { openTabs, openedPath, tabPaths } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const NOTES = '/Vault/Notes';
const WRITING = '/Vault/Writing';
const NOTE = '/Vault/Notes/today.md';
const REMAPPED_NOTE = '/Vault/Writing/today.md';

beforeEach(() => {
  window.localStorage.clear();
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
    pendingAction: { kind: 'new-folder', target: NOTES },
    pendingDelete: NOTE,
  });
  openTabs([NOTE, '/Vault/keep.md']);
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

  it('reports a Move to Trash in Opal as a trashed removal', () => {
    const coordinator = createPathMutationCoordinator();
    const prepare = vi.fn(() => ({ commit: vi.fn(), rollback: vi.fn() }));
    coordinator.register({ id: 'listener', preparePathRemoval: prepare });
    expect(coordinator.applyTrash('relative.md')).toBe(false);
    expect(coordinator.applyTrash(`${NOTES}/`)).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith([NOTES], 'trashed');
  });

  it('atomically remaps disk state and tabs', () => {
    expect(
      pathMutationCoordinator.applyAppMutation({
        kind: 'rename',
        oldPath: NOTES,
        newPath: WRITING,
      })
    ).toBe(true);

    const disk = useDiskStore.getState();
    expect(disk.expanded).toEqual({ [ROOT]: true, [WRITING]: true });
    expect(disk.listings[NOTES]).toBeUndefined();
    expect(disk.listings[WRITING]?.[0]?.path).toBe(REMAPPED_NOTE);
    expect(disk.listings[ROOT]?.[0]).toMatchObject({
      path: WRITING,
      name: 'Writing',
    });
    expect(disk.pendingAction?.target).toBe(WRITING);
    expect(disk.pendingDelete).toBe(REMAPPED_NOTE);

    expect(tabPaths()).toEqual([REMAPPED_NOTE, '/Vault/keep.md']);
    expect(openedPath()).toBe(REMAPPED_NOTE);
  });

  it('conservatively clears removed state without guessing a remap', () => {
    pathMutationCoordinator.applyExternalRemoval([NOTES]);

    const disk = useDiskStore.getState();
    expect(disk.pendingAction).toBeNull();
    expect(disk.pendingDelete).toBeNull();
    expect(disk.expanded).toEqual({ [ROOT]: true });
    expect(disk.listings[NOTES]).toBeUndefined();
    expect(disk.listings[ROOT]?.map((item) => item.path)).toEqual([
      '/Vault/Photos-backup',
    ]);
    expect(tabPaths()).toEqual(['/Vault/keep.md']);
    expect(openedPath()).toBe('/Vault/keep.md');
  });

  it('purges a removed root across registered state', () => {
    pathMutationCoordinator.applyRootRemoval(ROOT);

    expect(useDiskStore.getState()).toMatchObject({
      roots: [],
      listings: {},
      expanded: {},
      pendingAction: null,
      pendingDelete: null,
    });
    expect(tabPaths()).toEqual([]);
    expect(useTabsStore.getState().activeId).toBeNull();
  });

  it('retains restored tabs only while they belong to an allowed root', () => {
    openTabs([NOTE, '/Removed/stale.md'], 1);

    expect(pathMutationCoordinator.reconcileAllowedRoots([ROOT])).toBe(true);

    expect(tabPaths()).toEqual([NOTE]);
    expect(openedPath()).toBe(NOTE);
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
      disk: useDiskStore.getState().listings,
      tabs: tabPaths(),
    };
    pathMutationCoordinator.applyAppMutation(mutation);

    expect(useDiskStore.getState().listings).toEqual(afterFirst.disk);
    expect(tabPaths()).toEqual(afterFirst.tabs);
  });
});
