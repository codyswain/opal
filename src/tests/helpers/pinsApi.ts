import { vi } from 'vitest';
import { usePinsStore } from '@/renderer/features/disk-explorer/store/pinsStore';
import type { PinsAPI, RootPins } from '@/types/pins';

/**
 * Installs a fake pinsAPI on the real `window`; see installDiskApi for why.
 * `list` answers with `folders`, and `set` stores what it is given, so a
 * later `list` reads it back as the main process would.
 */
export function installPinsApi(folders: RootPins[] = [], overrides: Partial<PinsAPI> = {}): PinsAPI {
  let stored = folders.map((folder) => ({ ...folder }));
  const api: PinsAPI = {
    list: vi.fn(async () => ({ success: true as const, data: stored })),
    set: vi.fn(async (root: string, pins: string[]) => {
      const folder: RootPins = { root, pins, missing: [] };
      stored = [...stored.filter((other) => other.root !== root), folder];
      return { success: true as const, data: folder };
    }),
    ...overrides,
  };
  (window as unknown as { pinsAPI: PinsAPI }).pinsAPI = api;
  return api;
}

/** Puts pins straight into the store, as a finished load would. */
export function setPins(byRoot: Record<string, string[]>, missing: string[] = []): void {
  usePinsStore.setState({ byRoot, missing });
}
