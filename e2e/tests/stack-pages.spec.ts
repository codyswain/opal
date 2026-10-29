import { mkdir, readFile, realpath, writeFile } from "fs/promises";
import path from "path";
import type { Page } from "@playwright/test";
import { expect, launchOpal, test } from "../fixtures/electronApp";
import { createTempVault, seedRoots } from "../helpers/tempVault";

/** The local date `offset` days before today, as the vault names its files. */
function dayBefore(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const section = (page: Page, file: string) => page.locator(`[data-stack-section="${file}"]`);
const editorOf = (page: Page, file: string) => section(page, file).getByTestId("markdown-editor");

/** A folder is a vault, with a right sidebar, once it has Library/logs. */
const makeVault = async (root: string) => mkdir(path.join(root, "Library/logs"), { recursive: true });

/** The launch window is narrow, so the right sidebar waits behind the left one until it is asked for. */
async function daySidebar(page: Page) {
  await expect(page.getByTestId("workspace-sidebar")).toBeVisible({ timeout: 15000 });
  const show = page.getByRole("button", { name: "Show right sidebar" });
  if (await show.count()) await show.click();
  return page.getByTestId("day-sidebar");
}

/**
 * The right sidebar's rows open the pages, and each section is its own
 * editor saving its own file, which only a real window shows. The section
 * list and the stack's behaviour are covered by unit tests.
 */
test("a recording opens as its summary with its transcript below, each saving its own file, and one not split yet as one page", async ({
  userDataDir,
}) => {
  const vault = await createTempVault();
  try {
    const root = await realpath(vault.root);
    const today = dayBefore(0);
    await makeVault(root);
    const recordings = path.join(root, "Library/recordings");
    await mkdir(path.join(recordings, "transcripts"), { recursive: true });
    const stem = `${today} 0930 Josh x Lucas (Meet)`;
    const summary = path.join(recordings, `${stem}.md`);
    const transcript = path.join(recordings, "transcripts", `${stem} transcript.md`);
    const summaryText = `---\nsource: meet\ntitle: "Josh x Lucas"\nduration_min: 3\n---\n# Josh x Lucas\n\n## Summary\n\nPrinting timeline.\n`;
    const transcriptText = `---\nsource: meet\nrecording: "[[Library/recordings/${stem}]]"\n---\n## Transcript\n\nJohn: Hey.\n`;
    await writeFile(summary, summaryText);
    await writeFile(transcript, transcriptText);
    const unsplit = path.join(recordings, `${today} 1100 Old call (Meet).md`);
    await writeFile(unsplit, `---\nsource: meet\ntitle: "Old call"\n---\n# Old call\n\n## Summary\n\nShort.\n\n## Transcript\n\nLucas: Hello.\n`);
    await seedRoots(userDataDir, [root]);
    const app = await launchOpal(userDataDir);
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      const sidebar = await daySidebar(page);
      const card = sidebar.getByRole("region", { name: "Recordings" });

      await card.getByRole("button", { name: /Josh x Lucas/ }).click();
      const stack = page.getByTestId("files-stack");
      await expect(stack).toHaveAttribute("data-stack-kind", "recording");
      await expect(stack.locator("[data-stack-section]")).toHaveCount(2);
      await expect(editorOf(page, transcript)).toContainText("John: Hey.");
      await expect(editorOf(page, summary)).toContainText("Printing timeline.");
      // The transcript's own heading is its title; the stack draws no second one.
      await expect(section(page, transcript).locator(".opal-stack-header")).toHaveAttribute("data-quiet", "");

      await editorOf(page, transcript).getByText("John: Hey.").click();
      await page.keyboard.press("Meta+ArrowDown");
      // One insert, not a key per letter, so a key typed elsewhere on this Mac cannot land between them.
      await page.keyboard.insertText("Lucas: Fixed a label.");
      await expect(editorOf(page, transcript)).toContainText("Lucas: Fixed a label.");
      await expect.poll(() => readFile(transcript, "utf8"), { timeout: 10000 }).toBe(`${transcriptText}Lucas: Fixed a label.`);
      expect(await readFile(summary, "utf8")).toBe(summaryText);

      // The transcript still opens on its own, as a page with its inline title.
      await section(page, transcript).getByRole("button", { name: `Open ${stem} transcript on its own` }).click();
      await expect(page.getByTestId("files-stack")).toHaveCount(0);
      await expect(page.locator(".cm-md-inline-title")).toHaveText(`${stem} transcript`);

      // A recording not split yet is one file, and reads as one page.
      await card.getByRole("button", { name: /Old call/ }).click();
      await expect(stack).toHaveAttribute("data-lone", "");
      await expect(stack.locator("[data-stack-section]")).toHaveCount(1);
      await expect(editorOf(page, unsplit)).toContainText("Lucas: Hello.");
      await expect(section(page, unsplit).getByRole("button", { name: /^(Fold|Unfold) / })).toHaveCount(0);
    } finally {
      await app.close();
    }
  } finally {
    await vault.cleanup();
  }
});

test("a thread card opens its sessions below it, newest open, follows a session's link to it, and keeps folds across a relaunch", async ({
  userDataDir,
}) => {
  const vault = await createTempVault();
  try {
    const root = await realpath(vault.root);
    const today = dayBefore(0);
    const earlier = dayBefore(3);
    await makeVault(root);
    const chats = path.join(root, "Library/chats");
    await mkdir(path.join(chats, "sf-site-one"), { recursive: true });
    const card = path.join(chats, "sf-site-one.md");
    const older = path.join(chats, "sf-site-one", `${earlier}-claude-1486ab75.md`);
    const newer = path.join(chats, "sf-site-one", `${today}-claude-f30001cd.md`);
    await writeFile(card, [
      "---", "type: thread", "title: SF Site One", "status: pinned", `created: "${earlier} 09:00"`, "---", "",
      "# SF Site One", "", "## Sessions", "",
      `- [[Library/chats/sf-site-one/${earlier}-claude-1486ab75|${earlier} · Claude · 2 prompts]]`,
      `- [[Library/chats/sf-site-one/${today}-claude-f30001cd|${today} · Claude · 1 prompt]]`, "",
    ].join("\n"));
    const session = (date: string, text: string, prompts: number) => [
      "---", "type: thread-transcript", 'thread: "[[Library/chats/sf-site-one]]"', "tool: claude",
      `started: "${date} 09:00"`, `last: "${date} 09:30"`, `prompts: ${prompts}`, "---", "",
      `# SF Site One · Claude · ${date}`, "", `**Cody** · ${date} 09:00`, "", text, "",
    ].join("\n");
    await writeFile(older, session(earlier, "Older session text.", 2));
    await writeFile(newer, session(today, "Newer session text.", 1));
    await seedRoots(userDataDir, [root]);
    let app = await launchOpal(userDataDir);
    try {
      let page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      const sidebar = await daySidebar(page);
      await sidebar.getByRole("region", { name: "Chats" }).getByRole("button", { name: /SF Site One/ }).click();
      const stack = page.getByTestId("files-stack");
      await expect(stack).toHaveAttribute("data-stack-kind", "chat");
      const paths = () => stack.locator("[data-stack-section]").evaluateAll((found) => found.map((element) => (element as HTMLElement).dataset.stackSection));
      await expect.poll(paths).toEqual([card, newer, older]);
      await expect(editorOf(page, newer)).toContainText("Newer session text.");
      await expect(section(page, older)).not.toHaveAttribute("data-open", "");
      await expect(section(page, older).getByRole("heading")).toContainText(`${earlier} · Claude`);

      // The older session's link in the card unfolds it and brings it to the top.
      await editorOf(page, card).getByText(`${earlier} · Claude · 2 prompts`).click();
      await expect(editorOf(page, older)).toContainText("Older session text.");
      await expect
        .poll(() => stack.evaluate((element, file) => {
          const target = element.querySelector<HTMLElement>(`[data-stack-section="${CSS.escape(file)}"]`);
          return target ? Math.abs(element.scrollTop - Math.min(target.offsetTop, element.scrollHeight - element.clientHeight)) : null;
        }, older))
        .toBeLessThan(2);
      await expect(page.getByTestId("tab-strip").getByRole("tab")).toHaveCount(1);

      // Fold the newest session, then quit and launch again.
      await section(page, newer).getByRole("button", { name: `Fold ${today}-claude-f30001cd` }).click();
      await expect(section(page, newer)).not.toHaveAttribute("data-open", "");
      await app.close();

      app = await launchOpal(userDataDir);
      page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      const again = page.getByTestId("files-stack");
      await expect(again).toHaveAttribute("data-stack-kind", "chat");
      await expect(section(page, newer)).toBeAttached();
      await expect(section(page, newer)).not.toHaveAttribute("data-open", "");
      await expect(section(page, older)).toHaveAttribute("data-open", "");
      await expect(editorOf(page, older)).toContainText("Older session text.");
    } finally {
      await app.close();
    }
  } finally {
    await vault.cleanup();
  }
});
