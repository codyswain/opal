import { describe, expect, it } from "vitest";
import { defaultDailyPage, fillDailyTemplate, splitDailyLog, validDate } from "@/common/vaultModel";

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

describe("daily template", () => {
  const now = new Date(2026, 9, 29, 7, 5, 9);

  it("fills the template's date the way Obsidian does, keeping every other byte", () => {
    const template = "---\ndate: {{date:YYYY-MM-DD}}\ntags:\n  - daily\n---\n";
    expect(fillDailyTemplate(template, "2026-10-28", now)).toBe(
      "---\ndate: 2026-10-28\ntags:\n  - daily\n---\n",
    );
    expect(
      fillDailyTemplate(
        "# {{title}}\n{{date}} at {{time}}\n{{ date : dddd, MMMM D [of] YYYY }}\r\n",
        "2026-10-28",
        now,
      ),
    ).toBe("# 2026-10-28\n2026-10-28 at 07:05\nWednesday, October 28 of 2026\r\n");
    expect(
      fillDailyTemplate("{{date:ddd DD MMM YY}} {{time:HH:mm:ss}} {{other}}", "2026-01-02", now),
    ).toBe("Fri 02 Jan 26 07:05:09 {{other}}");
  });

  it("writes the two properties when there is no template", () => {
    expect(defaultDailyPage("2026-10-29")).toBe(
      "---\ndate: 2026-10-29\ntags:\n  - daily\n---\n",
    );
  });
});
