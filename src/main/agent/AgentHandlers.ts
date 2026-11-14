import type { IpcMain } from 'electron';
import path from 'path';
import type { AgentResult, CommentRequest } from '@/types/agent';
import type { AgentService } from './AgentService';
import { COMMENT_LIMIT, SELECTION_LIMIT } from './agentModel';

const target = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 32768 && !value.includes('\0') && path.isAbsolute(value);
const line = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value < 10_000_000;
const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length <= limit && !value.includes('\0');

/** A start request as the renderer must send it; anything else is refused. */
export function validCommentRequest(value: unknown): value is CommentRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  if (!target(request.path) || !text(request.comment, COMMENT_LIMIT) || !request.comment.trim()) return false;
  if (request.selection === null) return true;
  if (!request.selection || typeof request.selection !== 'object') return false;
  const { from, to, text: selected } = request.selection as Record<string, unknown>;
  return line(from) && line(to) && from <= to && text(selected, SELECTION_LIMIT);
}

/** The renderer's way to Comment. Paths are checked against the opened folders in the service. */
export class AgentHandlers {
  constructor(private deps: { ipc: Pick<IpcMain, 'handle'>; service: AgentService }) {}

  registerAll(): void {
    const { ipc, service } = this.deps;
    ipc.handle('agent:readiness', (_event, page: unknown) =>
      target(page) ? this.respond(() => service.readiness(page)) : invalid());
    ipc.handle('agent:allow-folder', (_event, page: unknown) =>
      target(page) ? this.respond(async () => { await service.allowFolder(page); }) : invalid());
    ipc.handle('agent:start', (_event, request: unknown) =>
      validCommentRequest(request) ? this.respond(() => service.start(request)) : invalid());
    ipc.handle('agent:stop', (_event, id: unknown) =>
      typeof id === 'string' && id.length <= 100 ? this.respond(async () => { service.stop(id); }) : invalid());
  }

  private async respond<T>(operation: () => Promise<T>): Promise<AgentResult<T>> {
    try {
      return { success: true, data: await operation() } as AgentResult<T>;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'The comment could not be sent.' };
    }
  }
}

const invalid = (): AgentResult<never> => ({ success: false, error: 'Invalid comment request.' });
