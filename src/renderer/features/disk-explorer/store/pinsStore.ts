import { create } from 'zustand';
import { toast } from 'sonner';
import { isFsPathAtOrBelow, remapFsPath } from '@/common/fsPaths';
import type { PinsResult, RootPins } from '@/types/pins';
import {
  pathMutationCoordinator,
  type AppPathMutation,
} from '../navigation/pathMutationCoordinator';

/** Opened folder -> its pinned files, absolute, in the order the sidebar shows them. */
export type PinsByRoot = Record<string, string[]>;

export interface PinsState {
  /** Only folders whose pins were read. A folder missing here takes no writes. */
  byRoot: PinsByRoot;
  /** Pins with no file on disk when they were last read. */
  missing: string[];
}

export interface PinsActions {
  load: () => Promise<void>;
  /**
   * Pins a file, or moves a pinned one, to index `at` among the other pins
   * of its folder; to the end when `at` is left out.
   */
  pin: (path: string, at?: number) => void;
  unpin: (path: string) => void;
  toggle: (path: string) => void;
}

export type PinsStore = PinsState & PinsActions;

const inside = (root: string, path: string) => path !== root && isFsPathAtOrBelow(root, path);

/** The opened folder whose pins list `path` belongs in. */
export function pinRoot(byRoot: PinsByRoot, path: string): string | null {
  return (
    Object.keys(byRoot)
      .sort((left, right) => right.length - left.length)
      .find((root) => inside(root, path)) ?? null
  );
}

/**
 * The opened folder whose list holds `path`, else the one it would join. With
 * one opened folder inside another, a pin can sit in the outer folder's list.
 */
export function pinList(byRoot: PinsByRoot, path: string): string | null {
  return Object.keys(byRoot).find((root) => byRoot[root].includes(path)) ?? pinRoot(byRoot, path);
}

export function isPinned(byRoot: PinsByRoot, path: string | null): boolean {
  return path !== null && Object.values(byRoot).some((pins) => pins.includes(path));
}

/**
 * Carries pins along a rename or move made in Opal. A file moved into
 * another opened folder joins the end of that folder's pins.
 */
export function remapPins(byRoot: PinsByRoot, { oldPath, newPath }: AppPathMutation): PinsByRoot {
  const next: PinsByRoot = {};
  const moved: string[] = [];
  for (const [root, pins] of Object.entries(byRoot)) {
    const remapped = pins.map((pin) => remapFsPath(pin, oldPath, newPath));
    next[root] = remapped.filter((pin) => inside(root, pin));
    moved.push(...remapped.filter((pin) => !inside(root, pin)));
  }
  for (const pin of moved) {
    const root = pinRoot(next, pin);
    if (root && !next[root].includes(pin)) next[root] = [...next[root], pin];
  }
  return next;
}

export function dropPins(byRoot: PinsByRoot, removed: readonly string[]): PinsByRoot {
  const kept = (pin: string) => !removed.some((path) => isFsPathAtOrBelow(path, pin));
  return Object.fromEntries(
    Object.entries(byRoot).map(([root, pins]) => [root, pins.filter(kept)])
  );
}

function samePaths(left: readonly string[] = [], right: readonly string[] = []): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

// Loads are numbered so a slow earlier answer never replaces a newer one,
// and every local change bumps the revision so a load that read the file
// before the change was written is dropped. The write's answer then shows
// what the file holds.
let request = 0;
let revision = 0;

/**
 * Writes a folder's pins. `base` is the list they were changed from, so main
 * can keep what the file gained or lost since (a pull from another Mac). Its
 * answer is shown unless the list changed again here meanwhile.
 */
function save(root: string, pins: string[], base: string[]): void {
  revision++;
  const failed = (error: string) => {
    toast.error(error);
    void usePinsStore.getState().load();
  };
  void window.pinsAPI.set(root, pins, base).then(
    (response) => {
      if (!response.success) {
        failed(response.error);
        return;
      }
      const { byRoot, missing } = usePinsStore.getState();
      const written = response.data;
      if (!samePaths(byRoot[root], pins)) return;
      const absent = [...missing.filter((pin) => !written.pins.includes(pin)), ...written.missing];
      const sameMissing = absent.length === missing.length && absent.every((pin) => missing.includes(pin));
      if (samePaths(written.pins, pins) && sameMissing) return;
      usePinsStore.setState({
        byRoot: { ...byRoot, [root]: written.pins },
        missing: sameMissing ? missing : absent,
      });
    },
    () => failed('The pins could not be saved.')
  );
}

export const usePinsStore = create<PinsStore>((set, get) => ({
  byRoot: {},
  missing: [],

  load: async () => {
    const token = ++request;
    const since = revision;
    let response: PinsResult<RootPins[]>;
    try {
      response = await window.pinsAPI.list();
    } catch {
      return;
    }
    if (token !== request || since !== revision || !response.success) return;
    const byRoot: PinsByRoot = Object.fromEntries(response.data.map((folder) => [folder.root, folder.pins]));
    const missing = response.data.flatMap((folder) => folder.missing);
    const previous = get();
    // An unchanged answer keeps the old objects, so the sidebar and tabs do not render again.
    const sameRoots =
      samePaths(Object.keys(byRoot), Object.keys(previous.byRoot)) &&
      Object.keys(byRoot).every((root) => samePaths(byRoot[root], previous.byRoot[root]));
    if (sameRoots && samePaths(missing, previous.missing)) return;
    set({ byRoot, missing });
  },

  pin: (path, at) => {
    const { byRoot } = get();
    const root = pinList(byRoot, path);
    if (!root) {
      // A pin made before the folder's pins were read (just after launch)
      // waits for that read; main still merges the write with the file.
      void get().load().then(() => {
        if (pinList(get().byRoot, path)) get().pin(path, at);
        else toast.error("Opal could not read this folder's pins.");
      });
      return;
    }
    const others = byRoot[root].filter((pin) => pin !== path);
    const index = Math.max(0, Math.min(at ?? others.length, others.length));
    const pins = [...others.slice(0, index), path, ...others.slice(index)];
    if (samePaths(pins, byRoot[root])) return;
    set({ byRoot: { ...byRoot, [root]: pins } });
    save(root, pins, byRoot[root]);
  },

  unpin: (path) => {
    const { byRoot, missing } = get();
    const holding = Object.keys(byRoot).filter((root) => byRoot[root].includes(path));
    if (holding.length === 0) return;
    const next = { ...byRoot };
    for (const root of holding) next[root] = byRoot[root].filter((pin) => pin !== path);
    set({ byRoot: next, missing: missing.filter((pin) => pin !== path) });
    for (const root of holding) save(root, next[root], byRoot[root]);
  },

  toggle: (path) => {
    if (isPinned(get().byRoot, path)) get().unpin(path);
    else get().pin(path);
  },
}));

/** Applies a change to every folder's pins and writes the folders it changed. */
function prepare(next: (previous: PinsState) => PinsState) {
  const previous = usePinsStore.getState();
  const updated = next(previous);
  const changed = Object.keys(updated.byRoot).filter(
    (root) => !samePaths(updated.byRoot[root], previous.byRoot[root])
  );
  if (changed.length === 0) return;
  const apply = (state: PinsState, from: PinsState) => {
    usePinsStore.setState({ byRoot: state.byRoot, missing: state.missing });
    for (const root of changed) save(root, state.byRoot[root] ?? [], from.byRoot[root] ?? []);
  };
  return { commit: () => apply(updated, previous), rollback: () => apply(previous, updated) };
}

// Move to Trash in Opal unpins. A file gone from disk any other way stays
// pinned and greyed out, since it may only have moved outside Opal or not be
// pulled yet. A closed folder's pins stay in its file and are not shown.
pathMutationCoordinator.register({
  id: 'pins-store',
  prepareAppMutation: (mutation) =>
    prepare((previous) => ({
      byRoot: remapPins(previous.byRoot, mutation),
      missing: previous.missing.map((pin) => remapFsPath(pin, mutation.oldPath, mutation.newPath)),
    })),
  preparePathRemoval: (paths, reason) =>
    reason === 'trashed'
      ? prepare((previous) => ({
          byRoot: dropPins(previous.byRoot, paths),
          missing: previous.missing,
        }))
      : undefined,
  prepareAllowedRoots: (roots) => {
    const previous = usePinsStore.getState().byRoot;
    const kept = Object.fromEntries(
      Object.entries(previous).filter(([root]) => roots.includes(root))
    );
    return {
      commit: () => usePinsStore.setState({ byRoot: kept }),
      rollback: () => usePinsStore.setState({ byRoot: previous }),
    };
  },
});
