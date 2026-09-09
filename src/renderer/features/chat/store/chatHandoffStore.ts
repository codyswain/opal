import { create } from 'zustand';
import { useChatStore } from './chatStore';

export interface ChatHandoff {
  title: string;
  context?: string;
  sourcePath?: string;
  date: string;
}

interface ChatHandoffState {
  pending: ChatHandoff[];
  drafts: Record<string, string>;
  processing: boolean;
  error: string | null;
  prepare: (task: ChatHandoff) => void;
  setDraft: (conversationId: string, text: string) => void;
  consume: () => Promise<void>;
}

/** Renderer-only drafts. Preparing never reads files, indexes, or asks the model. */
export const useChatHandoffStore = create<ChatHandoffState>((set, get) => ({
  pending: [],
  drafts: {},
  processing: false,
  error: null,
  prepare: (task) => set((state) => ({ pending: [...state.pending, { ...task }], error: null })),
  setDraft: (id, text) => set((state) => ({ drafts: { ...state.drafts, [id]: text } })),
  consume: async () => {
    if (get().processing || !get().pending.length || useChatStore.getState().sending) return;
    // Claim synchronously before the first await; StrictMode mounts share this lock.
    set({ processing: true, error: null });
    try {
      await useChatStore.getState().load();
      if (useChatStore.getState().error) throw new Error(useChatStore.getState().error ?? 'Could not load conversations.');
      // A composer can have text before its first local conversation exists.
      // Give that draft an address so it remains reachable in the conversation list.
      if (get().drafts.new) {
        const savedId = await useChatStore.getState().startConversation();
        if (!savedId) throw new Error(useChatStore.getState().error ?? 'Could not preserve the existing draft.');
        set((state) => ({ drafts: { ...state.drafts, [savedId]: state.drafts.new, new: '' } }));
      }
      while (get().pending.length) {
        const task = get().pending[0];
        const id = await useChatStore.getState().startConversation();
        if (!id) throw new Error(useChatStore.getState().error ?? 'Could not create a conversation.');
        const text = [
          `Help me make progress on this task: ${task.title}`,
          `Date: ${task.date}`,
          task.context ? `Context: ${task.context}` : '',
          task.sourcePath ? `Source: ${task.sourcePath}` : '',
          'Suggest a clear next step and help me work through it.',
        ].filter(Boolean).join('\n\n');
        set((state) => ({ pending: state.pending.slice(1), drafts: { ...state.drafts, [id]: text } }));
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not prepare the draft. Please try again.' });
    } finally {
      set({ processing: false });
    }
  },
}));
