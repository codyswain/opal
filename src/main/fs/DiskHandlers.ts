import type { IpcMain, OpenDialogReturnValue } from 'electron';
import type { IPCResponse } from '@/types/ipc';
import type { DiskEntry, DirectoryListing, TextFileContents } from '@/types/disk';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { PathNotAllowedError } from '@/main/fs/RootRegistry';
import type { DiskReader } from '@/main/fs/DiskReader';
import logger from '@/main/logger';

export interface DiskHandlerDependencies {
  ipc: IpcMain;
  registry: RootRegistry;
  reader: DiskReader;
  /** Injected so the dialog can be stubbed in tests. */
  showOpenDialog: () => Promise<OpenDialogReturnValue>;
}

export class DiskHandlers {
  private deps: DiskHandlerDependencies;

  constructor(deps: DiskHandlerDependencies) {
    this.deps = deps;
  }

  registerAll(): void {
    this.registerOpenFolder();
    this.registerListRoots();
    this.registerRemoveRoot();
    this.registerReadDirectory();
    this.registerReadTextFile();
    this.registerStat();
  }

  private registerOpenFolder(): void {
    this.deps.ipc.handle(
      'disk:open-folder',
      async (): Promise<IPCResponse<{ root: string | null }>> => {
        try {
          const result = await this.deps.showOpenDialog();
          if (result.canceled || result.filePaths.length === 0) {
            return { success: true, data: { root: null } };
          }
          const root = await this.deps.registry.add(result.filePaths[0]);
          return { success: true, data: { root } };
        } catch (error) {
          logger.error('Error opening folder:', error);
          return { success: false, error: 'Failed to open folder' };
        }
      }
    );
  }

  private registerListRoots(): void {
    this.deps.ipc.handle('disk:list-roots', async (): Promise<IPCResponse<string[]>> => {
      try {
        return { success: true, data: this.deps.registry.list() };
      } catch (error) {
        logger.error('Error listing roots:', error);
        return { success: false, error: 'Failed to list folders' };
      }
    });
  }

  private registerRemoveRoot(): void {
    this.deps.ipc.handle(
      'disk:remove-root',
      async (_, rootPath: string): Promise<IPCResponse> => {
        try {
          await this.deps.registry.remove(rootPath);
          return { success: true };
        } catch (error) {
          logger.error('Error removing root:', error);
          return { success: false, error: 'Failed to close folder' };
        }
      }
    );
  }

  private registerReadDirectory(): void {
    this.deps.ipc.handle(
      'disk:read-directory',
      async (_, dirPath: string): Promise<IPCResponse<DirectoryListing>> => {
        try {
          const listing = await this.deps.reader.readDirectory(dirPath);
          return { success: true, data: listing };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to read folder') };
        }
      }
    );
  }

  private registerStat(): void {
    this.deps.ipc.handle(
      'disk:stat',
      async (_, target: string): Promise<IPCResponse<DiskEntry>> => {
        try {
          const entry = await this.deps.reader.statEntry(target);
          return { success: true, data: entry };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to read file') };
        }
      }
    );
  }

  private registerReadTextFile(): void {
    this.deps.ipc.handle(
      'disk:read-text-file',
      async (_, target: string): Promise<IPCResponse<TextFileContents>> => {
        try {
          const contents = await this.deps.reader.readTextFile(target);
          return { success: true, data: contents };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to read file') };
        }
      }
    );
  }
}

/**
 * PathNotAllowedError is the one failure the user can act on ("you haven't
 * opened that folder"), so its message is surfaced. Everything else is logged
 * and reported generically rather than leaking internals to the renderer.
 */
function describeError(error: unknown, fallback: string): string {
  if (error instanceof PathNotAllowedError) return error.message;
  if (error instanceof Error && /not a directory/i.test(error.message)) {
    return error.message;
  }
  logger.error(fallback, error instanceof Error ? error : undefined);
  return fallback;
}
