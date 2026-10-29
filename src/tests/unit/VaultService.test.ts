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
      markdown: new MarkdownDocumentService({ registry }),
    });
  });
  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });
  it("discovers vaults without writing", async () => {
    expect(await service.discover()).toEqual([{ path: root, name: "vault" }]);
    expect(await readdir(root)).toEqual(["Inbox"]);
  });
  it("creates the day from the vault template's journal part", async () => {
    await mkdir(path.join(root, "Archive/Journal"), { recursive: true });
    await writeFile(
      path.join(root, "Archive/Journal/Template.md"),
      "## Notes\n\n---\n## Activity Log\n- template line\n",
    );
    await service.createDay(root, date);
    const created = await readFile(
      path.join(root, `Inbox/Logs/${date}.md`),
      "utf8",
    );
    expect(created.startsWith("## Notes")).toBe(true);
    expect(created.endsWith("## Activity Log\n")).toBe(true);
    expect(created).not.toContain("template line");
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
  it("refuses a directory occupying the exact daily filename", async () => {
    await mkdir(path.join(root, `Inbox/Logs/${date}.md`));
    await expect(service.createDay(root, date)).rejects.toThrow("not a file");
  });
  it("rejects invalid dates, nested roots, and symlink escape even into another allowed root", async () => {
    await expect(service.createDay(root, "2026-02-30")).rejects.toThrow();
    await expect(
      service.createDay(path.join(root, "Inbox"), date),
    ).rejects.toThrow();
    const other = path.join(temporary, "other");
    await mkdir(other);
    await registry.add(other);
    await rm(path.join(root, "Inbox/Logs"), { recursive: true });
    await symlink(other, path.join(root, "Inbox/Logs"));
    await expect(service.createDay(root, date)).rejects.toThrow();
    expect(await readdir(other)).toEqual([]);
    expect(await service.discover()).toEqual([]);
  });
});
