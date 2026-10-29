import { describe, expect, it } from "vitest";
import { splitDailyLog, validDate } from "@/common/vaultModel";

describe("daily vault model", () => {
  it("separates activity without treating a fenced heading as a boundary", () => {
    const journal = "## Morning\n```md\n## Activity Log\n```\nMy writing.\n";
    expect(
      splitDailyLog(journal + "## Activity Log\n- 09:00 — Ran digest\n"),
    ).toEqual({ journal, activity: "## Activity Log\n- 09:00 — Ran digest\n" });
  });
  it("uses valid local calendar dates across months", () => {
    expect(validDate("2026-02-30")).toBe(false);
    expect(validDate("2026-09-08")).toBe(true);
  });
});
