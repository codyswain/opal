import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { appendFile, mkdir, readFile, realpath, writeFile } from "fs/promises";
import path from "path";
import { expect, test } from "../fixtures/electronApp";
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

