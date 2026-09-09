import type { DiskResult } from '@/types/disk';
import type { ChatAnswer, ChatDraftState, CreateConversationOptions, ConversationPatch, Conversation, ConversationSummary, LibraryIndexStatus } from '@/types/chat';

export interface ChatAPI {
  list: () => Promise<DiskResult<ConversationSummary[]>>;
  get: (id: string) => Promise<DiskResult<Conversation | null>>;
  create: (options?: CreateConversationOptions) => Promise<DiskResult<Conversation>>;
  update: (id: string, patch: ConversationPatch) => Promise<DiskResult<Conversation>>;
  getDraftState: () => Promise<DiskResult<ChatDraftState>>;
  saveDraftState: (state: ChatDraftState) => Promise<DiskResult>;
  remove: (id: string) => Promise<DiskResult>;
  searchContent: (query: string, deep?: boolean) => Promise<DiskResult<import('@/types/chat').ContentSearchResult>>;
  indexStatus: () => Promise<DiskResult<LibraryIndexStatus>>;
  indexUpdate: () => Promise<DiskResult<LibraryIndexStatus>>;
  indexCancel: () => Promise<DiskResult<LibraryIndexStatus>>;
  onIndexChanged: (callback: () => void) => () => void;
  ask: (
    conversationId: string,
    question: string,
    onDelta: (delta: string) => void,
    onError: (error: string) => void
  ) => { result: Promise<DiskResult<ChatAnswer>>; cancel: () => void };
}

declare global {
  interface Window {
    chatAPI: ChatAPI;
  }
}
