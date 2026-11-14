import { create } from 'zustand';
import { toast } from 'sonner';
import type { EditorView } from '@codemirror/view';
import { pageName } from '@/common/fileKind';
import type { CommentRun } from '@/types/agent';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';

export type CommentMarkStatus = 'running' | 'stopping' | 'done' | 'failed';

/** One sent comment's mark in a page's margin. Marks live in memory only. */
export interface CommentMark {
  id: string;
  path: string;
  status: CommentMarkStatus;
  comment: string;
  /** The run's last message, or why it failed. */
  reply: string;
  /**
   * Where the mark was when the page's editor last held it: the start of a
   * line in the page's body. Editors map it through edits while they are open.
   */
  pos: number;
}

interface CommentStore {
  marks: Record<string, CommentMark>;
  add: (mark: CommentMark) => void;
  /** A run's new state from the main process. */
  changed: (run: CommentRun) => void;
  /** Takes a mark away: a done mark once read, a failed one dismissed. */
  remove: (id: string) => void;
  /** Keeps where an editor that is going away last held a mark. */
  keep: (id: string, pos: number) => void;
  stop: (id: string) => Promise<void>;
}

const api = () => (typeof window !== 'undefined' ? window.agentAPI : undefined);

/** Every open editor, by page, so a run that ends can tell whether its page is on screen. */
const views = new Map<string, Set<EditorView>>();

export function registerCommentView(path: string, view: EditorView): () => void {
  let set = views.get(path);
  if (!set) {
    set = new Set();
    views.set(path, set);
  }
  set.add(view);
  return () => {
    set?.delete(view);
    if (set?.size === 0) views.delete(path);
  };
}

/** Whether some editor of the page shows part of it in the window now. */
function onScreen(path: string): boolean {
  for (const view of views.get(path) ?? []) {
    if (!view.dom.isConnected) continue;
    const rect = view.dom.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) return true;
  }
  return false;
}

/** A run that ends off screen says so once, naming its page. */
function notice(mark: CommentMark): void {
  if (onScreen(mark.path)) return;
  const name = pageName(mark.path);
  const open = {
    label: 'Open',
    onClick: () => {
      recordOpened(mark.path);
      useTabsStore.getState().open(fileLocation(mark.path), { newTab: false });
    },
  };
  if (mark.status === 'done') toast(`Comment on ${name} is done.`, { action: open });
  else toast(`Comment on ${name} failed.`, { action: open });
}

/** The API the store listens to; a new one (as in tests) is listened to afresh. */
let listening: { agent: Window['agentAPI']; off: () => void } | null = null;
/** Run changes that came before the start call answered. */
const early = new Map<string, CommentRun>();

const status = (run: CommentRun): CommentMarkStatus | null =>
  run.status === 'done' || run.status === 'failed' ? run.status : null;

/**
 * Comment's marks and the runs behind them. The main process says when a
 * run ends; a stopped run takes its mark away.
 */
export const useCommentStore = create<CommentStore>((set, get) => ({
  marks: {},
  add: (mark) => {
    const agent = api();
    if (agent && listening?.agent !== agent) {
      listening?.off();
      listening = { agent, off: agent.onRunChanged((run) => get().changed(run)) };
    }
    set((state) => ({ marks: { ...state.marks, [mark.id]: mark } }));
    const waiting = early.get(mark.id);
    if (waiting) {
      early.delete(mark.id);
      get().changed(waiting);
    }
  },
  changed: (run) => {
    const mark = get().marks[run.id];
    if (!mark) {
      if (run.status !== 'running') early.set(run.id, run);
      return;
    }
    if (run.status === 'running') return;
    if (run.status === 'stopped') {
      get().remove(run.id);
      return;
    }
    const next = { ...mark, status: status(run) ?? mark.status, reply: run.reply };
    set((state) => ({ marks: { ...state.marks, [run.id]: next } }));
    notice(next);
  },
  remove: (id) => set((state) => {
    if (!state.marks[id]) return state;
    const marks = { ...state.marks };
    delete marks[id];
    return { marks };
  }),
  keep: (id, pos) => set((state) => {
    const mark = state.marks[id];
    return mark && mark.pos !== pos ? { marks: { ...state.marks, [id]: { ...mark, pos } } } : state;
  }),
  stop: async (id) => {
    const mark = get().marks[id];
    const agent = api();
    if (!mark || mark.status !== 'running' || !agent) return;
    set((state) => ({ marks: { ...state.marks, [id]: { ...mark, status: 'stopping' } } }));
    const result = await agent.stop(id).catch(() => ({ success: false as const, error: 'The comment could not be stopped.' }));
    if (!result.success) toast.error(result.error);
  },
}));

/** The marks on one page. */
export function marksOf(marks: Record<string, CommentMark>, path: string): CommentMark[] {
  return Object.values(marks).filter((mark) => mark.path === path);
}
