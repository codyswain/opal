import type { IpcMain, OpenDialogOptions } from 'electron';
import path from 'path';
import { IMAGE_EXTENSIONS } from '@/common/fileKind';
import logger from '@/main/logger';
import { PathNotAllowedError } from '@/main/fs/RootRegistry';
import type { FilesResult, PickedFiles } from '@/types/files';
import { FilesError, type ImportSource } from './FileStore';
import type { FilesService } from './FilesService';

export interface FilesHandlerDependencies {
  ipc: Pick<IpcMain, 'handle'>;
  service: FilesService;
  showOpenDialog: (options: OpenDialogOptions) => Promise<{ canceled: boolean; filePaths: string[] }>;
}

const isPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 32768 && !value.includes('\0') && path.isAbsolute(value);

/** A path from a drop, which preload read off the dropped File, or the bytes and name of a pasted one. */
function isSource(value: unknown): value is ImportSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  if ('path' in source) return isPath(source.path);
  return source.bytes instanceof Uint8Array && typeof source.name === 'string' && source.name.length > 0 && source.name.length <= 255;
}

const invalid = (): FilesResult<never> => ({ success: false, error: 'Invalid files request.' });

export class FilesHandlers {
  constructor(private deps: FilesHandlerDependencies) {}

  registerAll(): void {
    const { ipc, service } = this.deps;
    ipc.handle('files:import', (_, page: unknown, source: unknown) =>
      isPath(page) && isSource(source) ? this.respond(() => service.import(page, source), 'Failed to add the file') : invalid());
    ipc.handle('files:pick-and-import', (_, page: unknown) =>
      isPath(page) ? this.respond(() => this.pickAndImport(page), 'Failed to add the images') : invalid());
    ipc.handle('files:status', (_, target: unknown) =>
      isPath(target) ? this.respond(() => service.status(target), 'Failed to check the file') : invalid());
    ipc.handle('files:fetch', (_, target: unknown) =>
      isPath(target) ? this.respond(() => service.fetch(target), 'Failed to download the file') : invalid());
  }

  /** Insert image: the open dialog, then each picked image in order. One that fails is skipped with its reason. */
  private async pickAndImport(page: string): Promise<PickedFiles> {
    const picked = await this.deps.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }],
    });
    const result: PickedFiles = { files: [], skipped: [] };
    if (picked.canceled) return result;
    for (const file of picked.filePaths) {
      try {
        result.files.push(await this.deps.service.import(page, { path: file }));
      } catch (error) {
        if (!(error instanceof FilesError)) logger.error('Failed to add a picked image', error instanceof Error ? error : undefined);
        result.skipped.push(error instanceof FilesError ? error.message : `"${path.basename(file)}" could not be added.`);
      }
    }
    return result;
  }

  private async respond<T>(operation: () => Promise<T>, fallback: string): Promise<FilesResult<T>> {
    try {
      return { success: true, data: await operation() };
    } catch (error) {
      if (error instanceof FilesError || error instanceof PathNotAllowedError) return { success: false, error: error.message };
      logger.error(fallback, error instanceof Error ? error : undefined);
      return { success: false, error: fallback };
    }
  }
}
