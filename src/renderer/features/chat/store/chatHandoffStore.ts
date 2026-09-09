import { create } from 'zustand';
import type { ThreadContext } from '@/types/chat';
import { useChatStore } from './chatStore';

export type ChatHandoff = ThreadContext;

interface ChatHandoffState {
  pending: ChatHandoff[];
  drafts: Record<string, string>;
  processing: boolean;
  error: string | null;
  hydrated: boolean;
  dirty: boolean;
  saving: boolean;
  persistenceError: string | null;
  prepare: (task: ChatHandoff) => void;
  setDraft: (conversationId: string, text: string) => void;
  hydrate: () => Promise<boolean>;
  flush: () => Promise<boolean>;
  consume: () => Promise<void>;
  reset: () => void;
}

let hydration: Promise<boolean> | null = null;
let saving: Promise<boolean> | null = null;
let revision = 0;
const initial = { pending: [] as ChatHandoff[], drafts: {} as Record<string, string>, processing: false, error: null as string | null,
  hydrated: false, dirty: false, saving: false, persistenceError: null as string | null };

/** Drafts stay local. Persistence never reads source files, indexes, or asks a model. */
export const useChatHandoffStore = create<ChatHandoffState>((set, get) => ({
  ...initial,
  prepare: (task) => {
    revision++;
    set((state) => ({ pending: [...state.pending, { ...task }], error: null, dirty: true }));
    void get().flush();
  },
  setDraft: (id, text) => {
    if ((get().drafts[id] ?? '') === text) return;
    revision++;
    set((state) => ({ drafts: { ...state.drafts, [id]: text }, dirty: true }));
    void get().flush();
  },
  hydrate: () => {
    if (get().hydrated) return Promise.resolve(true);
    if (hydration) return hydration;
    hydration = (async () => {
      try {
        const response = await window.chatAPI.getDraftState();
        if (!response.success) throw new Error(response.error);
        set((state) => ({ drafts: { ...response.data.drafts, ...state.drafts },
          pending: [...response.data.pending, ...state.pending], hydrated: true, persistenceError: null }));
        return true;
      } catch (error) {
        set({ persistenceError: error instanceof Error ? error.message : 'Draft recovery could not be loaded.' });
        return false;
      } finally { hydration = null; }
    })();
    return hydration;
  },
  flush: () => {
    if (saving) return saving;
    saving = (async () => {
      if (!await get().hydrate()) return false;
      try {
        while (get().dirty) {
          set({ saving: true, persistenceError: null });
          const writingRevision = revision;
          const response = await window.chatAPI.saveDraftState({ drafts: { ...get().drafts }, pending: get().pending.map((task) => ({ ...task })) });
          if (!response.success) throw new Error(response.error);
          if (writingRevision === revision) set({ dirty: false });
        }
        return true;
      } catch (error) {
        set({ persistenceError: error instanceof Error ? error.message : 'Your draft could not be saved. Keep Opal open and retry.' });
        return false;
      } finally { set({ saving: false }); }
    })().finally(() => { saving = null; });
    return saving;
  },
  consume: async () => {
    if (get().processing || useChatStore.getState().sending) return;
    set({ processing: true, error: null });
    try {
      if (!await get().hydrate() || !await get().flush()) throw new Error(get().persistenceError ?? 'Could not save the task draft.');
      if (!get().pending.length) return;
      await useChatStore.getState().load();
      if (useChatStore.getState().error) throw new Error(useChatStore.getState().error ?? 'Could not load threads.');
      if (get().drafts.new) {
        const savedId = await useChatStore.getState().startConversation();
        if (!savedId) throw new Error(useChatStore.getState().error ?? 'Could not preserve the existing draft.');
        revision++;
        set((state) => ({ drafts: { ...state.drafts, [savedId]: state.drafts.new, new: '' }, dirty: true }));
      }
      while (get().pending.length) {
        const task = get().pending[0];
        const id = await useChatStore.getState().startConversation({ title: task.title.slice(0, 200), context: task });
        if (!id) throw new Error(useChatStore.getState().error ?? 'Could not create a thread.');
        const rawText = [
          `Help me make progress on this task: ${task.title}`, `Date: ${task.date}`,
          task.context ? `Context: ${task.context}` : '', task.sourcePath ? `Source: ${task.sourcePath}` : '',
          'Suggest a clear next step and help me work through it.',
        ].filter(Boolean).join('\n\n');
        const text = rawText.length > 7800 ? `${rawText.slice(0, 7700)}\n\n[Excerpt shortened for this message.]` : rawText;
        revision++;
        set((state) => ({ pending: state.pending.slice(1), drafts: { ...state.drafts, [id]: text }, dirty: true }));
        if (!await get().flush()) throw new Error(get().persistenceError ?? 'Could not save the prepared draft.');
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not prepare the draft. Please try again.' });
    } finally { set({ processing: false }); }
  },
  reset: () => { hydration = null; saving = null; revision = 0; set({ ...initial, drafts: {}, pending: [] }); },
}));
