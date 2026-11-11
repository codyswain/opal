import { create } from 'zustand';
import { toast } from 'sonner';
import { HIDDEN_MESSAGE } from '@/types/hidden';

/**
 * What the renderer knows about hidden files. The main process decides what
 * is hidden and leaves it out of every answer; this only holds whether they
 * show, and, for paths the renderer already holds (its tabs, a stack's
 * sections), which of them are hidden now, so a tab can say so without
 * naming the file.
 */
export interface HiddenStoreState {
  shown: boolean;
  /** Checked paths: true when hidden and refused now. A path not here is not checked yet. */
  blocked: Readonly<Record<string, boolean>>;
  /** False until the first check of the tabs is in, so a tab from the last session never shows a hidden name. */
  ready: boolean;
  /** Counts changes, so a view that showed a file looks at it again. */
  generation: number;
}

export interface HiddenStoreActions {
  /** Reads the state and checks `paths` afresh, forgetting earlier checks. */
  refresh: (paths: readonly string[]) => Promise<void>;
  /** Checks the paths not checked yet. */
  check: (paths: readonly string[]) => Promise<void>;
  /** Marks a path the main process refused as hidden. */
  refused: (path: string) => void;
  /** Show Hidden Files (after Touch ID) or Hide Hidden Files. */
  toggle: () => Promise<void>;
  hide: (path: string) => Promise<void>;
  unhide: (path: string) => Promise<void>;
}

export type HiddenStore = HiddenStoreState & HiddenStoreActions;

const api = () => (typeof window !== 'undefined' ? window.hiddenAPI : undefined);

export const useHiddenStore = create<HiddenStore>((set, get) => ({
  shown: false,
  blocked: {},
  ready: false,
  generation: 0,

  refresh: async (paths) => {
    const hidden = api();
    if (!hidden) return;
    const [state, checked] = await Promise.all([
      hidden.state().catch(() => null),
      paths.length > 0 ? hidden.blocked([...paths]).catch(() => null) : null,
    ]);
    const blocked: Record<string, boolean> = {};
    if (checked?.success) paths.forEach((path, index) => { blocked[path] = checked.data[index]; });
    set((previous) => ({
      shown: state?.success ? state.data.shown : previous.shown,
      blocked,
      ready: true,
      generation: previous.generation + 1,
    }));
  },

  check: async (paths) => {
    const hidden = api();
    const wanted = [...new Set(paths)].filter((path) => !(path in get().blocked));
    if (!hidden || wanted.length === 0) return;
    const checked = await hidden.blocked(wanted).catch(() => null);
    if (!checked?.success) return;
    set((previous) => {
      const blocked = { ...previous.blocked };
      wanted.forEach((path, index) => { blocked[path] = checked.data[index]; });
      return { blocked };
    });
  },

  refused: (path) => {
    if (get().blocked[path] === true) return;
    set((previous) => ({ blocked: { ...previous.blocked, [path]: true } }));
  },

  toggle: async () => {
    const hidden = api();
    if (!hidden) return;
    const result = get().shown ? await hidden.hide() : await hidden.show();
    if (!result.success) {
      toast(result.error);
      return;
    }
    set({ shown: result.data.shown });
  },

  hide: async (path) => {
    const result = await api()?.add(path);
    if (result && !result.success) toast.error(result.error);
  },

  unhide: async (path) => {
    const result = await api()?.remove(path);
    if (result && !result.success) toast.error(result.error);
  },
}));

/**
 * Whether a tab must not name its file: it is hidden, or, before the first
 * check is in, not checked yet.
 */
export function namesHidden(state: Pick<HiddenStoreState, 'blocked' | 'ready'>, path: string | null): boolean {
  if (!path || !api()) return false;
  const checked = state.blocked[path];
  return checked === true || (!state.ready && checked === undefined);
}

export { HIDDEN_MESSAGE };
