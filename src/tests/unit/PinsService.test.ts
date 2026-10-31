// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "fs/promises";
import * as filesystem from "fs/promises";
import os from "os";
import path from "path";
import type { IpcMain } from "electron";
import { RootRegistry } from "@/main/fs/RootRegistry";
import { PinsHandlers } from "@/main/pins/PinsHandlers";
import { PinsService } from "@/main/pins/PinsService";

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

describe("PinsService", () => {
  let temporary: string, root: string, registry: RootRegistry, service: PinsService;
  const file = () => path.join(root, ".opal/pins.json");
  const note = (relative: string) => path.join(root, relative);

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "opal-pins-"));
    root = path.join(temporary, "vault");
    await mkdir(path.join(root, "Library/parametric"), { recursive: true });
    await writeFile(note("Library/parametric/investors.md"), "# Investors\n");
    await writeFile(note("README.md"), "# Vault\n");
    registry = new RootRegistry({ storePath: path.join(temporary, "roots.json") });
    root = await registry.add(root);
    service = new PinsService({ registry });
  });
  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it("reads no pins when the folder has no pins file, and writes nothing", async () => {
    expect(await service.list()).toEqual([{ root, pins: [], missing: [] }]);
    expect(await readdir(root)).toEqual(["Library", "README.md"]);
  });

  it("writes the ordered list relative to the folder, creating .opal, and reads it back", async () => {
    const pins = [note("README.md"), note("Library/parametric/investors.md"), note("Library/later.md")];
    expect(await service.set(root, pins, [])).toEqual({ root, pins, missing: [note("Library/later.md")] });
    expect(JSON.parse(await readFile(file(), "utf8"))).toEqual({
      version: 1,
      pins: ["README.md", "Library/parametric/investors.md", "Library/later.md"],
    });
    // A file that is not there yet stays pinned and reads as missing.
    expect(await service.list()).toEqual([{ root, pins, missing: [note("Library/later.md")] }]);
    await service.set(root, [note("Library/parametric/investors.md")], pins);
    expect((await service.list())[0].pins).toEqual([note("Library/parametric/investors.md")]);
  });

  it("keeps what another Mac pinned or unpinned since this Mac read the file", async () => {
    const readme = note("README.md");
    const investors = note("Library/parametric/investors.md");
    const later = note("Library/later.md");
    await service.set(root, [readme], []);
    // A pull adds the other Mac's pin while Opal stays focused, so this Mac still thinks [README].
    await writeFile(file(), JSON.stringify({ version: 1, pins: ["README.md", "Library/parametric/investors.md"] }));
    expect((await service.set(root, [readme, later], [readme])).pins).toEqual([readme, later, investors]);
    expect(JSON.parse(await readFile(file(), "utf8")).pins).toEqual(["README.md", "Library/later.md", "Library/parametric/investors.md"]);

    // The other Mac unpins README; a reorder here does not bring it back.
    await writeFile(file(), JSON.stringify({ version: 1, pins: ["Library/later.md", "Library/parametric/investors.md"] }));
    expect((await service.set(root, [investors, readme, later], [readme, later, investors])).pins).toEqual([investors, later]);
  });

  it("reads a malformed file as no pins and leaves it until the pins change", async () => {
    await mkdir(path.join(root, ".opal"));
    for (const text of ["{ not json", '{"version":2,"pins":["README.md"]}', '{"version":1,"pins":"README.md"}', "null"]) {
      await writeFile(file(), text);
      expect((await service.list())[0].pins).toEqual([]);
      expect(await readFile(file(), "utf8")).toBe(text);
    }
    await service.set(root, [note("README.md")], []);
    expect(JSON.parse(await readFile(file(), "utf8")).pins).toEqual(["README.md"]);
  });

  it("drops stored entries that are not paths inside the folder", async () => {
    await mkdir(path.join(root, ".opal"));
    await writeFile(
      file(),
      JSON.stringify({ version: 1, pins: ["README.md", "../outside.md", "/etc/hosts", 7, "", "a\\b.md", "README.md", "Library/../README.md"] }),
    );
    expect((await service.list())[0].pins).toEqual([note("README.md")]);
  });

  it("refuses a symlinked .opal folder or pins file, reading no pins and writing nothing through it", async () => {
    const elsewhere = path.join(temporary, "elsewhere");
    await mkdir(elsewhere);
    await writeFile(path.join(elsewhere, "pins.json"), JSON.stringify({ version: 1, pins: ["README.md"] }));
    await symlink(elsewhere, path.join(root, ".opal"));
    expect((await service.list())[0].pins).toEqual([]);
    await expect(service.set(root, [note("README.md")], [])).rejects.toThrow("Symlinks");
    expect(await readdir(elsewhere)).toEqual(["pins.json"]);

    await rm(path.join(root, ".opal"));
    await mkdir(path.join(root, ".opal"));
    await symlink(path.join(elsewhere, "pins.json"), file());
    expect((await service.list())[0].pins).toEqual([]);
    await expect(service.set(root, [], [])).rejects.toThrow("Symlinks");
    expect(JSON.parse(await readFile(path.join(elsewhere, "pins.json"), "utf8")).pins).toEqual(["README.md"]);
  });

  it("refuses a folder that is not opened and pins outside the folder", async () => {
    const other = path.join(temporary, "other");
    await mkdir(other);
    await expect(service.set(other, [path.join(other, "a.md")], [])).rejects.toThrow();
    await expect(service.set(note("Library"), [note("README.md")], [])).rejects.toThrow();
    await expect(service.set(root, [path.join(other, "a.md")], [])).rejects.toThrow("inside the folder");
    await expect(service.set(root, [root], [])).rejects.toThrow("inside the folder");
    await expect(service.set(root, [`${root}-backup/a.md`], [])).rejects.toThrow("inside the folder");
    expect(await readdir(other)).toEqual([]);
    expect(await readdir(root)).toEqual(["Library", "README.md"]);
  });

  it("replaces the file in one step, keeping the old list when a write fails", async () => {
    await service.set(root, [note("README.md")], []);
    const realOpen = (await vi.importActual<typeof import("fs/promises")>("fs/promises")).open;
    // The write opens the temp file with "wx"; the read of the current list before it is left alone.
    const opening = vi.mocked(filesystem.open).mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      if (args[1] === "wx") vi.spyOn(handle, "writeFile").mockRejectedValueOnce(new Error("disk full"));
      return handle;
    });
    try {
      await expect(service.set(root, [], [note("README.md")])).rejects.toThrow("disk full");
    } finally {
      opening.mockImplementation(realOpen);
    }
    expect(JSON.parse(await readFile(file(), "utf8")).pins).toEqual(["README.md"]);
    expect(await readdir(path.join(root, ".opal"))).toEqual(["pins.json"]);
  });

  it("lists every opened folder in the registry's order", async () => {
    const other = await registry.add(await mkdtemp(path.join(temporary, "other-")));
    await writeFile(path.join(other, "plan.md"), "Plan\n");
    await service.set(other, [path.join(other, "plan.md")], []);
    expect(await service.list()).toEqual([
      { root, pins: [], missing: [] },
      { root: other, pins: [path.join(other, "plan.md")], missing: [] },
    ]);
  });
});

describe("Pins IPC validation", () => {
  it("rejects malformed arguments before touching the filesystem", async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const service = { list: vi.fn(async () => []), set: vi.fn() };
    new PinsHandlers({
      ipc: {
        handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler),
      } as unknown as IpcMain,
      service: service as unknown as PinsService,
    }).registerAll();
    for (const args of [
      [null, []],
      ["vault", []],
      ["/vault\0", []],
      ["/vault", "README.md"],
      ["/vault", ["README.md"]],
      ["/vault", [42]],
      ["/vault", Array.from({ length: 501 }, (_, index) => `/vault/${index}.md`), []],
      ["/vault", ["/vault/README.md"]],
      ["/vault", [], ["README.md"]],
    ]) {
      expect(await handlers.get("pins:set")?.({}, ...args)).toEqual({ success: false, error: "Invalid pins request." });
    }
    expect(service.set).not.toHaveBeenCalled();
    await handlers.get("pins:set")?.({}, "/vault", ["/vault/a.md"], ["/vault/b.md"]);
    expect(service.set).toHaveBeenCalledWith("/vault", ["/vault/a.md"], ["/vault/b.md"]);
    expect(await handlers.get("pins:list")?.({})).toEqual({ success: true, data: [] });
  });
});
