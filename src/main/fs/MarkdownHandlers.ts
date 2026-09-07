import type { IpcMain } from 'electron';
import logger from '@/main/logger';
import type { IPCResponse } from '@/types/ipc';
import type { MarkdownDocument, MarkdownWriteResult } from '@/types/markdown';
import { PathNotAllowedError } from './RootRegistry';
import { MetadataError } from './MetadataCodec';
import { MarkdownConflictError, MarkdownError, type MarkdownDocumentService } from './MarkdownDocumentService';

export interface MarkdownHandlerDependencies {
  ipc: IpcMain;
  service: MarkdownDocumentService;
}

export type MarkdownResponse<T> = IPCResponse<T> & { conflict?: true };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export class MarkdownHandlers {
  constructor(private deps: MarkdownHandlerDependencies) {}

  registerAll(): void {
    const { ipc, service } = this.deps;
    ipc.handle('markdown:read', async (_, target: unknown): Promise<MarkdownResponse<MarkdownDocument>> => {
      if (!isNonEmptyString(target)) return invalid();
      return this.respond(() => service.read(target), 'Failed to open the note');
    });
    ipc.handle('markdown:write', async (_, target: unknown, body: unknown, expectedRevision: unknown): Promise<MarkdownResponse<MarkdownWriteResult>> => {
      if (!isNonEmptyString(target) || typeof body !== 'string' || !isNonEmptyString(expectedRevision)) return invalid();
      return this.respond(() => service.write(target, body, expectedRevision), 'Failed to save the note');
    });
    ipc.handle('markdown:create', async (_, parentDir: unknown, baseName: unknown): Promise<MarkdownResponse<{ path: string }>> => {
      if (!isNonEmptyString(parentDir) || (baseName !== undefined && typeof baseName !== 'string')) return invalid();
      return this.respond(() => service.create(parentDir, baseName as string | undefined), 'Failed to create the note');
    });
  }

  private async respond<T>(operation: () => Promise<T>, fallback: string): Promise<MarkdownResponse<T>> {
    try {
      return { success: true, data: await operation() };
    } catch (error) {
      if (error instanceof MarkdownConflictError) return { success: false, error: error.message, conflict: true };
      if (error instanceof MarkdownError || error instanceof MetadataError || error instanceof PathNotAllowedError) {
        return { success: false, error: error.message };
      }
      logger.error(fallback, error instanceof Error ? error : undefined);
      return { success: false, error: fallback };
    }
  }
}

function invalid<T>(): MarkdownResponse<T> {
  return { success: false, error: 'Invalid note request.' };
}
