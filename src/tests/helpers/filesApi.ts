import { vi } from 'vitest';
import { classifyFile } from '@/common/fileKind';
import type { FilesAPI } from '@/renderer/shared/types/filesApi';
import type { ImportedFile } from '@/types/files';

/** Where the fake store puts a file named `name`: Library/files/2026-11, with a fixed hash. */
export function storedFile(name: string): ImportedFile {
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const vaultPath = `Library/files/2026-11/${stem}.a3f9c2e1${dot > 0 ? name.slice(dot).toLowerCase() : ''}`;
  return { path: `/Vault/${vaultPath}`, vaultPath, name };
}

/**
 * Installs a fake filesAPI on the real `window`; see installDiskApi for why.
 * `import` stores every file as `storedFile` names it, `hasPath` says no
 * file has a path, every stored file is here, and `info` reads every
 * picture as a 1600 by 1000 Retina screenshot.
 */
export function installFilesApi(overrides: Partial<FilesAPI> = {}): FilesAPI {
  const api: FilesAPI = {
    import: vi.fn(async (_page: string, file: File) => ({ success: true as const, data: storedFile(file.name) })),
    hasPath: vi.fn(() => false),
    pickAndImport: vi.fn(async () => ({ success: true as const, data: { files: [], skipped: [] } })),
    status: vi.fn(async () => ({ success: true as const, data: 'here' as const })),
    fetch: vi.fn(async () => ({ success: true as const, data: 'here' as const })),
    // Every picture is a 1600 by 1000 Retina screenshot.
    info: vi.fn(async (target: string) => {
      const name = target.slice(target.lastIndexOf('/') + 1);
      const kind = classifyFile(name);
      const size = kind === 'image' ? { width: 1600, height: 1000, retina: true } : {};
      return { success: true as const, data: { path: target, name, size: 1, mtimeMs: 0, kind, status: 'local' as const, ...size } };
    }),
    thumbnail: vi.fn(async () => ({ success: true as const, data: null })),
    rendition: vi.fn(async () => ({ success: true as const, data: null })),
    open: vi.fn(async () => ({ success: true as const, data: { action: 'opened' as const, app: null } })),
    appName: vi.fn(async () => ({ success: true as const, data: null })),
    quickLook: vi.fn(async () => ({ success: true as const, data: { action: 'opened' as const, app: null } })),
    copyFile: vi.fn(async () => ({ success: true as const, data: undefined })),
    copyImage: vi.fn(async () => ({ success: true as const, data: undefined })),
    saveCopy: vi.fn(async () => ({ success: true as const, data: { saved: null } })),
    startDrag: vi.fn(),
    findMoved: vi.fn(async () => ({ success: true as const, data: null })),
    ...overrides,
  };
  (window as unknown as { filesAPI: FilesAPI }).filesAPI = api;
  return api;
}
