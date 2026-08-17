import { vi } from 'vitest';
import type { DiskAPI } from '@/renderer/shared/types/diskApi';
import type { DiskEntry } from '@/types/disk';

/**
 * Installs a fake diskAPI on the real `window`.
 *
 * Deliberately assigns a property instead of `vi.stubGlobal('window', {...})`:
 * spreading `globalThis.window` copies only enumerable own properties, which
 * drops most of the happy-dom DOM surface and breaks Testing Library's
 * render() in every component test.
 */
export function installDiskApi(overrides: Partial<DiskAPI> = {}): DiskAPI {
  const api: DiskAPI = {
    openFolder: vi.fn(async () => ({ success: true as const, data: { root: null } })),
    listRoots: vi.fn(async () => ({ success: true as const, data: [] })),
    removeRoot: vi.fn(async () => ({ success: true as const, data: undefined })),
    readDirectory: vi.fn(async (dirPath: string) => ({
      success: true as const,
      data: { path: dirPath, entries: [] },
    })),
    readTextFile: vi.fn(async (target: string) => ({
      success: true as const,
      data: { path: target, text: '', truncated: false, size: 0 },
    })),
    reveal: vi.fn(async () => ({ success: true as const, data: undefined })),
    openExternal: vi.fn(async () => ({ success: true as const, data: undefined })),
    stat: vi.fn(),
    ...overrides,
  } as DiskAPI;

  (window as unknown as { diskAPI: DiskAPI }).diskAPI = api;
  return api;
}

/** Builds a DiskEntry with sensible defaults so tests only state what matters. */
export function entry(
  over: Partial<DiskEntry> & { path: string; name: string }
): DiskEntry {
  return { kind: 'other', isDirectory: false, size: 0, mtimeMs: 1, ...over };
}
