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

  it("writes Moment's ordinal, 12-hour and quarter tokens, and leaves other letters as written", () => {
    expect(fillDailyTemplate("{{date:dddd, MMMM Do YYYY [at] HH:mm}}", "2026-10-29", now)).toBe(
      "Thursday, October 29th 2026 at 07:05",
    );
    const evening = new Date(2026, 9, 29, 19, 5, 9);
    expect(fillDailyTemplate("{{time:h:mm A}} {{time:hh:mm:s a}} {{date:[Q]Q d}}", "2026-10-29", evening)).toBe(
      "7:05 PM 07:05:9 pm Q4 4",
    );
    expect(fillDailyTemplate("{{time:h A}}", "2026-10-29", new Date(2026, 9, 29, 0, 30))).toBe("12 AM");
    const ordinals = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map((day) =>
      fillDailyTemplate("{{date:Do}}", `2026-10-${String(day).padStart(2, "0")}`, now),
    );
    expect(ordinals).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
    expect(fillDailyTemplate("{{date:DDDD ww gggg}}", "2026-10-29", now)).toBe("DDDD ww gggg");
  });

  it("writes the two properties when there is no template", () => {
    expect(defaultDailyPage("2026-10-29")).toBe(
      "---\ndate: 2026-10-29\ntags:\n  - daily\n---\n",
    );
  });
});
