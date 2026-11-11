import type { IpcMain } from 'electron';
import type { UpdateResult } from '@/types/updates';
import type { UpdateService } from './UpdateService';

/** The renderer's way to updates. None of the calls takes an argument: the sources come from updates.json alone. */
export class UpdateHandlers {
  constructor(private deps: { ipc: Pick<IpcMain, 'handle'>; service: UpdateService }) {}

  registerAll(): void {
    const { ipc, service } = this.deps;
    ipc.handle('updates:state', () => this.respond(async () => service.state()));
    ipc.handle('updates:check', () => this.respond(() => service.check()));
    ipc.handle('updates:install', () => this.respond(() => service.install()));
    ipc.handle('updates:roll-back', () => this.respond(() => service.rollBack()));
  }

  private async respond<T>(operation: () => Promise<T>): Promise<UpdateResult<T>> {
    try {
      return { success: true, data: await operation() } as UpdateResult<T>;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'The update failed.' };
    }
  }
}
