import { describe, expect, it } from "vitest";
import {
  splitDailyLog,
  dailyBrief,
  parseTasks,
  parseCandidates,
  photoPaths,
  shiftDate,
  validDate,
} from "@/common/vaultModel";

describe("daily vault model", () => {
  it("separates activity without treating a fenced heading as a boundary", () => {
    const journal = "## Morning\n```md\n## Activity Log\n```\nMy writing.\n";
    expect(
      splitDailyLog(journal + "## Activity Log\n- 09:00 — Ran digest\n"),
    ).toEqual({ journal, activity: "## Activity Log\n- 09:00 — Ran digest\n" });
  });
  it("extracts the brief and leaves the longer recap out", () => {
    expect(
      dailyBrief(
        "# Digest\n## The brief\n- One thing\n\n> Yesterday\n\n## Calendar\nOther",
      ),
    ).toBe("- One thing");
  });
  it("keeps source line identities and excludes empty and completed tasks", () => {
    expect(parseTasks("- [x] done\n- [ ] first\n- [ ] \n- [ ] second")).toEqual(
      [
        { line: 1, text: "first", raw: "- [ ] first" },
        { line: 3, text: "second", raw: "- [ ] second" },
      ],
    );
  });
  it("omits checkbox-only task placeholders", () => {
    expect(parseTasks("- [ ] [ ]\n- [ ] Real task")).toEqual([
      { line: 1, raw: "- [ ] Real task", text: "Real task" },
    ]);
  });
  it("keeps pending suggestions distinct and excludes snoozed/completed items", () => {
    expect(
      parseCandidates(
        JSON.stringify({
          items: {
            a: { status: "pending", title: "A" },
            b: { status: "done", title: "B" },
            c: { status: "pending", title: "C", snoozeUntil: "2099-01-01" },
            "linear:EXE-1": { status: "active" },
          },
        }),
        "2026-09-08",
      ).map((v) => [v.id, v.title, v.status]),
    ).toEqual([
      ["linear:EXE-1", "EXE-1", "active"],
      ["a", "A", "pending"],
    ]);
  });
  it("resolves local photos within the vault and rejects remote/traversal links", () => {
    expect(
      photoPaths(
        "![[Photos/a.jpg]] ![b](../../Photos/b.png) ![x](../../../../secret.jpg) ![r](https://x/y.jpg)",
        "/vault",
        "/vault/Inbox/Logs",
      ),
    ).toEqual(["/vault/Photos/a.jpg", "/vault/Photos/b.png"]);
  });
  it("uses valid local calendar dates across months", () => {
    expect(validDate("2026-02-30")).toBe(false);
    expect(validDate("2026-09-08")).toBe(true);
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});
