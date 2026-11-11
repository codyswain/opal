// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";

vi.mock("@/main/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { RootRegistry } from "@/main/fs/RootRegistry";
import { HiddenFiles } from "@/main/fs/HiddenFiles";
import { TestService } from "@/main/vault/TestService";
import type { VaultTestChange } from "@/types/dailyTest";

const TODAY = "2026-01-05";
const VARIANT = "test-row-height";

let temporary: string;
let root: string;
let registry: RootRegistry;
let hidden: HiddenFiles;
let onChanged: ReturnType<typeof vi.fn<(change: VaultTestChange) => void>>;
let service: TestService;
let variantsFile: string;

async function put(relative: string, text: string): Promise<string> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}

const interfaceTest = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    id,
    title: "Tighter rows",
    question: "Which is easier to scan?",
    kind: "interface",
    variant: VARIANT,
    where: "daily",
    a: { label: "Current" },
    b: { label: "Tighter" },
    ...extra,
  });

const pageTest = (id: string, b = "Notes/short.md") =>
  JSON.stringify({
    version: 1,
    id,
    title: "Two summaries",
    question: "Which reads faster?",
    kind: "page",
    a: { label: "Long", path: "Notes/long.md" },
    b: { label: "Short", path: b },
  });

beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "opal-tests-"));
  await mkdir(path.join(temporary, "vault"));
  registry = new RootRegistry({ storePath: path.join(temporary, "roots.json") });
  root = await registry.add(path.join(temporary, "vault"));
  hidden = new HiddenFiles({ roots: () => registry.list(), prompt: async () => undefined, canPrompt: () => ({ ok: true }) });
  registry.setHidden(hidden);
  onChanged = vi.fn<(change: VaultTestChange) => void>();
  variantsFile = path.join(temporary, "app", "variants.json");
  service = new TestService({
    registry,
    variantsFile,
    known: [VARIANT],
    now: () => new Date("2026-01-05T16:20:00.123Z"),
    onChanged,
  });
  await put("Notes/long.md", "# Long\n");
  await put("Notes/short.md", "# Short\n");
  await put("Notes/Private.md", "# Private\n");
  await put(".opal/hidden.json", JSON.stringify({ version: 1, hidden: ["Notes/Private.md"] }));
});

afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe("TestService", () => {
  it("reads today's test with no answer as current", async () => {
    await put(`Library/tests/${TODAY} test.json`, interfaceTest("t5"));
    expect(await service.test(root, TODAY)).toEqual({
      root,
      date: TODAY,
      test: expect.objectContaining({ id: "t5", kind: "interface", variant: VARIANT, where: "daily" }),
      answer: null,
    });
  });

  it("prefers an older unanswered test to today's answered one, and has none past three days", async () => {
    await put(`Library/tests/${TODAY} test.json`, interfaceTest("t5"));
    await put(`Library/tests/${TODAY} answer.json`, JSON.stringify({ version: 1, id: "t5", choice: "a", reason: "", answeredAt: "2026-01-05T10:00:00Z" }));
    await put("Library/tests/2026-01-04 test.json", interfaceTest("t4"));
    expect((await service.test(root, TODAY))?.test.id).toBe("t4");
    expect((await service.test(root, "2026-01-08"))).toBeNull();
  });

  it("makes a page test's paths absolute", async () => {
    await put(`Library/tests/${TODAY} test.json`, pageTest("p"));
    const current = await service.test(root, TODAY);
    expect(current?.test.a.path).toBe(path.join(root, "Notes/long.md"));
    expect(current?.test.b.path).toBe(path.join(root, "Notes/short.md"));
  });

  it("reads a test that names a hidden, missing, linked or outside file as no test", async () => {
    await put(`Library/tests/${TODAY} test.json`, pageTest("p", "Notes/Private.md"));
    expect(await service.test(root, TODAY)).toBeNull();
    await put(`Library/tests/${TODAY} test.json`, pageTest("p", "Notes/gone.md"));
    expect(await service.test(root, TODAY)).toBeNull();
    await writeFile(path.join(temporary, "outside.md"), "outside\n");
    await symlink(path.join(temporary, "outside.md"), path.join(root, "Notes/link.md"));
    await put(`Library/tests/${TODAY} test.json`, pageTest("p", "Notes/link.md"));
    expect(await service.test(root, TODAY)).toBeNull();
    await put(`Library/tests/${TODAY} test.json`, interfaceTest("t", { where: "Notes/Private.md" }));
    expect(await service.test(root, TODAY)).toBeNull();
  });

  it("reads a hidden test file as no test", async () => {
    await put(`Library/tests/${TODAY} test.json`, interfaceTest("t5"));
    await put(".opal/hidden.json", JSON.stringify({ version: 1, hidden: ["Library/tests"] }));
    await hidden.changed([path.join(root, ".opal")]);
    expect(await service.test(root, TODAY)).toBeNull();
  });

  it("refuses a folder that is not opened", async () => {
    await expect(service.test(path.join(temporary, "elsewhere"), TODAY)).rejects.toThrow();
    await expect(service.test(root, "2026-02-30")).rejects.toThrow("valid calendar date");
  });

  it("writes the answer in one step, replaces it, and leaves the variant on the chosen side", async () => {
    await put(`Library/tests/${TODAY} test.json`, interfaceTest("t5"));
    const first = await service.answer(root, TODAY, "t5", "b", "  Easier to see\nmore at once. ");
    expect(first.answer).toEqual({ version: 1, id: "t5", choice: "b", reason: "Easier to see more at once.", answeredAt: "2026-01-05T16:20:00Z" });
    expect(first.sides).toEqual({ [VARIANT]: "b" });
    const file = path.join(root, `Library/tests/${TODAY} answer.json`);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(first.answer);
    expect(JSON.parse(await readFile(variantsFile, "utf8"))).toEqual({ version: 1, sides: { [VARIANT]: "b" } });

    const second = await service.answer(root, TODAY, "t5", "neither", "");
    expect(second.sides).toEqual({});
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ choice: "neither", reason: "" });
    expect((await readdir(path.join(root, "Library/tests"))).sort()).toEqual([`${TODAY} answer.json`, `${TODAY} test.json`]);
    expect(await service.test(root, TODAY)).toMatchObject({ answer: { choice: "neither" } });
  });

  it("refuses an answer to a test that changed or is not there", async () => {
    await put(`Library/tests/${TODAY} test.json`, interfaceTest("t5"));
    await expect(service.answer(root, TODAY, "other", "a", "")).rejects.toThrow("changed on disk");
    await expect(service.answer(root, "2026-01-04", "t5", "a", "")).rejects.toThrow("changed on disk");
  });

  it("answers a page test without touching variants", async () => {
    await put(`Library/tests/${TODAY} test.json`, pageTest("p"));
    expect((await service.answer(root, TODAY, "p", "b", "")).sides).toEqual({});
  });

  it("keeps variant sides per Mac and refuses a variant the build does not know", async () => {
    expect(await service.sides()).toEqual({});
    expect(await service.setSide(VARIANT, "b")).toEqual({ [VARIANT]: "b" });
    const again = new TestService({ registry, variantsFile, known: [VARIANT] });
    expect(await again.sides()).toEqual({ [VARIANT]: "b" });
    expect(await service.setSide(VARIANT, "a")).toEqual({});
    await expect(service.setSide("unknown-variant", "b")).rejects.toThrow("does not have that variant");
    // The app's own registry starts empty.
    await expect(new TestService({ registry, variantsFile }).setSide(VARIANT, "b")).rejects.toThrow();
  });

  it("reports a folder whose current test changed on disk", async () => {
    await service.test(root, TODAY);
    await service.changed([path.join(root, "Notes")]);
    expect(onChanged).not.toHaveBeenCalled();
    await put(`Library/tests/${TODAY} test.json`, interfaceTest("t5"));
    await service.changed([path.join(root, "Library/tests")]);
    expect(onChanged).toHaveBeenCalledWith({ root: await realpath(root) });
    onChanged.mockClear();
    await service.changed([path.join(root, "Library/tests")]);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
