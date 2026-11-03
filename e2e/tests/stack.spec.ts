import { mkdir, readFile, realpath, writeFile } from "fs/promises";
import path from "path";
import type { Page } from "@playwright/test";
import { expect, launchOpal, test } from "../fixtures/electronApp";
import { createTempVault, seedRoots } from "../helpers/tempVault";

/** The local date `offset` days before today, as the daily pages name it. */
function dayBefore(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const section = (page: Page, file: string) => page.locator(`[data-stack-section="${file}"]`);
const editorOf = (page: Page, file: string) => section(page, file).getByTestId("markdown-editor");

/**
 * Only a real window shows several CodeMirror views sharing one scroll,
 * each saving its own file, and the quit waiting for all of them. The
 * window and stack logic is covered by unit tests.
 */
test("The daily stream saves two typed sections on quit, and takes an append to a lower one while the top one is typed in", async ({
  userDataDir,
}) => {
  const vault = await createTempVault();
  try {
    const root = await realpath(vault.root);
    const daily = path.join(root, "Library/daily");
    await mkdir(daily, { recursive: true });
    const today = path.join(daily, `${dayBefore(0)}.md`);
    const yesterday = path.join(daily, `${dayBefore(1)}.md`);
    const older = path.join(daily, `${dayBefore(2)}.md`);
    await writeFile(yesterday, "Yesterday's page.\n");
    await writeFile(older, "An older page.\n");
    await seedRoots(userDataDir, [root]);
    const app = await launchOpal(userDataDir);
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Launch opens Daily: today's page, created from no template, on top.
    await expect(page.getByTestId("files-stack")).toBeVisible();
    await expect(section(page, older)).toBeVisible();
    await expect(page.getByRole("tab", { name: /Daily/ })).toBeVisible();
    await editorOf(page, today).click();
    await page.keyboard.press("Meta+ArrowDown");
    await page.keyboard.type("Typed in today.");
    await expect(editorOf(page, today)).toContainText("Typed in today.");

    // Another Mac appends to yesterday's page while the top one has unsaved text.
    await writeFile(yesterday, "Yesterday's page.\nAppended elsewhere.\n");
    await expect(editorOf(page, yesterday)).toContainText("Appended elsewhere.");
    await expect(editorOf(page, today)).toContainText("Typed in today.");

    await editorOf(page, yesterday).click();
    await page.keyboard.press("Meta+ArrowDown");
    await page.keyboard.type("Typed lower down.");
    await expect(editorOf(page, yesterday)).toContainText("Typed lower down.");

    // The quit carries both edits inside the autosave delay.
    await app.close();
    expect(await readFile(today, "utf8")).toMatch(/Typed in today\.$/);
    expect(await readFile(yesterday, "utf8")).toBe("Yesterday's page.\nAppended elsewhere.\nTyped lower down.");
    expect(await readFile(older, "utf8")).toBe("An older page.\n");
  } finally {
    await vault.cleanup();
  }
});

test("scrolling Daily loads earlier pages, keeps few editors, and the right sidebar follows the page at the top", async ({
  userDataDir,
}) => {
  const vault = await createTempVault();
  try {
    const root = await realpath(vault.root);
    const daily = path.join(root, "Library/daily");
    await mkdir(daily, { recursive: true });
    const pages = 40;
    for (let offset = 1; offset <= pages; offset += 1) {
      const lines = Array.from({ length: 12 }, (_, line) => `Line ${line + 1} of ${dayBefore(offset)}.`);
      await writeFile(path.join(daily, `${dayBefore(offset)}.md`), `${lines.join("\n")}\n`);
    }
    await seedRoots(userDataDir, [root]);
    const app = await launchOpal(userDataDir);
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 900 }));
      const stack = page.getByTestId("files-stack");
      await expect(stack).toBeVisible();
      const sections = stack.locator("[data-stack-section]");
      await expect.poll(() => sections.count()).toBeGreaterThan(5);
      expect(await sections.count()).toBeLessThan(pages + 1);

      await stack.hover();
      const atEnd = () => stack.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 2);
      for (let step = 0; step < 120 && !(await atEnd()); step += 1) {
        await page.mouse.wheel(0, 1500);
        await page.waitForTimeout(40);
      }
      expect(await atEnd()).toBe(true);
      await expect(page.getByText("No earlier pages")).toBeInViewport();
      await expect(sections).toHaveCount(pages + 1);
      expect(await stack.locator(".cm-editor").count()).toBeLessThanOrEqual(12);

      // The sidebar shows the day of the page 80px below the top of the view.
      await page.waitForTimeout(400);
      const atTop = await stack.evaluate((element) => {
        const probe = element.scrollTop + 80;
        const found = [...element.querySelectorAll<HTMLElement>("[data-stack-section]")].filter((article) => article.offsetTop <= probe).pop();
        return found?.dataset.stackSection?.match(/(\d{4})-(\d{2})-(\d{2})\.md$/)?.slice(1).map(Number) ?? null;
      });
      expect(atTop).not.toBeNull();
      const [year, month, date] = atTop as number[];
      expect(new Date(year, month - 1, date) < new Date(Date.now() - 30 * 86_400_000)).toBe(true);
      const label = new Date(year, month - 1, date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      await expect(page.getByTestId("day-sidebar").locator(".drag-handle")).toContainText(label);
    } finally {
      await app.close();
    }
  } finally {
    await vault.cleanup();
  }
});
