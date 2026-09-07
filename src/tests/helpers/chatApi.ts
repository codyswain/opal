import { vi } from 'vitest';
import type { ChatAPI } from '@/renderer/shared/types/chatApi';
import type { ChatMessage, Conversation, LibraryIndexStatus } from '@/types/chat';

export function indexStatus(over: Partial<LibraryIndexStatus> = {}): LibraryIndexStatus {
  return { files: 0, chunks: 0, staleFiles: 0, indexing: false, lastIndexedAt: null, error: null, skipped: [], ready: false, ...over };
}

/**
 * An in-memory chatAPI. `answers` decides what the fake model streams for a
 * question; each answer is split into word deltas and cites [1] when sources
 * are configured.
 */
export function installChatApi(options: {
  status?: Partial<LibraryIndexStatus>;
  answer?: (question: string) => string;
  sources?: ChatMessage['sources'];
  failWith?: string | null;
} = {}) {
  const conversations = new Map<string, Conversation>();
  let status = indexStatus(options.status);
  let counter = 0;
  const answerFor = options.answer ?? ((question: string) => `Answer to "${question}" [1]`);
  const listeners = new Set<() => void>();
  const api: ChatAPI & { conversations: Map<string, Conversation>; setStatus: (next: Partial<LibraryIndexStatus>) => void } = {
    conversations,
    setStatus: (next) => { status = { ...status, ...next }; listeners.forEach((listener) => listener()); },
    list: vi.fn(async () => ({
      success: true as const,
      data: [...conversations.values()]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((conversation) => ({ id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, messageCount: conversation.messages.length })),
    })),
    get: vi.fn(async (id: string) => ({ success: true as const, data: conversations.get(id) ?? null })),
    create: vi.fn(async () => {
      counter += 1;
      const conversation: Conversation = { id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`, title: 'New conversation', createdAt: counter, updatedAt: counter, messages: [] };
      conversations.set(conversation.id, conversation);
      return { success: true as const, data: conversation };
    }),
    remove: vi.fn(async (id: string) => { conversations.delete(id); return { success: true as const, data: undefined }; }),
    indexStatus: vi.fn(async () => ({ success: true as const, data: status })),
    indexUpdate: vi.fn(async () => { status = { ...status, ready: true, files: status.files || 2, chunks: status.chunks || 5, staleFiles: 0, lastIndexedAt: Date.now() }; return { success: true as const, data: status }; }),
    onIndexChanged: vi.fn((callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback); }),
    ask: vi.fn((conversationId: string, question: string, onDelta: (delta: string) => void, onError: (error: string) => void) => {
      const conversation = conversations.get(conversationId);
      const result = (async () => {
        if (!conversation) return { success: false as const, error: 'This conversation no longer exists.' };
        counter += 1;
        conversation.messages.push({ id: `u${counter}`, role: 'user', content: question, createdAt: counter });
        if (conversation.messages.length === 1) conversation.title = question.slice(0, 60);
        if (options.failWith) {
          onError(options.failWith);
          conversation.messages.push({ id: `a${counter}`, role: 'assistant', content: '', createdAt: counter, error: options.failWith });
          return { success: false as const, error: options.failWith };
        }
        const text = answerFor(question);
        for (const part of text.split(' ')) { await Promise.resolve(); onDelta(`${part} `); }
        const message: ChatMessage = { id: `a${counter}`, role: 'assistant', content: text, createdAt: counter, sources: options.sources ?? [] };
        conversation.messages.push(message);
        conversation.updatedAt = counter;
        return { success: true as const, data: { message, conversation: { id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, messageCount: conversation.messages.length } } };
      })();
      return { result, cancel: vi.fn() };
    }),
  };
  (window as unknown as { chatAPI: ChatAPI }).chatAPI = api;
  return api;
}
