// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  stat,
  symlink,
} from "fs/promises";
import os from "os";
import * as filesystem from "fs/promises";
import path from "path";
import { RootRegistry } from "@/main/fs/RootRegistry";
import { DiskReader } from "@/main/fs/DiskReader";
import { MarkdownDocumentService } from "@/main/fs/MarkdownDocumentService";
import { VaultService } from "@/main/vault/VaultService";

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

describe("VaultService", () => {
  let temporary: string,
    root: string,
    registry: RootRegistry,
    service: VaultService;
  const date = "2026-09-08";
  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "opal-vault-"));
    root = path.join(temporary, "vault");
    await mkdir(path.join(root, "Inbox/Logs"), { recursive: true });
    registry = new RootRegistry({
      storePath: path.join(temporary, "roots.json"),
    });
    root = await registry.add(root);
    service = new VaultService({
      registry,
      reader: new DiskReader({ registry }),
      markdown: new MarkdownDocumentService({ registry }),
      draftDirectory: path.join(temporary, "drafts"),
    });
  });
  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });
  it("discovers vaults and treats absent optional sources as a normal empty day without writing", async () => {
    expect(await service.discover()).toEqual([{ path: root, name: "vault" }]);
    expect(await service.readDay(root, date)).toMatchObject({
      date,
      document: null,
      tasks: [],
      focus: [],
      photos: [],
      warnings: [],
    });
    expect(await readdir(root)).toEqual(["Inbox"]);
  });
  it("creates only the exact day once, preserving an existing routine log", async () => {
    await Promise.all([
      service.createDay(root, date),
      service.createDay(root, date),
    ]);
    expect(await readdir(path.join(root, "Inbox/Logs"))).toEqual([
      `${date}.md`,
    ]);
    const log = path.join(root, `Inbox/Logs/${date}.md`);
    await writeFile(log, "routine\n");
    await service.createDay(root, date);
    expect(await readFile(log, "utf8")).toBe("routine\n");
  });
  it("does not claim the final daily name if writing the initial contents fails", async () => {
    const realOpen = (
      await vi.importActual<typeof import("fs/promises")>("fs/promises")
    ).open;
    const opening = vi
      .mocked(filesystem.open)
      .mockImplementationOnce(async (...args) => {
        const handle = await realOpen(...args);
        vi.spyOn(handle, "writeFile").mockRejectedValueOnce(
          new Error("disk full"),
        );
        return handle;
      });
    try {
      await expect(service.createDay(root, date)).rejects.toThrow("disk full");
      expect(await readdir(path.join(root, "Inbox/Logs"))).toEqual([]);
    } finally {
      opening.mockImplementation(realOpen);
    }
    await service.createDay(root, date);
    expect(
      await readFile(path.join(root, `Inbox/Logs/${date}.md`), "utf8"),
    ).toContain("## Morning");
  });
  it("persists stable focus IDs by date without completing the source task", async () => {
    await mkdir(path.join(root, "RAM"));
    await writeFile(path.join(root, "RAM/todo.md"), "- [ ] Call Sam\n");
    const day = await service.readDay(root, date);
    const focus = await service.addFocus(root, date, {
      title: day.tasks[0].title,
      taskId: day.tasks[0].id,
    });
    await service.updateFocus(root, date, focus[0].id, { completed: true });
    expect((await service.readDay(root, date)).focus).toEqual([
      { ...focus[0], completed: true },
    ]);
    expect((await service.readDay(root, "2026-09-09")).focus).toEqual([]);
    expect(await readFile(path.join(root, "RAM/todo.md"), "utf8")).toBe(
      "- [ ] Call Sam\n",
    );
  });
  it("merges current activity but refuses an externally changed journal", async () => {
    const log = path.join(root, `Inbox/Logs/${date}.md`);
    await writeFile(log, "Original\n## Activity Log\nFresh activity\n");
    expect(
      await service.saveJournal(log, "Original\n", "Edited"),
    ).toMatchObject({ journal: "Edited\n" });
    expect(await readFile(log, "utf8")).toBe(
      "Edited\n## Activity Log\nFresh activity\n",
    );
    await expect(
      service.saveJournal(log, "Original\n", "Overwrite"),
    ).rejects.toThrow("another editor");
  });
  it("accepts an already-saved recovered draft without touching fresh activity", async () => {
    const log = path.join(root, `Inbox/Logs/${date}.md`);
    await writeFile(log, "Edited\n## Activity Log\nNewest\n");
    expect(
      await service.saveJournal(log, "Original\n", "Edited"),
    ).toMatchObject({ journal: "Edited\n" });
    expect(await readFile(log, "utf8")).toBe(
      "Edited\n## Activity Log\nNewest\n",
    );
  });
  it("refuses a directory occupying the exact daily filename", async () => {
    await mkdir(path.join(root, `Inbox/Logs/${date}.md`));
    await expect(service.createDay(root, date)).rejects.toThrow("not a file");
  });
  it("keeps newer drafts when an older save clears, persists privately, and scopes recovery to allowed roots", async () => {
    await service.createDay(root, date);
    const log = path.join(root, `Inbox/Logs/${date}.md`);
    const draft = {
      path: log,
      baseJournal: "",
      text: "unsaved",
      version: "new",
    };
    await service.putDraft(draft);
    await service.clearDraft(log, "old");
    expect(await service.listDrafts()).toEqual([draft]);
    const files = await readdir(path.join(temporary, "drafts"));
    expect(
      (await stat(path.join(temporary, "drafts", files[0]))).mode & 0o777,
    ).toBe(0o600);
    await registry.remove(root);
    expect(await service.listDrafts()).toEqual([]);
    root = await registry.add(root);
    await service.clearDraft(log, "new");
    expect(await service.listDrafts()).toEqual([]);
  });

  it("retries an activity-only write race while retaining frontmatter and the newest activity", async () => {
    const log = path.join(root, `Inbox/Logs/${date}.md`);
    await writeFile(
      log,
      "---\nprivate: true\n---\nOriginal\n## Activity Log\nFirst\n",
    );
    const markdown = new MarkdownDocumentService({ registry });
    const realWrite = markdown.write.bind(markdown);
    vi.spyOn(markdown, "write").mockImplementationOnce(async (...args) => {
      await writeFile(
        log,
        "---\nprivate: true\n---\nOriginal\n## Activity Log\nFirst\nSecond\n",
      );
      return realWrite(...args);
    });
    const racing = new VaultService({
      registry,
      reader: new DiskReader({ registry }),
      markdown,
      draftDirectory: path.join(temporary, "drafts"),
    });
    await racing.saveJournal(log, "Original\n", "Edited");
    expect(await readFile(log, "utf8")).toBe(
      "---\nprivate: true\n---\nEdited\n## Activity Log\nFirst\nSecond\n",
    );
  });
  it("recovers drafts after restart and concurrent put/clear retains the latest text", async () => {
    const log = path.join(root, `Inbox/Logs/${date}.md`);
    const first = { path: log, baseJournal: "", text: "first", version: "1" };
    await service.putDraft(first);
    await Promise.all([
      service.putDraft({ ...first, text: "second", version: "2" }),
      service.clearDraft(log, "1"),
    ]);
    const restarted = new VaultService({
      registry,
      reader: new DiskReader({ registry }),
      markdown: new MarkdownDocumentService({ registry }),
      draftDirectory: path.join(temporary, "drafts"),
    });
    expect(await restarted.listDrafts()).toEqual([
      { ...first, text: "second", version: "2" },
    ]);
  });
  it("warns about malformed sources and refuses to overwrite malformed focus", async () => {
    await mkdir(path.join(root, "RAM/triage"), { recursive: true });
    await writeFile(path.join(root, "RAM/triage/state.json"), "{broken");
    await mkdir(path.join(root, ".opal/days"), { recursive: true });
    const focus = path.join(root, `.opal/days/${date}.json`);
    await writeFile(focus, "{broken");
    expect((await service.readDay(root, date)).warnings).toHaveLength(2);
    await expect(
      service.addFocus(root, date, { title: "new" }),
    ).rejects.toThrow();
    expect(await readFile(focus, "utf8")).toBe("{broken");
  });
  it("preserves source references and stable task IDs when unrelated lines move", async () => {
    await mkdir(path.join(root, "RAM/triage"), { recursive: true });
    const todo = path.join(root, "RAM/todo.md");
    await writeFile(todo, "- [ ] Call Sam\n");
    await writeFile(
      path.join(root, "RAM/triage/state.json"),
      JSON.stringify({
        items: {
          "linear:OPS-1": {
            title: "Fix issue",
            status: "active",
            source: "https://example.com/OPS-1",
          },
        },
      }),
    );
    const first = await service.readDay(root, date);
    expect(first.tasks[1].status).toBe("open");
    await service.addFocus(root, date, {
      title: first.tasks[1].title,
      taskId: first.tasks[1].id,
    });
    const metadata = JSON.parse(
      await readFile(path.join(root, `.opal/days/${date}.json`), "utf8"),
    );
    expect(metadata.sources[first.tasks[1].id].sourceRef).toBe(
      "https://example.com/OPS-1",
    );
    await writeFile(todo, "# Work\n\n- [ ] Call Sam\n");
    expect((await service.readDay(root, date)).tasks[0].id).toBe(
      first.tasks[0].id,
    );
    await writeFile(
      path.join(root, "RAM/triage/state.json"),
      JSON.stringify({ items: {} }),
    );
    expect((await service.readDay(root, date)).focus[0]).toMatchObject({
      source: first.tasks[1],
    });
    expect(metadata.focus[0]).not.toHaveProperty("source");
  });
  it("rejects invalid dates, nested roots, and symlink escape even into another allowed root", async () => {
    await expect(service.readDay(root, "2026-02-30")).rejects.toThrow();
    await expect(
      service.readDay(path.join(root, "Inbox"), date),
    ).rejects.toThrow();
    const other = path.join(temporary, "other");
    await mkdir(other);
    await registry.add(other);
    await symlink(other, path.join(root, ".opal"));
    await expect(
      service.addFocus(root, date, { title: "must stay inside" }),
    ).rejects.toThrow();
    expect(await readdir(other)).toEqual([]);
    await symlink(other, path.join(root, "RAM"));
    await writeFile(path.join(other, "todo.md"), "- [ ] private\n");
    const day = await service.readDay(root, date);
    expect(day.tasks).toEqual([]);
    expect(day.warnings.length).toBeGreaterThan(0);
  });
});
