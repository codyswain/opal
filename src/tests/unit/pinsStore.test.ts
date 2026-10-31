import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathMutationCoordinator } from '@/renderer/features/disk-explorer/navigation/pathMutationCoordinator';
import { usePinsStore } from '@/renderer/features/disk-explorer/store/pinsStore';
import { installPinsApi, setPins } from '@/tests/helpers/pinsApi';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastError }) }));

const ROOT = '/Vault';
const OTHER = '/Other';
const INVESTORS = '/Vault/Library/parametric/investors.md';
const README = '/Vault/README.md';
const PLAN = '/Other/plan.md';

const pins = () => usePinsStore.getState().byRoot;

beforeEach(() => {
  toastError.mockClear();
  setPins({});
});

describe('pins store', () => {
  it('loads every folder and which pins are missing', async () => {
    installPinsApi([
      { root: ROOT, pins: [INVESTORS, README], missing: [README] },
      { root: OTHER, pins: [], missing: [] },
    ]);
    await usePinsStore.getState().load();
    expect(pins()).toEqual({ [ROOT]: [INVESTORS, README], [OTHER]: [] });
    expect(usePinsStore.getState().missing).toEqual([README]);
  });

  it('pins at a place among its folder, moves a pinned file, and unpins, writing the whole list each time', () => {
    const api = installPinsApi();
    setPins({ [ROOT]: [INVESTORS], [OTHER]: [] });
    usePinsStore.getState().pin(README, 0);
    expect(pins()[ROOT]).toEqual([README, INVESTORS]);
    expect(api.set).toHaveBeenLastCalledWith(ROOT, [README, INVESTORS]);
    usePinsStore.getState().pin(README);
    expect(pins()[ROOT]).toEqual([INVESTORS, README]);
    usePinsStore.getState().toggle(PLAN);
    expect(api.set).toHaveBeenLastCalledWith(OTHER, [PLAN]);
    usePinsStore.getState().toggle(README);
    expect(pins()).toEqual({ [ROOT]: [INVESTORS], [OTHER]: [PLAN] });
    expect(api.set).toHaveBeenLastCalledWith(ROOT, [INVESTORS]);
  });

  it('writes nothing for a folder whose pins were not read', () => {
    const api = installPinsApi();
    usePinsStore.getState().pin(README);
    expect(api.set).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Opal could not read this folder's pins.");
  });

  it('carries a pin along a rename', () => {
    const api = installPinsApi();
    setPins({ [ROOT]: [README, INVESTORS] });
    pathMutationCoordinator.applyAppMutation({ kind: 'rename', oldPath: README, newPath: '/Vault/Start here.md' });
    expect(pins()[ROOT]).toEqual(['/Vault/Start here.md', INVESTORS]);
    expect(api.set).toHaveBeenCalledWith(ROOT, ['/Vault/Start here.md', INVESTORS]);
  });

  it('carries pins along a move of the file or of a folder above it', () => {
    const api = installPinsApi();
    setPins({ [ROOT]: [README, INVESTORS] }, [INVESTORS]);
    pathMutationCoordinator.applyAppMutation({ kind: 'move', oldPath: README, newPath: '/Vault/Archive/README.md' });
    pathMutationCoordinator.applyAppMutation({ kind: 'move', oldPath: '/Vault/Library/parametric', newPath: '/Vault/Archive/parametric' });
    expect(pins()[ROOT]).toEqual(['/Vault/Archive/README.md', '/Vault/Archive/parametric/investors.md']);
    expect(usePinsStore.getState().missing).toEqual(['/Vault/Archive/parametric/investors.md']);
    expect(api.set).toHaveBeenCalledTimes(2);

    // A move into another opened folder ends that folder's list.
    setPins({ [ROOT]: [README], [OTHER]: [PLAN] });
    pathMutationCoordinator.applyAppMutation({ kind: 'move', oldPath: README, newPath: '/Other/README.md' });
    expect(pins()).toEqual({ [ROOT]: [], [OTHER]: [PLAN, '/Other/README.md'] });
  });

  it('unpins a file moved to Trash in Opal, and keeps one that went away otherwise', () => {
    const api = installPinsApi();
    setPins({ [ROOT]: [README, INVESTORS] });
    pathMutationCoordinator.applyExternalRemoval([README]);
    expect(pins()[ROOT]).toEqual([README, INVESTORS]);
    expect(api.set).not.toHaveBeenCalled();

    pathMutationCoordinator.applyTrash('/Vault/Library');
    expect(pins()[ROOT]).toEqual([README]);
    expect(api.set).toHaveBeenCalledWith(ROOT, [README]);
  });

  it('forgets a closed folder, and drops a load that read the file before a change', async () => {
    type Listed = Awaited<ReturnType<Window['pinsAPI']['list']>>;
    let answer!: (value: Listed) => void;
    installPinsApi([], { list: vi.fn(() => new Promise<Listed>((resolve) => { answer = resolve; })) });
    setPins({ [ROOT]: [], [OTHER]: [PLAN] });
    const loading = usePinsStore.getState().load();
    usePinsStore.getState().pin(README);
    answer({ success: true, data: [{ root: ROOT, pins: [], missing: [] }] });
    await loading;
    expect(pins()[ROOT]).toEqual([README]);

    pathMutationCoordinator.reconcileAllowedRoots([ROOT]);
    expect(pins()).toEqual({ [ROOT]: [README] });
  });

  it('reads the file again after a write fails', async () => {
    const api = installPinsApi([{ root: ROOT, pins: [INVESTORS], missing: [] }], {
      set: vi.fn(async () => ({ success: false as const, error: 'Symlinks are not supported in vault folders.' })),
    });
    setPins({ [ROOT]: [INVESTORS] });
    usePinsStore.getState().unpin(INVESTORS);
    expect(pins()[ROOT]).toEqual([]);
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith('Symlinks are not supported in vault folders.'));
    await vi.waitFor(() => expect(pins()[ROOT]).toEqual([INVESTORS]));
    expect(api.list).toHaveBeenCalled();
  });
});
