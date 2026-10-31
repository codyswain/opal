import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePinsSync } from '@/renderer/features/disk-explorer/hooks/usePinsSync';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { usePinsStore } from '@/renderer/features/disk-explorer/store/pinsStore';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { installPinsApi, setPins } from '@/tests/helpers/pinsApi';
import type { DiskEntry } from '@/types/disk';
import type { PinsAPI, RootPins } from '@/types/pins';

const ROOT = '/Vault';
const OTHER = '/Other';
const NOTES = '/Vault/Notes';
const A = '/Vault/Notes/a.md';
const B = '/Vault/Notes/b.md';
const PLAN = '/Vault/Projects/plan.md';

const file = (path: string) => entry({ path, name: path.slice(path.lastIndexOf('/') + 1), kind: 'markdown' });

let changed: (payload: { directories: string[] }) => void;
let answer: RootPins[];
let api: PinsAPI;

/** Lets the pending list call answer and the store take it. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  installDiskApi({
    onChanged: vi.fn((callback) => {
      changed = callback;
      return () => undefined;
    }),
  });
  answer = [{ root: ROOT, pins: [A, PLAN], missing: [] }];
  api = installPinsApi([], { list: vi.fn(async () => ({ success: true as const, data: answer })) });
  setPins({});
  useDiskStore.setState({ roots: [ROOT], listings: { [NOTES]: [file(A), file(B)] } });
});

describe('usePinsSync', () => {
  it('reads the pins at start and again when the window gains focus, as after a pull from another Mac', async () => {
    renderHook(() => usePinsSync());
    await settle();
    expect(usePinsStore.getState().byRoot).toEqual({ [ROOT]: [A, PLAN] });

    answer = [{ root: ROOT, pins: [A, PLAN, B], missing: [] }];
    act(() => window.dispatchEvent(new Event('focus')));
    await settle();
    expect(usePinsStore.getState().byRoot).toEqual({ [ROOT]: [A, PLAN, B] });
  });

  it('reads them again when the opened folders change', async () => {
    renderHook(() => usePinsSync());
    await settle();
    answer = [...answer, { root: OTHER, pins: [], missing: [] }];
    act(() => useDiskStore.setState({ roots: [ROOT, OTHER] }));
    await settle();
    expect(usePinsStore.getState().byRoot).toEqual({ [ROOT]: [A, PLAN], [OTHER]: [] });
  });

  it('reads them again when a pinned file comes or goes, but not when a pinned page is saved', async () => {
    renderHook(() => usePinsSync());
    await settle();
    vi.mocked(api.list).mockClear();
    const relist = (entries: DiskEntry[]) =>
      act(() => useDiskStore.setState((state) => ({ listings: { ...state.listings, [NOTES]: entries } })));

    // A save in a folder the tree lists: the folder is read again and a.md is still there.
    act(() => changed({ directories: [NOTES] }));
    relist([file(A), file(B)]);
    await settle();
    expect(api.list).not.toHaveBeenCalled();

    // a.md goes away outside Opal.
    answer = [{ root: ROOT, pins: [A, PLAN], missing: [A] }];
    relist([file(B)]);
    await settle();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(usePinsStore.getState().missing).toEqual([A]);

    // It comes back.
    answer = [{ root: ROOT, pins: [A, PLAN], missing: [] }];
    relist([file(A), file(B)]);
    await settle();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(usePinsStore.getState().missing).toEqual([]);

    // A folder the tree has not listed is not read again here, so the pins are.
    act(() => changed({ directories: ['/Vault/Projects'] }));
    await settle();
    expect(api.list).toHaveBeenCalledTimes(3);
    act(() => changed({ directories: ['/Vault/Elsewhere'] }));
    await settle();
    expect(api.list).toHaveBeenCalledTimes(3);
  });
});
