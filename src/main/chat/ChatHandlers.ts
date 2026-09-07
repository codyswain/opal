import type { IpcMain, WebContents } from 'electron';
import logger from '@/main/logger';
import type { IPCResponse } from '@/types/ipc';
import type { ChatAnswer, Conversation, ConversationSummary, LibraryIndexStatus } from '@/types/chat';
import { ChatError, type ChatService } from './ChatService';
import type { LibraryTextIndex } from './LibraryTextIndex';

export interface ChatHandlerDependencies {
  ipc: IpcMain;
  service: ChatService;
  index: LibraryTextIndex;
}

const CHANNEL = /^chat:answer:[A-Za-z0-9._-]{1,80}$/;

export class ChatHandlers {
  constructor(private deps: ChatHandlerDependencies) {}

  registerAll(): void {
    const { ipc, service, index } = this.deps;
    ipc.handle('chat:list', async (): Promise<IPCResponse<ConversationSummary[]>> => this.respond(() => service.list(), 'Failed to load conversations'));
    ipc.handle('chat:get', async (_, id: unknown): Promise<IPCResponse<Conversation | null>> => this.respond(() => service.get(id), 'Failed to load the conversation'));
    ipc.handle('chat:create', async (): Promise<IPCResponse<Conversation>> => this.respond(() => service.create(), 'Failed to start a conversation'));
    ipc.handle('chat:remove', async (_, id: unknown): Promise<IPCResponse> => this.act(() => service.remove(id), 'Failed to remove the conversation'));
    ipc.handle('chat:index-status', async (): Promise<IPCResponse<LibraryIndexStatus>> => this.respond(async () => { await index.load(); return index.status(); }, 'Failed to read the index'));
    ipc.handle('chat:index-update', async (): Promise<IPCResponse<LibraryIndexStatus>> => this.respond(() => index.update(), 'Failed to update the index'));
    ipc.handle('chat:index-cancel', async (): Promise<IPCResponse<LibraryIndexStatus>> => this.respond(() => index.cancel(), 'Failed to stop indexing'));
    // Deltas stream on a per-request channel the renderer names; `null` ends the stream.
    ipc.handle('chat:ask', async (event, conversationId: unknown, question: unknown, channel: unknown): Promise<IPCResponse<ChatAnswer>> => {
      if (typeof channel !== 'string' || !CHANNEL.test(channel)) return { success: false, error: 'Invalid chat request.' };
      const sender: WebContents = event.sender;
      const send = (payload: unknown) => { if (!sender.isDestroyed()) sender.send(channel, payload); };
      try {
        const answer = await service.ask(conversationId, question, (delta) => send({ delta }));
        send(null);
        return { success: true, data: answer };
      } catch (error) {
        const message = error instanceof ChatError ? error.message : 'The answer could not be completed';
        if (!(error instanceof ChatError)) logger.error('Chat failed', error instanceof Error ? error : undefined);
        send({ error: message });
        send(null);
        return { success: false, error: message };
      }
    });
  }

  private async respond<T>(operation: () => Promise<T>, fallback: string): Promise<IPCResponse<T>> {
    try {
      return { success: true, data: await operation() };
    } catch (error) {
      if (error instanceof ChatError) return { success: false, error: error.message };
      logger.error(fallback, error instanceof Error ? error : undefined);
      return { success: false, error: fallback };
    }
  }

  private async act(operation: () => Promise<void>, fallback: string): Promise<IPCResponse> {
    try {
      await operation();
      return { success: true };
    } catch (error) {
      if (error instanceof ChatError) return { success: false, error: error.message };
      logger.error(fallback, error instanceof Error ? error : undefined);
      return { success: false, error: fallback };
    }
  }
}
