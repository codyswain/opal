// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";

vi.mock("@/main/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { LinkIndex } from "@/main/fs/LinkIndex";
import { RootRegistry } from "@/main/fs/RootRegistry";
import { DayService } from "@/main/vault/DayService";
import { TouchedService } from "@/main/vault/TouchedService";
import type { TouchedWeekChange } from "@/types/touched";

let temporary: string;
let root: string;
let onChanged: ReturnType<typeof vi.fn<(change: TouchedWeekChange) => void>>;
let service: TouchedService;

async function put(relative: string, text: string): Promise<string> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}

const log = (...lines: string[]) => ["---", "type: log", "---", ...lines, ""].join("\n");

beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "opal-touched-"));
  root = path.join(temporary, "vault");
  await mkdir(root);
  const registry = new RootRegistry({ storePath: path.join(temporary, "roots.json") });
  root = await registry.add(root);
  const links = new LinkIndex({ registry });
  const days = new DayService({ registry, resolveLinks: (from, targets) => links.resolve(from, targets) });
  onChanged = vi.fn<(change: TouchedWeekChange) => void>();
  service = new TouchedService({ registry, days, onChanged });
  await put("Notes/Plan.md", "# Plan\n");
  await put("Projects/garden/a.md", "a\n");
  await put("Library/people/Alex.md", "Alex\n");
  await put(
    "Library/logs/2026-11-02 log.md",
    log(
      "- 09:00 Drafted the plan with Alex. · [[Notes/Plan|Plan]], [[Library/people/Alex|Alex]], [ABC-123](https://linear.app/acme/issue/ABC-123/fix) · agent turn",
      "- 10:00 Planted the garden notes. · [[Projects/garden/a|a]] · agent turn",
      "- 11:00 Synced. · [[Notes/Plan|Plan]] · routine run",
    ),
  );
  await put(
    "Library/logs/2026-11-04 log.md",
    log("- 14:00 Finished the plan. · [[Notes/Plan|Plan]], [PR](https://github.com/owner/repo/pull/7) · agent turn"),
  );
  // The next week does not count.
  await put("Library/logs/2026-11-09 log.md", log("- 09:00 Later. · [[Notes/Plan|Plan]] · agent turn"));
});

afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe("TouchedService", () => {
  it("reads the week a date is in, skipping the day sidebar's own folders", async () => {
    const week = await service.week(root, "2026-11-05");
    expect(week.monday).toBe("2026-11-02");
    const byKey = Object.fromEntries(week.items.map((item) => [item.key, item]));
    expect(Object.keys(byKey).sort()).toEqual(["Notes/Plan.md", "Projects/garden/a.md", "github:owner/repo#7", "linear:ABC-123"]);
    expect(byKey["Notes/Plan.md"]).toMatchObject({ kind: "file", name: "Plan", path: path.join(root, "Notes/Plan.md"), colour: 0 });
    expect(byKey["Notes/Plan.md"].days.map((hit) => hit?.lines ?? 0)).toEqual([1, 0, 1, 0, 0, 0, 0]);
    expect(byKey["Notes/Plan.md"].days[2]?.text).toBe("Finished the plan.");
    expect(byKey["linear:ABC-123"]).toMatchObject({ kind: "issue", id: "ABC-123", name: "", path: null, url: "https://linear.app/acme/issue/ABC-123/fix" });
  });

  it("gives each day's digest file, and null for a day without one", async () => {
    const digest = await put("Library/digests/2026-11-05 digest.md", "# Digest\n");
    const week = await service.week(root, "2026-11-05");
    expect(week.digests).toEqual([null, null, null, digest, null, null, null]);
  });

  it("reads groups, ignores and titles from .opal, and reports a watched week when they change", async () => {
    await service.week(root, "2026-11-02");
    await put(".opal/touched.json", JSON.stringify({ groups: ["Projects/*"], ignore: ["Notes/"] }));
    await put(".opal/link-titles.json", JSON.stringify({ "linear:ABC-123": "Fix the thing" }));
    await service.changed([path.join(root, ".opal")]);
    expect(onChanged).toHaveBeenCalledWith({ root, monday: "2026-11-02" });
    const week = await service.week(root, "2026-11-02");
    const byKey = Object.fromEntries(week.items.map((item) => [item.key, item]));
    expect(Object.keys(byKey).sort()).toEqual(["Projects/garden", "github:owner/repo#7", "linear:ABC-123"]);
    expect(byKey["Projects/garden"]).toMatchObject({ kind: "folder", name: "Garden", path: path.join(root, "Projects/garden/a.md") });
    expect(byKey["linear:ABC-123"].name).toBe("Fix the thing");
  });

  it("reports a change to a log of the week, and stays quiet for unrelated folders", async () => {
    await service.week(root, "2026-11-02");
    await service.changed([path.join(root, "Notes")]);
    expect(onChanged).not.toHaveBeenCalled();
    await put("Library/logs/2026-11-06 log.md", log("- 09:00 More. · [[Projects/garden/a|a]] · agent turn"));
    await service.changed([path.join(root, "Library/logs")]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("counts a link by a file's full path where the link index does not look, as in a dot folder", async () => {
    await put(".sketches/garden/index.html", "<p>hi</p>");
    await put("Library/logs/2026-11-03 log.md", log("- 09:00 Drew it. · [[.sketches/garden/index.html|Sketch]], [[.sketches/missing.html|Gone]] · agent turn"));
    await put("Library/logs/2026-11-05 log.md", log("- 09:00 Drew it again. · [[.sketches/garden/index.html|Sketch]] · agent turn"));
    await put(".opal/touched.json", JSON.stringify({ groups: [".sketches/*"] }));
    const week = await service.week(root, "2026-11-03");
    const group = week.items.find((item) => item.key === ".sketches/garden");
    expect(group).toMatchObject({ kind: "folder", name: "Garden", path: path.join(root, ".sketches/garden/index.html"), colour: 1 });
    expect(week.items.some((item) => item.key.includes("missing"))).toBe(false);
  });

  it("treats a broken or linked config as none", async () => {
    await put(".opal/touched.json", "{ not json");
    await put("elsewhere.json", JSON.stringify({ "linear:ABC-123": "Linked" }));
    await symlink(path.join(root, "elsewhere.json"), path.join(root, ".opal/link-titles.json"));
    const week = await service.week(root, "2026-11-02");
    expect(week.items.find((item) => item.key === "linear:ABC-123")?.name).toBe("");
    expect(week.items.some((item) => item.key === "Notes/Plan.md")).toBe(true);
  });

  it("refuses a folder that is not opened, and a bad date", async () => {
    await expect(service.week(temporary, "2026-11-02")).rejects.toThrow();
    await expect(service.week(root, "2026-13-02")).rejects.toThrow();
  });
});
