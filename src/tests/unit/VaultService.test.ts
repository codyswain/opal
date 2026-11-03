// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  symlink,
} from "fs/promises";
import os from "os";
import * as filesystem from "fs/promises";
import path from "path";
import { RootRegistry } from "@/main/fs/RootRegistry";
import { VaultService } from "@/main/vault/VaultService";

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

const TEMPLATE = "---\ndate: {{date:YYYY-MM-DD}}\ntags:\n  - daily\n---\n";

describe("VaultService", () => {
  let temporary: string,
    root: string,
    registry: RootRegistry,
    service: VaultService;
  const date = "2026-09-08";
  /** The page Daily makes: a document. */
  const daily = () => path.join(root, `Library/daily/${date}.mdo`);
  /** The page older days and Obsidian have: a note. */
  const note = () => path.join(root, `Library/daily/${date}.md`);
  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "opal-vault-"));
    root = path.join(temporary, "vault");
    await mkdir(path.join(root, "Library/logs"), { recursive: true });
    registry = new RootRegistry({
      storePath: path.join(temporary, "roots.json"),
    });
    root = await registry.add(root);
    service = new VaultService({ registry });
  });
  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it("discovers vaults by their daily, log or old Inbox/Logs folder, without writing", async () => {
    expect(await service.discover()).toEqual([{ path: root, name: "vault" }]);
    expect(await readdir(root)).toEqual(["Library"]);
    const others: string[] = [];
    for (const [index, folder] of ["Library/daily", "Inbox/Logs", "Library/notes"].entries()) {
      const other = path.join(temporary, `other-${index}`);
      await mkdir(path.join(other, folder), { recursive: true });
      others.push(await registry.add(other));
    }
    expect((await service.discover()).map((vault) => vault.path)).toEqual([root, others[0], others[1]]);
  });

  it("writes Library/daily/<date>.mdo from the vault template and returns its path", async () => {
    await mkdir(path.join(root, "Archive/Journal"), { recursive: true });
    await writeFile(path.join(root, "Archive/Journal/Template.md"), TEMPLATE);
    expect(await service.createDay(root, date)).toEqual({ path: daily() });
    expect(await readFile(daily(), "utf8")).toBe(
      "---\ndate: 2026-09-08\ntags:\n  - daily\n---\n",
    );
  });

  it("fills Obsidian's plain {{date}} and {{title}} and adds no Activity Log", async () => {
    await mkdir(path.join(root, "Archive/Journal"), { recursive: true });
    await writeFile(
      path.join(root, "Archive/Journal/Template.md"),
      "# {{title}}\n\nWritten {{date}}.\n",
    );
    await service.createDay(root, date);
    const created = await readFile(daily(), "utf8");
    expect(created).toBe("# 2026-09-08\n\nWritten 2026-09-08.\n");
    expect(created).not.toContain("Activity Log");
  });

  it("writes the two properties when the vault has no template, creating Library/daily", async () => {
    expect(await service.createDay(root, date)).toEqual({ path: daily() });
    expect(await readFile(daily(), "utf8")).toBe(
      "---\ndate: 2026-09-08\ntags:\n  - daily\n---\n",
    );
  });

  it("creates only the exact day once, and never overwrites an existing page", async () => {
    const results = await Promise.all([
      service.createDay(root, date),
      service.createDay(root, date),
    ]);
    expect(results).toEqual([{ path: daily() }, { path: daily() }]);
    expect(await readdir(path.join(root, "Library/daily"))).toEqual([
      `${date}.mdo`,
    ]);
    await writeFile(daily(), "Mine\n");
    expect(await service.createDay(root, date)).toEqual({ path: daily() });
    expect(await readFile(daily(), "utf8")).toBe("Mine\n");
  });

  it("opens an existing Inbox/Logs page while the daily page does not exist yet", async () => {
    const legacy = path.join(root, `Inbox/Logs/${date}.md`);
    await mkdir(path.dirname(legacy), { recursive: true });
    await writeFile(legacy, "## Morning\n\n---\n## Activity Log\n");
    expect(await service.createDay(root, date)).toEqual({ path: legacy });
    expect(await readdir(root)).toEqual(["Inbox", "Library"]);
    expect(await readdir(path.join(root, "Library"))).toEqual(["logs"]);
    expect(await readFile(legacy, "utf8")).toBe("## Morning\n\n---\n## Activity Log\n");
    // Once the daily page exists, it wins, as a note or as a document.
    await mkdir(path.dirname(daily()));
    await writeFile(note(), "Moved\n");
    expect(await service.createDay(root, date)).toEqual({ path: note() });
    await writeFile(daily(), "Made here\n");
    expect(await service.createDay(root, date)).toEqual({ path: daily() });
  });

  it("opens the day's existing note and writes no document beside it", async () => {
    await mkdir(path.dirname(note()), { recursive: true });
    await writeFile(note(), "---\ndate: 2026-09-08\n---\nFrom Obsidian\n");
    expect(await service.createDay(root, date)).toEqual({ path: note() });
    expect(await readdir(path.join(root, "Library/daily"))).toEqual([`${date}.md`]);
    expect(await readFile(note(), "utf8")).toBe("---\ndate: 2026-09-08\n---\nFrom Obsidian\n");
    // Another date still gets a document.
    expect(await service.createDay(root, "2026-09-09")).toEqual({ path: path.join(root, "Library/daily/2026-09-09.mdo") });
    expect(await readdir(path.join(root, "Library/daily"))).toEqual([`${date}.md`, "2026-09-09.mdo"]);
  });

  it("opens the document when a date has both files, and changes neither", async () => {
    await mkdir(path.dirname(note()), { recursive: true });
    await writeFile(note(), "Note\n");
    await writeFile(daily(), "Document\n");
    expect(await service.createDay(root, date)).toEqual({ path: daily() });
    expect(await readFile(note(), "utf8")).toBe("Note\n");
    expect(await readFile(daily(), "utf8")).toBe("Document\n");
  });

  it("opens a note another app makes while the template is written, and writes no document", async () => {
    const realOpen = (
      await vi.importActual<typeof import("fs/promises")>("fs/promises")
    ).open;
    await mkdir(path.dirname(note()), { recursive: true });
    const opening = vi
      .mocked(filesystem.open)
      .mockImplementationOnce(async (...args) => {
        const handle = await realOpen(...args);
        await writeFile(note(), "Obsidian got there first\n");
        return handle;
      });
    try {
      expect(await service.createDay(root, date)).toEqual({ path: note() });
    } finally {
      opening.mockImplementation(realOpen);
    }
    expect(await readdir(path.join(root, "Library/daily"))).toEqual([`${date}.md`]);
    expect(await readFile(note(), "utf8")).toBe("Obsidian got there first\n");
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
      expect(await readdir(path.join(root, "Library/daily"))).toEqual([]);
    } finally {
      opening.mockImplementation(realOpen);
    }
    await service.createDay(root, date);
    expect(await readFile(daily(), "utf8")).toContain("date: 2026-09-08");
  });

  it("refuses an opened folder that is not a vault, and writes nothing there", async () => {
    const notes = path.join(temporary, "notes");
    await mkdir(notes);
    await writeFile(path.join(notes, "a.md"), "A note\n");
    const opened = await registry.add(notes);
    await expect(service.createDay(opened, date)).rejects.toThrow("Choose an opened vault folder.");
    expect(await readdir(opened)).toEqual(["a.md"]);
    // A folder named Library/daily that is a file does not make a vault either.
    await mkdir(path.join(opened, "Library"));
    await writeFile(path.join(opened, "Library/daily"), "");
    await expect(service.createDay(opened, date)).rejects.toThrow("Choose an opened vault folder.");
  });

  it("refuses a directory occupying the exact daily filename", async () => {
    await mkdir(daily(), { recursive: true });
    await expect(service.createDay(root, date)).rejects.toThrow("not a file");
  });

  it("rejects invalid dates, nested roots, and symlink escape even into another allowed root", async () => {
    await expect(service.createDay(root, "2026-02-30")).rejects.toThrow();
    await expect(
      service.createDay(path.join(root, "Library"), date),
    ).rejects.toThrow();
    const other = path.join(temporary, "other");
    await mkdir(other);
    await registry.add(other);
    await rm(path.join(root, "Library"), { recursive: true });
    await symlink(other, path.join(root, "Library"));
    await expect(service.createDay(root, date)).rejects.toThrow();
    expect(await readdir(other)).toEqual([]);
    expect(await service.discover()).toEqual([]);
  });
});
