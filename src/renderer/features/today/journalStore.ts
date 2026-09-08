import { create } from "zustand";
import { splitDailyLog } from "@/common/vaultModel";
import type { JournalDraft as RecoveryDraft } from "@/types/vault";

export interface JournalDraft {
  original: string;
  text: string;
  version: string;
  status: "saved" | "dirty" | "saving" | "error";
  durable: boolean;
  recovered?: boolean;
  error?: string;
}
interface JournalStore {
  drafts: Record<string, JournalDraft>;
  hydrated: boolean;
  hydrationError?: string;
  hydrate: (refresh?: boolean) => Promise<void>;
  seed: (path: string, journal: string) => void;
  edit: (path: string, journal: string) => void;
  save: (path: string) => Promise<void>;
  reload: (path: string) => Promise<void>;
}
const writes = new Map<string, Promise<void>>();
const persistence = new Map<string, Promise<void>>();
let hydration: Promise<void> | undefined;
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Could not save your writing.";
const version = () => crypto.randomUUID();

/** Puts and compare-clears share a queue, so an old response cannot remove new writing. */
function enqueue(path: string, action: () => Promise<void>): Promise<void> {
  const next = (persistence.get(path) ?? Promise.resolve())
    .catch(() => undefined)
    .then(action);
  persistence.set(path, next);
  void next.then(
    () => {
      if (persistence.get(path) === next) persistence.delete(path);
    },
    () => {
      if (persistence.get(path) === next) persistence.delete(path);
    },
  );
  return next;
}

export const useJournalStore = create<JournalStore>((set, get) => {
  const patch = (path: string, next: Partial<JournalDraft>) =>
    set((state) => ({
      drafts: { ...state.drafts, [path]: { ...state.drafts[path], ...next } },
    }));
  const persist = (path: string, draft: JournalDraft) =>
    enqueue(path, async () => {
      await get().hydrate();
      if (!get().hydrated || get().hydrationError)
        throw new Error(get().hydrationError ?? "Recovery is unavailable.");
      const record: RecoveryDraft = {
        path,
        baseJournal: draft.original,
        text: draft.text,
        version: draft.version,
      };
      const result = await window.vaultAPI.putDraft(record);
      if (result.success === false) throw new Error(result.error);
      if (get().drafts[path]?.version === draft.version)
        patch(path, { durable: true });
    });
  return {
    drafts: {},
    hydrated: false,
    hydrate: (refresh = false) => {
      if (hydration)
        return refresh ? hydration.then(() => get().hydrate(true)) : hydration;
      if (get().hydrated && !refresh && !get().hydrationError)
        return Promise.resolve();
      const before = get().drafts;
      const run = (async () => {
        try {
          const result = await window.vaultAPI.listDrafts();
          if (result.success === false) throw new Error(result.error);
          set((state) => {
            const drafts = { ...state.drafts };
            for (const recovered of result.data) {
              const current = drafts[recovered.path];
              if (
                current &&
                (current.status !== "saved" ||
                  (before[recovered.path] &&
                    (current.version !== before[recovered.path].version ||
                      current.status !== before[recovered.path].status)))
              )
                continue;
              drafts[recovered.path] = {
                original: recovered.baseJournal,
                text: recovered.text,
                version: recovered.version,
                status: "dirty",
                durable: true,
                recovered: true,
              };
            }
            return { drafts, hydrated: true, hydrationError: undefined };
          });
        } catch (error) {
          set({ hydrationError: message(error) });
        }
      })();
      hydration = run;
      void run.finally(() => {
        hydration = undefined;
      });
      return run;
    },
    seed: (path, journal) =>
      set((state) => {
        const current = state.drafts[path];
        if (current && (current.status !== "saved" || current.text === journal))
          return state;
        return {
          drafts: {
            ...state.drafts,
            [path]: {
              original: journal,
              text: journal,
              version: version(),
              status: "saved",
              durable: true,
            },
          },
        };
      }),
    edit: (path, text) => {
      const current = get().drafts[path];
      if (!current || current.text === text) return;
      const next: JournalDraft = {
        ...current,
        text,
        version: version(),
        status: current.status === "saving" ? "saving" : "dirty",
        durable: false,
        recovered: false,
        error: undefined,
      };
      patch(path, next);
      void persist(path, next).catch((error) => {
        if (get().drafts[path]?.version === next.version)
          patch(path, {
            status: "error",
            error: message(error),
            durable: false,
          });
      });
    },
    reload: async (path) => {
      const before = get().drafts[path];
      if (!before || writes.has(path)) return;
      try {
        const loaded = await window.markdownAPI.read(path);
        if (loaded.success === false) throw new Error(loaded.error);
        if (get().drafts[path]?.version !== before.version) return;
        const text = splitDailyLog(loaded.data.body).journal;
        await enqueue(path, async () => {
          const cleared = await window.vaultAPI.clearDraft(
            path,
            before.version,
          );
          if (cleared.success === false) throw new Error(cleared.error);
        });
        if (get().drafts[path]?.version !== before.version) return;
        patch(path, {
          original: text,
          text,
          version: version(),
          status: "saved",
          durable: true,
          recovered: false,
          error: undefined,
        });
      } catch (error) {
        if (get().drafts[path]?.version === before.version)
          patch(path, { status: "error", error: message(error) });
      }
    },
    save: (path) => {
      const running = writes.get(path);
      if (running) return running;
      const run = (async () => {
        await get().hydrate();
        while (get().drafts[path] && get().drafts[path].status !== "saved") {
          const draft = get().drafts[path];
          patch(path, { status: "saving", error: undefined });
          try {
            await persist(path, draft);
            const saved = await window.vaultAPI.saveJournal(
              path,
              draft.original,
              draft.text,
            );
            if (saved.success === false) throw new Error(saved.error);
            const current = get().drafts[path];
            const unchanged = current.version === draft.version;
            patch(path, {
              original: saved.data.journal,
              ...(unchanged ? { text: saved.data.journal } : {}),
              status: "saving",
            });
            if (!unchanged) {
              // A queued edit may still contain the old base. Replace it before clearing.
              const rebased = {
                ...get().drafts[path],
                version: version(),
                durable: false,
              };
              patch(path, rebased);
              await persist(path, rebased);
            }
            await enqueue(path, async () => {
              const cleared = await window.vaultAPI.clearDraft(
                path,
                draft.version,
              );
              if (cleared.success === false) throw new Error(cleared.error);
            });
            if (get().drafts[path].version === draft.version) {
              patch(path, { status: "saved", durable: true, recovered: false });
              return;
            }
            patch(path, { status: "dirty" });
          } catch (error) {
            patch(path, { status: "error", error: message(error) });
            return;
          }
        }
      })();
      writes.set(path, run);
      void run.finally(() => writes.delete(path));
      return run;
    },
  };
});
