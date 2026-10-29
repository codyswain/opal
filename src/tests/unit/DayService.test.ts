// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";

vi.mock("@/main/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DiskWatcher } from "@/main/fs/DiskWatcher";
import { LinkIndex } from "@/main/fs/LinkIndex";
import { RootRegistry } from "@/main/fs/RootRegistry";
import { DayService } from "@/main/vault/DayService";
import type { VaultDayChange } from "@/types/day";

const DATE = "2026-10-28";

let temporary: string;
let root: string;
let registry: RootRegistry;
let links: LinkIndex;
let onChanged: ReturnType<typeof vi.fn<(change: VaultDayChange) => void>>;
let service: DayService;

async function put(relative: string, text: string): Promise<string> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}

const LOG = [
  "---", "written_by: ai", "type: log", `date: ${DATE}`, "---",
  "- 08:55 Linked the MK0.2 static neck in Onshape from HW-196. · [[Library/chats/neck|Neck]], [HW-196](https://linear.app/parametricpbc/issue/HW-196) · 4 connector calls",
  "- 06:38 Ran daily triage: 36 Linear items, 0 new candidates; see [[Library/people/Robert Xu|Robert]]",
  "- 10:07 Meet sync saved Kigali Operators. · [[Library/recordings/2026-10-28 0859 Kigali Operators (Meet)|Kigali]], [[Library/missing|Missing]] · routine run",
  "",
].join("\n");

const CARD = (title: string, created: string) =>
  `---\nwritten_by: ai\ntype: thread\ntitle: ${title}\nstatus: active\ncreated: "${created}"\nupdated: "2026-10-29 09:57"\n---\n\n# ${title}\n`;

const SESSION = (started: string, last: string, body: string) =>
  `---\ntype: thread-transcript\ntool: claude\nstarted: "${started}"\nlast: "${last}"\n---\n\n# Thread\n\n${body}\n`;

const MEET = [
  "---", "source: meet", 'title: "Kigali Operators"', "duration_min: 27", 'speakers: ["Lucas Czajka"]', 'attendees: ["lucas@parametric.company"]', "---",
  "# Kigali Operators", "", "Google: [Notes by Gemini](https://docs.google.com/document/d/1cb5/edit)", "",
  "## Summary", "", "_Gemini has not written notes for this meeting yet._", "", "## Transcript", "",
].join("\n");

const POCKET = [
  "---", "source: pocket", 'title: "Rig planning"', "duration_min: 12", "speakers: []", "---",
  "# Rig planning", "", "## Summary", "", "Plans for the rig.", "",
].join("\n");

const DIGEST = [
  "---", "written_by: ai", "---", "# Digest, Wed 2026-10-28 (run 07:30, scheduled)", "",
  "- 🔴 Central processes the Oct 30 payroll at 2:00 PM today.",
  "- 🟡 Sourish has been quiet for 29 days. (reply drafted)", "",
  "> [!note]- **Yesterday**: seven 1:1s", "",
].join("\n");

beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "opal-day-"));
  root = path.join(temporary, "vault");
  await mkdir(root);
  registry = new RootRegistry({ storePath: path.join(temporary, "roots.json") });
  root = await registry.add(root);
  links = new LinkIndex({ registry });
  onChanged = vi.fn<(change: VaultDayChange) => void>();
  service = new DayService({
    registry,
    resolveLinks: (from, targets) => links.resolve(from, targets),
    onChanged,
  });
  await put(`Library/daily/${DATE}.md`, "---\ndate: 2026-10-28\ntags:\n  - daily\n---\nMy page.\n");
  await put(`Library/logs/${DATE} log.md`, LOG);
  await put("Library/people/Robert Xu.md", "# Robert\n");
  await put("Library/chats/neck.md", CARD("Neck Simplification", "2026-10-27 09:00"));
  await put("Library/chats/neck/2026-10-27-claude-1.md", SESSION("2026-10-27 09:00", "2026-10-28 08:56", "**Cody** · 2026-10-27 09:00\n**Cody** · 2026-10-28 08:50\n> [!ai] Claude · 08:56"));
  await put("Library/chats/opal.md", CARD("Opal status", "2026-10-28 20:27"));
  await put("Library/chats/opal/2026-10-28-claude-2.md", SESSION("2026-10-28 20:27", "2026-10-28 22:11", "**Cody** · 2026-10-28 20:27\n> [!ai] Claude · 22:11"));
  await put("Library/chats/old.md", CARD("Old thread", "2026-10-01 09:00"));
  await put("Library/chats/old/2026-10-01-claude-3.md", SESSION("2026-10-01 09:00", "2026-10-29 07:00", "**Cody** · 2026-10-01 09:00\n**Cody** · 2026-10-29 07:00"));
  await put(`Library/recordings/${DATE} 0859 Kigali Operators (Meet).md`, MEET);
  await put(`Library/recordings/${DATE} 1304 Rig planning.md`, POCKET);
  await put("Library/recordings/2026-10-27 1530 Yesterday (Meet).md", MEET);
  await put(`Library/digests/${DATE} digest.md`, DIGEST);
});

afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe("DayService", () => {
  it("answers with the day's page, log, chats, recordings and digest", async () => {
    const day = await service.day(root, DATE);
    expect(day.date).toBe(DATE);
    expect(day.daily).toBe(path.join(root, `Library/daily/${DATE}.md`));
    expect(day.log).toBe(path.join(root, `Library/logs/${DATE} log.md`));
    expect(day.entries.map((entry) => [entry.time, entry.kind])).toEqual([
      ["10:07", "routine run"],
      ["08:55", "4 connector calls"],
      ["06:38", null],
    ]);
    expect(day.entries[0].links).toEqual([
      {
        label: "Kigali",
        target: `Library/recordings/${DATE} 0859 Kigali Operators (Meet)`,
        external: false,
        path: path.join(root, `Library/recordings/${DATE} 0859 Kigali Operators (Meet).md`),
      },
      { label: "Missing", target: "Library/missing", external: false, path: null },
    ]);
    expect(day.entries[1].links[1]).toEqual({ label: "HW-196", target: "https://linear.app/parametricpbc/issue/HW-196", external: true, path: null });
    expect(day.entries[2]).toMatchObject({
      text: "Ran daily triage: 36 Linear items, 0 new candidates; see Robert",
      links: [{ label: "Robert", path: path.join(root, "Library/people/Robert Xu.md") }],
    });
    expect(day.chats.map((chat) => [chat.title, chat.last, chat.isNew, chat.prompts])).toEqual([
      ["Opal status", "22:11", true, 1],
      ["Neck Simplification", "08:56", false, 1],
    ]);
    expect(day.chats[0].path).toBe(path.join(root, "Library/chats/opal.md"));
    expect(day.recordings).toEqual([
      {
        path: path.join(root, `Library/recordings/${DATE} 1304 Rig planning.md`),
        title: "Rig planning",
        time: "13:04",
        source: "pocket",
        durationMin: 12,
        speakers: [],
        attendees: [],
        hasSummary: true,
        links: [],
      },
      {
        path: path.join(root, `Library/recordings/${DATE} 0859 Kigali Operators (Meet).md`),
        title: "Kigali Operators",
        time: "08:59",
        source: "meet",
        durationMin: 27,
        speakers: ["Lucas Czajka"],
        attendees: ["lucas@parametric.company"],
        hasSummary: false,
        links: [{ label: "Notes by Gemini", target: "https://docs.google.com/document/d/1cb5/edit", external: true, path: null }],
      },
    ]);
    expect(day.digest).toEqual({
      path: path.join(root, `Library/digests/${DATE} digest.md`),
      title: "Digest, Wed 2026-10-28 (run 07:30, scheduled)",
      groups: [
        { level: "high", items: [{ text: "Central processes the Oct 30 payroll at 2:00 PM today.", detail: null, replyDrafted: false, checked: null, at: null }] },
        { level: "medium", items: [{ text: "Sourish has been quiet for 29 days.", detail: null, replyDrafted: true, checked: null, at: null }] },
      ],
      sections: ["Yesterday"],
    });
  });

  it("answers an empty day with nulls and empty lists, and refuses bad input", async () => {
    expect(await service.day(root, "2026-01-01")).toEqual({
      date: "2026-01-01", daily: null, log: null, entries: [], chats: [], recordings: [], digest: null,
    });
    await expect(service.day(root, "2026-02-30")).rejects.toThrow("valid calendar date");
    await expect(service.day(path.join(root, "Library"), DATE)).rejects.toThrow();
    await expect(service.day(temporary, DATE)).rejects.toThrow();
  });

  it("reads the old Inbox folders for a day that has not moved yet", async () => {
    const date = "2026-10-20";
    const legacy = await put(`Inbox/Logs/${date}.md`, "## Morning\nWrote this.\n\n---\n## Activity Log\n- 09:00 — Ran the digest\n- 08:00 — Filed [[Library/people/Robert Xu|Robert]]\n");
    await put(`Inbox/Recordings/${date} 1000 Standup (Meet).md`, MEET);
    await put(`Inbox/Digests/${date}.md`, DIGEST);
    const day = await service.day(root, date);
    expect(day.daily).toBe(legacy);
    expect(day.log).toBe(legacy);
    expect(day.entries.map((entry) => [entry.time, entry.text, entry.kind])).toEqual([
      ["09:00", "Ran the digest", null],
      ["08:00", "Filed Robert", null],
    ]);
    expect(day.recordings.map((recording) => recording.time)).toEqual(["10:00"]);
    expect(day.digest?.path).toBe(path.join(root, `Inbox/Digests/${date}.md`));
    // A day page without a log section has no log.
    await writeFile(legacy, "Only my writing.\n");
    expect((await service.day(root, date)).log).toBeNull();
  });

  it("lists a split recording once, by its summary file", async () => {
    const stem = `${DATE} 1400 Split call (Meet)`;
    const summary = await put(`Library/recordings/${stem}.md`, MEET.replace("## Transcript\n", ""));
    const transcript = `---\nsource: meet\nrecording: "[[Library/recordings/${stem}]]"\n---\n## Transcript\n\nHello.\n`;
    await put(`Library/recordings/transcripts/${stem} transcript.md`, transcript);
    // A transcript left at the top level by hand is still not a second recording.
    await put(`Library/recordings/${DATE} 1400 Split call (Meet) transcript.md`, transcript);
    const day = await service.day(root, DATE);
    expect(day.recordings.map((recording) => [recording.time, recording.path])).toEqual([
      ["14:00", summary],
      ["13:04", path.join(root, `Library/recordings/${DATE} 1304 Rig planning.md`)],
      ["08:59", path.join(root, `Library/recordings/${DATE} 0859 Kigali Operators (Meet).md`)],
    ]);
  });

  it("does not follow a symlinked day folder", async () => {
    const outside = path.join(temporary, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, `${DATE} digest.md`), DIGEST);
    await rm(path.join(root, "Library/digests"), { recursive: true });
    await symlink(outside, path.join(root, "Library/digests"));
    expect((await service.day(root, DATE)).digest).toBeNull();
  });

  it("reports a day asked for when its files read differently, and stays quiet otherwise", async () => {
    await service.day(root, DATE);
    const logs = path.join(root, "Library/logs");
    await service.changed([logs]);
    expect(onChanged).not.toHaveBeenCalled();

    await appendFile(path.join(logs, `${DATE} log.md`), "- 23:10 Wrote the last line. · agent turn\n");
    await service.changed([logs]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith({ root, date: DATE });
    expect((await service.day(root, DATE)).entries[0].text).toBe("Wrote the last line.");

    // Typing in the daily page changes no day data.
    await writeFile(path.join(root, `Library/daily/${DATE}.md`), "My page, edited.\n");
    await service.changed([path.join(root, "Library/daily")]);
    // A folder that holds no part of a day is never read again.
    await put(`Library/notes/${DATE} log.md`, LOG);
    await service.changed([path.join(root, "Library/notes")]);
    expect(onChanged).toHaveBeenCalledTimes(1);

    // A chat continued that day shows up through its session folder.
    await appendFile(path.join(root, "Library/chats/old/2026-10-01-claude-3.md"), "**Cody** · 2026-10-28 23:30\n");
    await service.changed([path.join(root, "Library/chats/old")]);
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect((await service.day(root, DATE)).chats[0]).toMatchObject({ title: "Old thread", last: "23:30", isNew: false });

    // A new day folder shows up as a change to Library.
    await put(`Library/digests/${DATE} digest.md`, DIGEST.replace("payroll", "taxes"));
    await service.changed([path.join(root, "Library")]);
    expect(onChanged).toHaveBeenCalledTimes(3);
  });

  it("reports changes the disk watcher sees", { retry: 2 }, async () => {
    const watcher = new DiskWatcher({
      onChanged: (directories) => {
        links.invalidateDirectories(directories);
        void service.changed(directories);
      },
      debounceMs: 50,
    });
    try {
      await watcher.watch(root);
      await service.day(root, DATE);
      await put(`Library/recordings/${DATE} 1700 Late call (Meet).md`, MEET);
      await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith({ root, date: DATE }), { timeout: 5000, interval: 25 });
      expect((await service.day(root, DATE)).recordings[0].time).toBe("17:00");
    } finally {
      await watcher.closeAll();
    }
  });
});
