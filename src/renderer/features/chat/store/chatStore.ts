import { create } from 'zustand';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import type { ChatMessage, Conversation, ConversationSummary, LibraryIndexStatus, ThreadContext } from '@/types/chat';

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
  startConversation: (options?: { title?: string; context?: ThreadContext }) => Promise<string | null>;
  updateConversation: (id: string, patch: { title?: string; archived?: boolean; pinned?: boolean }) => Promise<boolean>;
  removeConversation: (id: string) => Promise<void>;
  send: (question: string, threadId?: string) => Promise<boolean>;
  cancel: () => void;
  refreshIndex: () => Promise<void>;
  updateIndex: () => Promise<void>;
  cancelIndex: () => Promise<void>;
  /** Registers the index-changed listener once; later calls are no-ops. */
  subscribe: () => void;
  reset: () => void;
}

export type ChatStore = ChatState & ChatActions;

let selectionRevision = 0;
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
        if (!get().active) {
          const remembered = readPref<string | null>('threads.active', null);
          const resume = response.data.find((item) => item.id === remembered) ?? response.data.find((item) => !item.archivedAt);
          if (remembered !== 'new' && resume) await get().select(resume.id);
        }
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
    if (get().sending) return;
    const request = ++selectionRevision;
    if (id === 'new') { writePref('threads.active', 'new'); set({ active: null, error: null, streaming: null }); return; }
    const response = await window.chatAPI.get(id);
    if (request !== selectionRevision || get().sending) return;
    if (!response.success || !response.data) { set({ error: response.success ? 'This conversation no longer exists.' : response.error }); return; }
    writePref('threads.active', id);
    set({ active: response.data, error: null, streaming: null });
  },

  startConversation: async (options) => {
    const request = ++selectionRevision;
    const response = await window.chatAPI.create(options);
    if (request !== selectionRevision) return response.success ? response.data.id : null;
    if (!response.success) { set({ error: response.error }); return null; }
    set((state) => ({
      active: response.data,
      conversations: [{ id: response.data.id, title: response.data.title, createdAt: response.data.createdAt, updatedAt: response.data.updatedAt, messageCount: 0, context: response.data.context }, ...state.conversations],
      error: null,
      streaming: null,
    }));
    writePref('threads.active', response.data.id);
    return response.data.id;
  },

  updateConversation: async (id, patch) => {
    try {
      const response = await window.chatAPI.update(id, patch);
      if (!response.success) { set({ error: response.error }); return false; }
      const updated = response.data;
      set((state) => ({ active: state.active?.id === id ? updated : state.active,
        conversations: state.conversations.map((item) => item.id === id ? { id: updated.id, title: updated.title,
          createdAt: updated.createdAt, updatedAt: updated.updatedAt, messageCount: updated.messages.length,
          archivedAt: updated.archivedAt, pinnedAt: updated.pinnedAt, context: updated.context } : item), error: null }));
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not update the thread.' });
      return false;
    }
  },

  removeConversation: async (id) => {
    const response = await window.chatAPI.remove(id);
    if (!response.success) { set({ error: response.error }); return; }
    set((state) => ({
      conversations: state.conversations.filter((conversation) => conversation.id !== id),
      active: state.active?.id === id ? null : state.active,
    }));
  },

  send: async (question, threadId) => {
    const text = question.trim();
    if (!text || get().sending) return false;
    if (threadId && get().active?.id !== threadId) { set({ error: 'The selected thread changed. Your draft is still saved; open it to send.' }); return false; }
    if (text.length > 8000) { set({ error: 'Messages can contain up to 8,000 characters. Your draft is still here.' }); return false; }
    set({ sending: true, error: null });
    let active = get().active;
    let accepted = false;
    try {
      if (!active) {
        const id = await get().startConversation();
        if (!id) return false;
        active = get().active;
        if (!active) return false;
      }
      const threadId = active.id;
      const previousCount = active.messages.length;
      const pendingUser: ChatMessage = { id: `pending-${Date.now()}`, role: 'user', content: text, createdAt: Date.now() };
      set({ active: { ...active, messages: [...active.messages, pendingUser] }, streaming: '' });
      const handle = window.chatAPI.ask(threadId, text,
        (delta) => set((state) => ({ streaming: state.active?.id === threadId ? (state.streaming ?? '') + delta : state.streaming })),
        (message) => set({ error: message }));
      cancelInFlight = handle.cancel;
      const response = await handle.result;
      const refreshed = await window.chatAPI.get(threadId);
      if (refreshed.success && refreshed.data) {
        accepted = refreshed.data.messages.slice(previousCount).some((message) => message.role === 'user' && message.content === text);
        if (get().active?.id === threadId) set({ active: refreshed.data });
      }
      set({ error: response.success ? null : response.error });
      const list = await window.chatAPI.list();
      if (list.success) set({ conversations: list.data });
      return accepted;
    } catch (error) {
      // A transport failure is not proof that main persisted the message.
      set({ error: error instanceof Error ? error.message : 'Could not send. Your draft is still here.' });
      return false;
    } finally {
      cancelInFlight = null;
      set({ sending: false, streaming: null });
    }
  },

  cancel: () => {
    cancelInFlight?.();
    cancelInFlight = null;
    // Keep the partial text and send lock until main acknowledges cancellation.
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
    selectionRevision++;
    unsubscribe?.();
    unsubscribe = null;
    cancelInFlight = null;
    set({ ...INITIAL });
  },
}));
