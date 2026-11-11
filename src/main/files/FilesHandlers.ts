import type { IpcMain, OpenDialogOptions } from 'electron';
import path from 'path';
import { IMAGE_EXTENSIONS } from '@/common/fileKind';
import logger from '@/main/logger';
import { HiddenPathError, PathNotAllowedError } from '@/main/fs/RootRegistry';
import type { FilesResult, PickedFiles } from '@/types/files';
import { FilesError, type ImportSource } from './FileStore';
import type { FilesService } from './FilesService';
import type { VideoStills } from './videoStills';

export interface FilesHandlerDependencies {
  ipc: Pick<IpcMain, 'handle' | 'on'>;
  service: FilesService;
  /** Stills for YouTube and Loom cards, fetched only on Load preview. */
  stills?: VideoStills;
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

/** A size in pixels the page asks for, as a layout measures it: above 0 and up to 4096, or nothing. */
const isPixels = (value: unknown, optional = false): value is number | undefined =>
  (optional && value === undefined) || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 4096);

/** `{ visible?: boolean }`, `{ confirmed?: boolean }` or `{ anyType?: boolean }`, or nothing. */
const flags = (value: unknown, key: 'visible' | 'confirmed' | 'anyType'): { [name: string]: boolean } | null => {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object') return null;
  const flag = (value as Record<string, unknown>)[key];
  if (flag !== undefined && typeof flag !== 'boolean') return null;
  return { [key]: flag === true };
};

const isName = (value: unknown): value is string | undefined =>
  value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 255 && !value.includes('\0'));

export class FilesHandlers {
  constructor(private deps: FilesHandlerDependencies) {}

  registerAll(): void {
    const { ipc, service } = this.deps;
    ipc.handle('files:import', (_, page: unknown, source: unknown) =>
      isPath(page) && isSource(source) ? this.respond(() => service.import(page, source), 'Failed to add the file') : invalid());
    ipc.handle('files:pick-and-import', (_, page: unknown, options: unknown) => {
      const anyType = flags(options, 'anyType');
      return isPath(page) && anyType ? this.respond(() => this.pickAndImport(page, anyType.anyType), 'Failed to add the files') : invalid();
    });
    ipc.handle('files:status', (_, target: unknown) =>
      isPath(target) ? this.respond(() => service.status(target), 'Failed to check the file') : invalid());
    ipc.handle('files:fetch', (_, target: unknown) =>
      isPath(target) ? this.respond(() => service.fetch(target), 'Failed to download the file') : invalid());
    ipc.handle('files:info', (_, target: unknown) =>
      isPath(target) ? this.respond(() => service.info(target), 'Failed to read the file') : invalid());
    ipc.handle('files:thumbnail', (_, target: unknown, px: unknown, options: unknown) => {
      const visible = flags(options, 'visible');
      return isPath(target) && isPixels(px) && visible ? this.respond(() => service.thumbnail(target, Math.ceil(px), visible), 'Failed to draw the file') : invalid();
    });
    ipc.handle('files:rendition', (_, target: unknown, width: unknown, options: unknown) => {
      const visible = flags(options, 'visible');
      return isPath(target) && isPixels(width, true) && visible
        ? this.respond(() => service.rendition(target, width === undefined ? undefined : Math.ceil(width), visible), 'Failed to draw the picture')
        : invalid();
    });
    ipc.handle('files:open', (_, target: unknown, options: unknown) => {
      const confirmed = flags(options, 'confirmed');
      return isPath(target) && confirmed ? this.respond(() => service.open(target, confirmed), 'Failed to open the file') : invalid();
    });
    ipc.handle('files:app-name', (_, target: unknown) =>
      isPath(target) ? this.respond(() => service.appName(target), 'Failed to find the app') : invalid());
    ipc.handle('files:quick-look', (_, target: unknown, options: unknown) => {
      const confirmed = flags(options, 'confirmed');
      return isPath(target) && confirmed ? this.respond(() => service.quickLook(target, confirmed), 'Failed to show the file') : invalid();
    });
    ipc.handle('files:copy-file', (_, target: unknown) =>
      isPath(target) ? this.respond(() => service.copyFile(target), 'Failed to copy the file') : invalid());
    ipc.handle('files:copy-image', (_, target: unknown) =>
      isPath(target) ? this.respond(() => service.copyImage(target), 'Failed to copy the image') : invalid());
    ipc.handle('files:video-still', (_, address: unknown, options: unknown) => {
      const cached = options === undefined ? {} : options && typeof options === 'object' && typeof (options as { cached?: unknown }).cached === 'boolean' ? { cached: (options as { cached: boolean }).cached } : null;
      if (typeof address !== 'string' || address.length > 2048 || !cached || !this.deps.stills) return invalid();
      const stills = this.deps.stills;
      return this.respond(() => stills.still(address, cached), 'Failed to load the preview');
    });
    ipc.handle('files:save-copy', (_, target: unknown, name: unknown) =>
      isPath(target) && isName(name) ? this.respond(() => service.saveCopy(target, name), 'Failed to save a copy') : invalid());
    ipc.handle('files:find-moved', (_, target: unknown) =>
      isPath(target) ? this.respond(() => service.findMoved(target), 'Failed to look for the file') : invalid());
    // Sent from the page's dragstart, which can't wait for an answer.
    ipc.on('files:start-drag', (event, target: unknown) => {
      if (!isPath(target)) return;
      service.startDrag(event.sender, target).catch((error) => {
        if (!(error instanceof FilesError || error instanceof PathNotAllowedError || error instanceof HiddenPathError)) logger.error('Failed to drag a file', error instanceof Error ? error : undefined);
      });
    });
  }

  /**
   * Insert image, or Insert file with `anyType`: the open dialog, then each
   * picked file in order. One that fails is skipped with its reason.
   */
  private async pickAndImport(page: string, anyType = false): Promise<PickedFiles> {
    const picked = await this.deps.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      ...(anyType ? {} : { filters: [{ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }] }),
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
      if (error instanceof HiddenPathError) return { success: false, error: error.message, hidden: true };
      if (error instanceof FilesError || error instanceof PathNotAllowedError) return { success: false, error: error.message };
      logger.error(fallback, error instanceof Error ? error : undefined);
      return { success: false, error: fallback };
    }
  }
}
