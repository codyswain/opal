import { create } from 'zustand';
import type { ChatMessage, Conversation, ConversationSummary, LibraryIndexStatus } from '@/types/chat';

export interface ChatState {
  conversations: ConversationSummary[];
  active: Conversation | null;
  /** The assistant text arriving for the question in flight. */
  streaming: string | null;
  sending: boolean;
  error: string | null;
  index: LibraryIndexStatus | null;
  indexError: string | null;
  loaded: boolean;
}

export interface ChatActions {
  load: () => Promise<void>;
  select: (id: string) => Promise<void>;
  startConversation: () => Promise<string | null>;
  removeConversation: (id: string) => Promise<void>;
  send: (question: string) => Promise<void>;
  cancel: () => void;
  refreshIndex: () => Promise<void>;
  updateIndex: () => Promise<void>;
  cancelIndex: () => Promise<void>;
  /** Registers the index-changed listener once; later calls are no-ops. */
  subscribe: () => void;
  reset: () => void;
}

export type ChatStore = ChatState & ChatActions;

let loadInFlight: Promise<void> | null = null;
let unsubscribe: (() => void) | null = null;
let cancelInFlight: (() => void) | null = null;

const INITIAL: ChatState = {
  conversations: [], active: null, streaming: null, sending: false, error: null, index: null, indexError: null, loaded: false,
};

export const useChatStore = create<ChatStore>((set, get) => ({
  ...INITIAL,

  load: () => {
    if (loadInFlight) return loadInFlight;
    loadInFlight = (async () => {
      try {
        const response = await window.chatAPI.list();
        if (!response.success) { set({ error: response.error, loaded: true }); return; }
        set({ conversations: response.data, loaded: true, error: null });
        if (!get().active && response.data[0]) await get().select(response.data[0].id);
        await get().refreshIndex();
      } catch (error) {
        set({ error: error instanceof Error ? error.message : 'Could not load conversations.', loaded: true });
      } finally {
        loadInFlight = null;
      }
    })();
    return loadInFlight;
  },

  select: async (id) => {
    const response = await window.chatAPI.get(id);
    if (!response.success || !response.data) { set({ error: response.success ? 'This conversation no longer exists.' : response.error }); return; }
    set({ active: response.data, error: null, streaming: null });
  },

  startConversation: async () => {
    const response = await window.chatAPI.create();
    if (!response.success) { set({ error: response.error }); return null; }
    set((state) => ({
      active: response.data,
      conversations: [{ id: response.data.id, title: response.data.title, createdAt: response.data.createdAt, updatedAt: response.data.updatedAt, messageCount: 0 }, ...state.conversations],
      error: null,
      streaming: null,
    }));
    return response.data.id;
  },

  removeConversation: async (id) => {
    const response = await window.chatAPI.remove(id);
    if (!response.success) { set({ error: response.error }); return; }
    set((state) => ({
      conversations: state.conversations.filter((conversation) => conversation.id !== id),
      active: state.active?.id === id ? null : state.active,
    }));
  },

  send: async (question) => {
    const text = question.trim();
    if (!text || get().sending) return;
    let active = get().active;
    if (!active) {
      const id = await get().startConversation();
      if (!id) return;
      active = get().active;
      if (!active) return;
    }
    const pendingUser: ChatMessage = { id: `pending-${Date.now()}`, role: 'user', content: text, createdAt: Date.now() };
    set({ active: { ...active, messages: [...active.messages, pendingUser] }, sending: true, streaming: '', error: null });
    const handle = window.chatAPI.ask(
      active.id,
      text,
      (delta) => set((state) => ({ streaming: (state.streaming ?? '') + delta })),
      (message) => set({ error: message })
    );
    cancelInFlight = handle.cancel;
    const response = await handle.result;
    cancelInFlight = null;
    // The persisted conversation is the truth: it carries sources and errors.
    const refreshed = await window.chatAPI.get(active.id);
    if (refreshed.success && refreshed.data) set({ active: refreshed.data });
    set({ sending: false, streaming: null, error: response.success ? null : response.error });
    const list = await window.chatAPI.list();
    if (list.success) set({ conversations: list.data });
  },

  cancel: () => {
    cancelInFlight?.();
    cancelInFlight = null;
    set({ sending: false, streaming: null });
  },

  refreshIndex: async () => {
    const response = await window.chatAPI.indexStatus();
    if (!response.success) { set({ indexError: response.error }); return; }
    set({ index: response.data, indexError: null });
  },

  updateIndex: async () => {
    set((state) => ({ index: state.index ? { ...state.index, indexing: true } : state.index, indexError: null }));
    const response = await window.chatAPI.indexUpdate();
    if (!response.success) { set({ indexError: response.error }); await get().refreshIndex(); return; }
    set({ index: response.data, indexError: response.data.error });
  },

  cancelIndex: async () => {
    const response = await window.chatAPI.indexCancel();
    if (!response.success) { set({ indexError: response.error }); return; }
    set({ index: response.data, indexError: response.data.error });
  },

  subscribe: () => {
    if (unsubscribe) return;
    const api = typeof window !== 'undefined' ? window.chatAPI : undefined;
    if (!api?.onIndexChanged) return;
    unsubscribe = api.onIndexChanged(() => { void get().refreshIndex(); });
  },

  reset: () => {
    unsubscribe?.();
    unsubscribe = null;
    cancelInFlight = null;
    set({ ...INITIAL });
  },
}));
