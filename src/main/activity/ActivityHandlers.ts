import type { IpcMain } from 'electron';
import logger from '@/main/logger';
import type { IPCResponse } from '@/types/ipc';
import type { RecentResult } from '@/types/activity';
import { PathNotAllowedError } from '@/main/fs/RootRegistry';
import type { ActivityService } from './ActivityService';

export interface ActivityHandlerDependencies {
  ipc: IpcMain;
  service: ActivityService;
}

const INVALID: IPCResponse<never> = { success: false, error: 'Invalid activity request.' };

export class ActivityHandlers {
  constructor(private deps: ActivityHandlerDependencies) {}

  registerAll(): void {
    // The renderer may only claim an explicit open; organize events are
    // recorded by main after the mutation that caused them succeeds.
    this.deps.ipc.handle(
      'activity:record',
      async (_, target: unknown, kind: unknown): Promise<IPCResponse> => {
        if (typeof target !== 'string' || target.trim().length === 0 || kind !== 'opened') return INVALID;
        return this.respond(async () => { await this.deps.service.recordOpened(target); }, 'Failed to record activity');
      }
    );

    this.deps.ipc.handle(
      'activity:recent',
      async (_, query: unknown): Promise<IPCResponse<RecentResult>> => {
        const limit = query && typeof query === 'object' ? (query as { limit?: unknown }).limit : undefined;
        if (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1)) return INVALID;
        return this.respond(
          () => this.deps.service.recent(limit === undefined ? {} : { limit }),
          'Failed to load recent activity'
        );
      }
    );

    this.deps.ipc.handle('activity:clear', async (): Promise<IPCResponse> =>
      this.respond(async () => { await this.deps.service.clear(); }, 'Failed to clear recent activity')
    );
  }

  private async respond<T>(operation: () => Promise<T>, fallback: string): Promise<IPCResponse<T>> {
    try {
      const data = await operation();
      return data === undefined ? { success: true } : { success: true, data };
    } catch (error) {
      if (error instanceof PathNotAllowedError) return { success: false, error: error.message };
      logger.error(fallback, error instanceof Error ? error : undefined);
      return { success: false, error: fallback };
    }
  }
}
