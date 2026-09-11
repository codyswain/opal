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
  private requests = new WeakMap<WebContents, Map<string, string>>();
  constructor(private deps: ChatHandlerDependencies) {}

  registerAll(): void {
    const { ipc, service, index } = this.deps;
    ipc.handle('chat:search-content', async (_, query: unknown, deep: unknown) => this.respond(() => index.searchContent(query, deep), 'Failed to search file contents'));
    ipc.handle('chat:search-messages', async (_, query: unknown, archived: unknown) => this.respond(() => service.searchMessages(query, archived), 'Failed to search thread messages'));
    ipc.handle('chat:list', async (): Promise<IPCResponse<ConversationSummary[]>> => this.respond(() => service.list(), 'Failed to load conversations'));
    ipc.handle('chat:get', async (_, id: unknown): Promise<IPCResponse<Conversation | null>> => this.respond(() => service.get(id), 'Failed to load the conversation'));
    ipc.handle('chat:create', async (_, options: unknown): Promise<IPCResponse<Conversation>> => this.respond(() => service.create(options), 'Failed to start a conversation'));
    ipc.handle('chat:update', async (_, id: unknown, patch: unknown) => this.respond(() => service.update(id, patch), 'Failed to update the thread'));
    ipc.handle('chat:drafts-get', async () => this.respond(() => service.getDraftState(), 'Failed to load thread drafts'));
    ipc.handle('chat:drafts-save', async (_, state: unknown) => this.act(() => service.saveDraftState(state), 'Failed to save thread drafts'));
    ipc.handle('chat:remove', async (_, id: unknown): Promise<IPCResponse> => this.act(() => service.remove(id), 'Failed to remove the conversation'));
    ipc.handle('chat:index-status', async (): Promise<IPCResponse<LibraryIndexStatus>> => this.respond(async () => { await index.load(); return index.status(); }, 'Failed to read the index'));
    ipc.handle('chat:index-update', async (): Promise<IPCResponse<LibraryIndexStatus>> => this.respond(() => index.update(), 'Failed to update the index'));
    ipc.handle('chat:index-cancel', async (): Promise<IPCResponse<LibraryIndexStatus>> => this.respond(() => index.cancel(), 'Failed to stop indexing'));
    // Deltas stream on a per-request channel the renderer names; `null` ends the stream.
    ipc.handle('chat:cancel', async (event, channel: unknown) => {
      if (typeof channel !== 'string' || !CHANNEL.test(channel)) return { success: false, error: 'Invalid chat request.' };
      const id = this.requests.get(event.sender)?.get(channel);
      return { success: true, data: id ? service.cancel(id) : false };
    });
    ipc.handle('chat:ask', async (event, conversationId: unknown, question: unknown, channel: unknown): Promise<IPCResponse<ChatAnswer>> => {
      if (typeof channel !== 'string' || !CHANNEL.test(channel)) return { success: false, error: 'Invalid chat request.' };
      const sender: WebContents = event.sender;
      const send = (payload: unknown) => { if (!sender.isDestroyed()) sender.send(channel, payload); };
      const requests = this.requests.get(sender) ?? new Map<string, string>();
      this.requests.set(sender, requests);
      if (requests.has(channel)) return { success: false, error: 'This request is already running.' };
      if (typeof conversationId !== 'string') return { success: false, error: 'Invalid conversation.' };
      requests.set(channel, conversationId);
      const onDestroyed = () => { service.cancel(conversationId); };
      sender.once?.('destroyed', onDestroyed);
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
      } finally {
        requests.delete(channel);
        sender.removeListener?.('destroyed', onDestroyed);
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
