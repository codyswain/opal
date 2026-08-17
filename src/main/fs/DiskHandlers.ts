import type { IpcMain, OpenDialogReturnValue } from 'electron';
import type { IPCResponse } from '@/types/ipc';
import type { DiskEntry, DirectoryListing, TextFileContents } from '@/types/disk';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { PathNotAllowedError } from '@/main/fs/RootRegistry';
import type { DiskReader } from '@/main/fs/DiskReader';
import type { FileWriter } from '@/main/fs/FileWriter';
import { DestinationExistsError, InvalidNameError } from '@/main/fs/FileWriter';
import logger from '@/main/logger';

export interface DiskShell {
  showItemInFolder: (fullPath: string) => void;
  /** Electron returns '' on success, or an error string on failure. */
  openPath: (fullPath: string) => Promise<string>;
}

export interface DiskHandlerDependencies {
  ipc: IpcMain;
  registry: RootRegistry;
  reader: DiskReader;
  /** Injected so the dialog can be stubbed in tests. */
  showOpenDialog: () => Promise<OpenDialogReturnValue>;
  shell: DiskShell;
  watcher: {
    watch: (rootPath: string) => Promise<void>;
    unwatch: (rootPath: string) => Promise<void>;
  };
  writer: FileWriter;
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
    this.registerCreateDirectory();
    this.registerReadTextFile();
    this.registerRename();
    this.registerMove();
    this.registerTrash();
    this.registerReveal();
    this.registerOpenExternal();
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
          await this.deps.watcher.watch(root);
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
          await this.deps.watcher.unwatch(rootPath);
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

  private registerCreateDirectory(): void {
    this.deps.ipc.handle(
      'disk:create-directory',
      async (_, parentDir: string, name: string): Promise<IPCResponse<{ path: string }>> => {
        try {
          const created = await this.deps.writer.createDirectory(parentDir, name);
          return { success: true, data: { path: created } };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to create folder') };
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

  private registerRename(): void {
    this.deps.ipc.handle(
      'disk:rename',
      async (_, target: string, nextName: string): Promise<IPCResponse<{ path: string }>> => {
        try {
          const renamed = await this.deps.writer.rename(target, nextName);
          return { success: true, data: { path: renamed } };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to rename') };
        }
      }
    );
  }

  private registerMove(): void {
    this.deps.ipc.handle(
      'disk:move',
      async (_, target: string, destinationDir: string): Promise<IPCResponse<{ path: string }>> => {
        try {
          const moved = await this.deps.writer.move(target, destinationDir);
          return { success: true, data: { path: moved } };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to move') };
        }
      }
    );
  }

  private registerTrash(): void {
    this.deps.ipc.handle(
      'disk:trash',
      async (_, target: string): Promise<IPCResponse> => {
        try {
          await this.deps.writer.moveToTrash(target);
          return { success: true };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to move to Trash') };
        }
      }
    );
  }

  private registerReveal(): void {
    this.deps.ipc.handle(
      'disk:reveal',
      async (_, target: string): Promise<IPCResponse> => {
        try {
          const resolved = await this.deps.registry.assertAllowed(target);
          this.deps.shell.showItemInFolder(resolved);
          return { success: true };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to reveal file') };
        }
      }
    );
  }

  private registerOpenExternal(): void {
    this.deps.ipc.handle(
      'disk:open-external',
      async (_, target: string): Promise<IPCResponse> => {
        try {
          const resolved = await this.deps.registry.assertAllowed(target);
          // openPath resolves to '' on success and to a message on failure.
          const failure = await this.deps.shell.openPath(resolved);
          if (failure) return { success: false, error: failure };
          return { success: true };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to open file') };
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
  if (error instanceof DestinationExistsError) return error.message;
  if (error instanceof InvalidNameError) return error.message;
  if (error instanceof Error && /not a directory|into itself|opened folder/i.test(error.message)) {
    return error.message;
  }
  logger.error(fallback, error instanceof Error ? error : undefined);
  return fallback;
}
