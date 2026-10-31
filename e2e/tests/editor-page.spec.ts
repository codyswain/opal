import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { appendFile, mkdir, readFile, realpath, writeFile } from "fs/promises";
import path from "path";
import { expect, test } from "../fixtures/electronApp";
import { greySpread, pngGreys } from "../helpers/png";
import { createTempVault, seedRoots, type TempVault } from "../helpers/tempVault";

const PROJECT_ROOT = path.join(__dirname, "../..");

let vault: TempVault;
let root: string;
let app: ElectronApplication | null = null;

test.beforeEach(async ({ userDataDir }) => {
  vault = await createTempVault();
  root = await realpath(vault.root);
  await seedRoots(userDataDir, [root]);
});

test.afterEach(async () => {
  await app?.close();
  app = null;
  await vault.cleanup();
});

async function launch(userDataDir: string): Promise<Page> {
  app = await electron.launch({
    args: [PROJECT_ROOT],
    env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return page;
}

/** Opens a note the way the route does, keeping `folder` as the folder it was opened from. */
async function openNote(page: Page, file: string, folder = path.dirname(file)) {
  await page.evaluate(([target, from]) => {
    window.location.hash = `#/files?mode=focus&dir=${encodeURIComponent(from)}&file=${encodeURIComponent(target)}`;
  }, [file, folder]);
  await expect(page.locator(".cm-md-inline-title")).toHaveText(path.basename(file, ".md"));
}

test("a page stays mounted while other folders refresh, so typing lands", async ({ userDataDir }) => {
  const log = path.join(root, "Logs", "today.md");
  const person = path.join(root, "People", "Alec Chen.md");
  await mkdir(path.dirname(log), { recursive: true });
  await mkdir(path.dirname(person), { recursive: true });
  await writeFile(log, "# Today\n");
  await writeFile(person, "# Alec Chen\n");
  const page = await launch(userDataDir);
  await openNote(page, log);
  // A link from the log opens the person page and keeps the log's folder, so
  // the page's own folder listing is never loaded.
  await openNote(page, person, path.dirname(log));
  await page.locator(".cm-editor").evaluate((editor) => { editor.setAttribute("data-first-mount", ""); });
  await page.getByTestId("markdown-editor").click();
  await page.keyboard.press("Meta+ArrowDown");
  for (let line = 1; line <= 4; line += 1) {
    await appendFile(log, `- hook line ${line}\n`);
    await page.keyboard.type(` word${line}`, { delay: 20 });
    await page.waitForTimeout(300);
  }
  await expect(page.locator(".cm-editor[data-first-mount]")).toHaveCount(1);
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".cm-editor")))).toBe(true);
  await expect.poll(() => readFile(person, "utf8")).toBe("# Alec Chen\n word1 word2 word3 word4");
});

test("list numbers of 10 and up stay on one line, and a click in a table leaves the page where it was", async ({ userDataDir }) => {
  const note = path.join(root, "Lists.md");
  const items = Array.from({ length: 12 }, (_, index) => `${index + 1}. item ${index + 1}`).join("\n");
  const rows = Array.from({ length: 4 }, (_, index) => `| ${index} | ${"a long cell that wraps inside its column ".repeat(3)}|`).join("\n");
  await writeFile(note, `${items}\n\n| # | Cell |\n|--|--|\n${rows}\n`);
  const page = await launch(userDataDir);
  await openNote(page, note);
  const heights = await page.locator(".cm-md-list").evaluateAll((lines) => lines.map((line) => line.getBoundingClientRect().height));
  expect(heights).toHaveLength(12);
  expect(Math.max(...heights)).toBeLessThan(Math.min(...heights) * 1.2);
  const table = page.locator(".cm-md-table");
  await table.scrollIntoViewIfNeeded();
  const box = () => table.evaluate((frame) => { const { top, height } = frame.getBoundingClientRect(); return { top, height }; });
  const before = await box();
  await page.locator(".cm-md-table td").nth(3).click();
  await expect(page.locator(".cm-md-cell-caret")).toHaveCount(1);
  expect(await box()).toEqual(before);
  // Enter shows the source, one line per row.
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-md-table-source")).toHaveCount(6);
  const rowHeights = await page.locator(".cm-md-table-source").evaluateAll((lines) => lines.map((line) => line.getBoundingClientRect().height));
  expect(Math.max(...rowHeights)).toBeLessThan(Math.min(...rowHeights) * 1.2);
  expect(await readFile(note, "utf8")).toContain("| 0 |");
});

/** Only Chromium paints the scrollbar, so only a real window can show the thumb is hidden at rest. */
test("the page shows no scrollbar at rest, a thumb while it scrolls, and none again a second later", async ({ userDataDir }) => {
  const note = path.join(root, "Long.md");
  await writeFile(note, Array.from({ length: 300 }, (_, index) => `Line ${index + 1} of a long page.`).join("\n\n"));
  const page = await launch(userDataDir);
  await openNote(page, note);
  const scroller = page.locator(".cm-scroller");
  const box = await scroller.evaluate((element) => {
    const { right, top, height } = element.getBoundingClientRect();
    return { right, top, height };
  });
  // The strip of the scroller's right edge where the scrollbar sits.
  const strip = () =>
    page.screenshot({ clip: { x: box.right - 10, y: box.top + 8, width: 10, height: box.height - 16 } });
  await expect(scroller).not.toHaveAttribute("data-scrollbar", "shown", { timeout: 5000 });
  await page.waitForTimeout(400);
  expect(greySpread(await strip())).toBeLessThan(4);

  await page.mouse.move(box.right - 200, box.top + 200);
  await page.mouse.wheel(0, 600);
  await expect(scroller).toHaveAttribute("data-scrollbar", "shown");
  expect(greySpread(await strip())).toBeGreaterThan(15);

  await expect(scroller).toHaveAttribute("data-scrollbar", "hidden", { timeout: 3000 });
  await page.waitForTimeout(400);
  expect(greySpread(await strip())).toBeLessThan(4);
});

test("the page runs to the card's edge under its footer, so a cut-off callout fades out", async ({ userDataDir }) => {
  const note = path.join(root, "Callout.md");
  const lines = Array.from({ length: 80 }, (_, index) => `> Line ${index + 1} of a long callout.`).join("\n>\n");
  await writeFile(note, `# Callout\n\n> [!ai] Codex\n${lines}\n`);
  const page = await launch(userDataDir);
  await openNote(page, note);
  const edges = await page.evaluate(() => {
    const bottom = (selector: string) => (document.querySelector(selector) as Element).getBoundingClientRect();
    const card = bottom("main").bottom;
    const scroller = bottom(".cm-scroller");
    const status = bottom(".opal-editor-status");
    const callout = bottom(".cm-md-callout-first");
    return { card, scroller: scroller.bottom, statusTop: status.top, statusBottom: status.bottom, left: callout.left, right: callout.right };
  });
  // The scroller ends at the card's border, under the footer, not above it.
  expect(Math.abs(edges.card - 1 - edges.scroller)).toBeLessThanOrEqual(1);
  expect(Math.abs(edges.statusBottom - edges.scroller)).toBeLessThanOrEqual(1);
  expect(edges.statusTop).toBeLessThan(edges.scroller - 30);
  // At the card's edge the callout has faded into the page: the strip across
  // it has the page's own colour, as the margin beside it does.
  const y = edges.scroller - 4;
  const strip = await page.screenshot({ clip: { x: edges.left + 4, y, width: Math.min(300, edges.right - edges.left - 8), height: 3 } });
  const margin = await page.screenshot({ clip: { x: edges.left - 24, y, width: 16, height: 3 } });
  expect(greySpread(strip)).toBeLessThan(4);
  expect(Math.abs(meanGrey(strip) - meanGrey(margin))).toBeLessThan(2);
  // The footer floats over the text but its line still takes the click.
  await page.locator("[data-properties-toggle]").click();
  await expect(page.locator("[data-properties-toggle]")).toHaveAttribute("aria-pressed", "true");
});

function meanGrey(png: Buffer): number {
  const image = pngGreys(png);
  let sum = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) sum += image.grey(x, y);
  return sum / (image.width * image.height);
}
