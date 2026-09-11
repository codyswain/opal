import type { IpcMain } from 'electron';
import type { IPCResponse } from '@/types/ipc';
import type { ItemMetadata, ItemProperties } from '@/types/metadata';
import type { MetadataService } from './MetadataService';
import { MetadataError } from './MetadataCodec';
import { PathNotAllowedError } from './RootRegistry';
import logger from '@/main/logger';

export interface MetadataHandlerDependencies {
  ipc: IpcMain;
  service: MetadataService;
}

export class MetadataHandlers {
  constructor(private deps: MetadataHandlerDependencies) {}

  registerAll(): void {
    this.deps.ipc.handle(
      'metadata:read',
      async (_, target: unknown): Promise<IPCResponse<ItemMetadata>> => {
        if (!isNonEmptyString(target)) return invalidRequest();
        return this.respond(() => this.deps.service.read(target));
      }
    );

    this.deps.ipc.handle(
      'metadata:save-properties',
      async (
        _,
        target: unknown,
        properties: unknown,
        expectedRevision: unknown
      ): Promise<IPCResponse<ItemMetadata>> => {
        if (
          !isNonEmptyString(target) ||
          !isProperties(properties) ||
          !isNonEmptyString(expectedRevision)
        ) {
          return invalidRequest();
        }
        return this.respond(() =>
          this.deps.service.saveProperties(target, properties, expectedRevision)
        );
      }
    );

    this.deps.ipc.handle(
      'metadata:add-related',
      async (_, target: unknown, relatedTarget: unknown): Promise<IPCResponse<ItemMetadata>> => {
        if (!isNonEmptyString(target) || !isNonEmptyString(relatedTarget)) {
          return invalidRequest();
        }
        return this.respond(() => this.deps.service.addRelated(target, relatedTarget));
      }
    );

    this.deps.ipc.handle(
      'metadata:remove-related',
      async (_, target: unknown, edgeId: unknown): Promise<IPCResponse<ItemMetadata>> => {
        if (!isNonEmptyString(target) || !isNonEmptyString(edgeId)) {
          return invalidRequest();
        }
        return this.respond(() => this.deps.service.removeRelated(target, edgeId));
      }
    );
  }

  private async respond(
    operation: () => Promise<ItemMetadata>
  ): Promise<IPCResponse<ItemMetadata>> {
    try {
      return { success: true, data: await operation() };
    } catch (error) {
      if (error instanceof MetadataError || error instanceof PathNotAllowedError) {
        return { success: false, error: error.message };
      }
      logger.error('Metadata request failed', error instanceof Error ? error : undefined);
      return { success: false, error: 'Failed to update Details' };
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isProperties(value: unknown): value is ItemProperties {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.tags) &&
    candidate.tags.every((tag) => typeof tag === 'string') &&
    typeof candidate.description === 'string'
  );
}

function invalidRequest<T>(): IPCResponse<T> {
  return { success: false, error: 'Invalid metadata request.' };
}
