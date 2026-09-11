import { beforeEach, expect, it, vi } from "vitest";
import { useJournalStore } from "@/renderer/features/today/journalStore";
import type { JournalDraft, VaultResult } from "@/types/vault";
let recovery: JournalDraft[];
let disk: string;
beforeEach(() => {
  recovery = [];
  disk = "Old";
  useJournalStore.setState({
    drafts: {},
    hydrated: false,
    hydrationError: undefined,
  });
  window.vaultAPI = {
    discover: vi.fn(),
    readDay: vi.fn(),
    createDay: vi.fn(),
    addFocus: vi.fn(),
    updateFocus: vi.fn(),
    listDrafts: vi.fn(async () => ({ success: true as const, data: recovery })),
    putDraft: vi.fn(async (d) => {
      recovery = [d];
      return { success: true as const, data: undefined };
    }),
    clearDraft: vi.fn(async (p, v) => {
      recovery = recovery.filter((d) => d.path !== p || d.version !== v);
      return { success: true as const, data: undefined };
    }),
    saveJournal: vi.fn(async (_p, original, next) =>
      original !== disk
        ? { success: false as const, error: "Journal changed externally" }
        : ((disk = next),
          { success: true as const, data: { journal: next, revision: "r" } }),
    ),
  };
});
it("restores durable drafts without silently saving them on startup", async () => {
  recovery = [
    { path: "/day", baseJournal: "Old", text: "Recovered", version: "v" },
  ];
  const store = useJournalStore.getState();
  store.seed("/day", "Old");
  await store.hydrate();
  expect(useJournalStore.getState().drafts["/day"]).toMatchObject({
    text: "Recovered",
    recovered: true,
    status: "dirty",
  });
  expect(disk).toBe("Old");
});
it("persists writing before a vault save and retains conflicting recovery", async () => {
  const store = useJournalStore.getState();
  await store.hydrate();
  store.seed("/day", "Old");
  store.edit("/day", "Mine");
  disk = "External";
  await store.save("/day");
  expect(recovery[0].text).toBe("Mine");
  expect(disk).toBe("External");
  expect(useJournalStore.getState().drafts["/day"]).toMatchObject({
    text: "Mine",
    status: "error",
  });
});
it("saves typing arriving during a write using the new base and clears only saved versions", async () => {
  let finish: () => void = () => undefined;
  window.vaultAPI.saveJournal = vi.fn(async (_p, original, next) => {
    expect(recovery.some((d) => d.text === next)).toBe(true);
    if (next === "First")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    expect(original).toBe(disk);
    disk = next;
    return { success: true as const, data: { journal: next, revision: "r" } };
  });
  const store = useJournalStore.getState();
  await store.hydrate();
  store.seed("/day", "Old");
  store.edit("/day", "First");
  const saving = store.save("/day");
  await vi.waitFor(() =>
    expect(window.vaultAPI.saveJournal).toHaveBeenCalled(),
  );
  store.edit("/day", "Second");
  finish();
  await saving;
  expect(disk).toBe("Second");
  expect(recovery).toEqual([]);
  expect(useJournalStore.getState().drafts["/day"].status).toBe("saved");
});
it("does not replace edits made while recovery is loading", async () => {
  let finish: (value: VaultResult<JournalDraft[]>) => void = () => undefined;
  window.vaultAPI.listDrafts = vi.fn(
    () =>
      new Promise<VaultResult<JournalDraft[]>>((resolve) => {
        finish = resolve;
      }),
  );
  const store = useJournalStore.getState();
  store.seed("/day", "Old");
  const loading = store.hydrate();
  store.edit("/day", "Typed");
  finish({ success: true as const, data: [] });
  await loading;
  await store.save("/day");
  expect(disk).toBe("Typed");
});
it("does not touch the vault if private recovery storage fails", async () => {
  window.vaultAPI.putDraft = vi
    .fn()
    .mockResolvedValue({ success: false as const, error: "Disk full" });
  const store = useJournalStore.getState();
  await store.hydrate();
  store.seed("/day", "Old");
  store.edit("/day", "Mine");
  await store.save("/day");
  expect(disk).toBe("Old");
  expect(useJournalStore.getState().drafts["/day"]).toMatchObject({
    text: "Mine",
    status: "error",
    durable: false,
  });
});
it("keeps an edit made while an older draft is being cleared", async () => {
  const clear = window.vaultAPI.clearDraft;
  let release: () => void = () => undefined;
  let pause = true;
  window.vaultAPI.clearDraft = vi.fn(async (p, v) => {
    if (pause) {
      pause = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return clear(p, v);
  });
  const store = useJournalStore.getState();
  await store.hydrate();
  store.seed("/day", "Old");
  store.edit("/day", "First");
  const saving = store.save("/day");
  await vi.waitFor(() => expect(window.vaultAPI.clearDraft).toHaveBeenCalled());
  store.edit("/day", "Later");
  release();
  await saving;
  expect(disk).toBe("Later");
  expect(recovery).toEqual([]);
});
it("adopts the external file only through explicit discard and clears its recovery", async () => {
  window.markdownAPI = {
    read: vi
      .fn()
      .mockResolvedValue({
        success: true as const,
        data: { body: "External\n## Activity Log\nEvent", revision: "r" },
      }),
    write: vi.fn(),
    create: vi.fn(),
  };
  const store = useJournalStore.getState();
  await store.hydrate();
  store.seed("/day", "Old");
  store.edit("/day", "Mine");
  disk = "External";
  await store.save("/day");
  await store.reload("/day");
  expect(useJournalStore.getState().drafts["/day"]).toMatchObject({
    text: "External\n",
    status: "saved",
  });
  expect(recovery).toEqual([]);
  expect(disk).toBe("External");
});
it("refreshes recovery for vaults opened after startup without replacing active edits", async () => {
  const store = useJournalStore.getState();
  await store.hydrate();
  store.seed("/day", "Old");
  recovery = [
    {
      path: "/day",
      baseJournal: "Old",
      text: "Recovered later",
      version: "later",
    },
  ];
  await store.hydrate(true);
  expect(useJournalStore.getState().drafts["/day"].text).toBe(
    "Recovered later",
  );
  store.edit("/day", "Typing");
  await store.hydrate(true);
  expect(useJournalStore.getState().drafts["/day"].text).toBe("Typing");
  await store.save("/day");
});
