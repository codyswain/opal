import type { IpcMain } from 'electron';
import logger from '@/main/logger';
import { CollectionQueryError } from '@/common/collectionQuery';
import { PathNotAllowedError } from '@/main/fs/RootRegistry';
import type { IPCResponse } from '@/types/ipc';
import type { CollectionQueryResult } from '@/types/collectionQuery';
import type { CollectionQueryService } from './CollectionQueryService';

export interface CollectionHandlerDependencies {
  ipc: IpcMain;
  service: CollectionQueryService;
}

export class CollectionHandlers {
  constructor(private deps: CollectionHandlerDependencies) {}

  registerAll(): void {
    this.deps.ipc.handle(
      'collections:query',
      async (_, query: unknown, page: unknown): Promise<IPCResponse<CollectionQueryResult>> => {
        try {
          return { success: true, data: await this.deps.service.query(query, page) };
        } catch (error) {
          if (error instanceof CollectionQueryError || error instanceof PathNotAllowedError) {
            return { success: false, error: error.message };
          }
          logger.error('Collection query failed', error instanceof Error ? error : undefined);
          return { success: false, error: 'Failed to load the collection' };
        }
      }
    );
  }
}
