import { create } from 'zustand';
import { saveJournal, splitDailyLog } from './dailyModel';

export interface JournalDraft {
  original: string;
  text: string;
  status: 'saved' | 'dirty' | 'saving' | 'error';
  error?: string;
}
interface JournalStore {
  drafts: Record<string, JournalDraft>;
  seed: (path: string, journal: string) => void;
  edit: (path: string, journal: string) => void;
  save: (path: string) => Promise<void>;
  reload: (path: string) => Promise<void>;
}
const writes = new Map<string, Promise<void>>();

/** Session drafts survive route changes; successful writes are always vault files. */
export const useJournalStore = create<JournalStore>((set, get) => ({
  drafts: {},
  seed: (path, journal) => set(state => {
    const existing = state.drafts[path];
    if (existing && existing.status !== 'saved') return state;
    return { drafts: { ...state.drafts, [path]: { original: journal, text: journal, status: 'saved' } } };
  }),
  edit: (path, text) => set(state => {
    const draft = state.drafts[path];
    if (!draft) return state;
    return { drafts: { ...state.drafts, [path]: { ...draft, text, status: draft.status === 'saving' ? 'saving' : 'dirty', error: undefined } } };
  }),
  reload: async (path) => {
    const before = get().drafts[path];
    if (!before || writes.has(path)) return;
    try {
      const loaded = await window.markdownAPI.read(path);
      if (!loaded.success) throw new Error(loaded.error);
      if (get().drafts[path] !== before) return;
      const journal = splitDailyLog(loaded.data.body).journal;
      set(state => ({drafts:{...state.drafts,[path]:{original:journal,text:journal,status:'saved'}}}));
    } catch (error) {
      set(state => ({drafts:{...state.drafts,[path]:{...state.drafts[path],status:'error',error:error instanceof Error ? error.message : 'Could not reload the file.'}}}));
    }
  },
  save: (path) => {
    const running = writes.get(path);
    if (running) return running;
    const patch = (next: Partial<JournalDraft>) => set(state => ({drafts:{...state.drafts,[path]:{...state.drafts[path],...next}}}));
    const run = (async () => {
      while (get().drafts[path]?.status !== 'saved') {
        const draft = get().drafts[path];
        if (!draft || draft.status === 'saved') return;
        const text = draft.text;
        patch({status:'saving',error:undefined});
        try {
          const saved = await saveJournal(window.markdownAPI, path, draft.original, text);
          const unchanged = get().drafts[path].text === text;
          patch({original:saved, ...(unchanged ? {text:saved} : {}), status:unchanged ? 'saved' : 'dirty'});
          if (unchanged) return;
        } catch (error) {
          patch({status:'error',error:error instanceof Error ? error.message : 'Could not save. Your draft is kept in this session.'});
          return;
        }
      }
    })();
    writes.set(path, run);
    void run.finally(() => writes.delete(path));
    return run;
  },
}));
