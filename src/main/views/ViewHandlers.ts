import type { IpcMain } from 'electron';
import logger from '@/main/logger';
import type { IPCResponse } from '@/types/ipc';
import type { SavedView, SavedViewsListing } from '@/types/savedView';
import { ViewConflictError, ViewError, type ViewRepository } from './ViewRepository';

export interface ViewHandlerDependencies {
  ipc: IpcMain;
  repository: ViewRepository;
}

/** A conflict is a distinct, recoverable outcome; the renderer offers both states. */
export type ViewResponse<T> = IPCResponse<T> & { conflict?: true };

export class ViewHandlers {
  constructor(private deps: ViewHandlerDependencies) {}

  registerAll(): void {
    const { ipc, repository } = this.deps;
    ipc.handle('views:list', async (): Promise<ViewResponse<SavedViewsListing>> =>
      this.respond(() => repository.list(), 'Failed to load views'));
    ipc.handle('views:create', async (_, definition: unknown): Promise<ViewResponse<SavedView>> =>
      this.respond(() => repository.create(definition), 'Failed to save the view'));
    ipc.handle('views:save', async (_, id: unknown, definition: unknown, expectedRevision: unknown): Promise<ViewResponse<SavedView>> =>
      this.respond(() => repository.save(id, definition, expectedRevision), 'Failed to save the view'));
    ipc.handle('views:duplicate', async (_, id: unknown): Promise<ViewResponse<SavedView>> =>
      this.respond(() => repository.duplicate(id), 'Failed to duplicate the view'));
    ipc.handle('views:remove', async (_, id: unknown): Promise<ViewResponse<{ undoToken: string }>> =>
      this.respond(() => repository.remove(id), 'Failed to remove the view'));
    ipc.handle('views:restore', async (_, undoToken: unknown): Promise<ViewResponse<SavedView>> =>
      this.respond(() => repository.restore(undoToken), 'Failed to restore the view'));
  }

  private async respond<T>(operation: () => Promise<T>, fallback: string): Promise<ViewResponse<T>> {
    try {
      return { success: true, data: await operation() };
    } catch (error) {
      if (error instanceof ViewConflictError) return { success: false, error: error.message, conflict: true };
      if (error instanceof ViewError) return { success: false, error: error.message };
      logger.error(fallback, error instanceof Error ? error : undefined);
      return { success: false, error: fallback };
    }
  }
}
