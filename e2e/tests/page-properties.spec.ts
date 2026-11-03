import type { ElectronApplication, Page } from "@playwright/test";
import { mkdir, realpath, stat, writeFile } from "fs/promises";
import path from "path";
import { expect, test } from "../fixtures/electronApp";
import { createTempVault, seedRoots, type TempVault } from "../helpers/tempVault";

let vault: TempVault;
let root: string;

test.beforeAll(async () => {
  vault = await createTempVault();
  root = await realpath(vault.root);
  await mkdir(path.join(root, "Library/daily"), { recursive: true });
  await mkdir(path.join(root, "Library/logs"), { recursive: true });
  await writeFile(path.join(root, "Library/daily/2026-10-28.md"), "---\ndate: 2026-10-28\ntags:\n  - daily\n---\n");
  await writeFile(
    path.join(root, "Library/logs/2026-10-28 log.md"),
    "---\nwritten_by: ai\ntype: log\ndate: 2026-10-28\n---\n- 09:00 Ran the morning digest. · routine run\n",
  );
});

test.afterAll(async () => {
  await vault.cleanup();
});

test.beforeEach(async ({ userDataDir }) => {
  await seedRoots(userDataDir, [root]);
});

/** Clicks a shown item of the real application menu, as its key equivalent would. */
const clickMenuItem = (app: ElectronApplication, label: string) =>
  app.evaluate(({ Menu }, wanted) => {
    for (const menu of Menu.getApplicationMenu()?.items ?? []) {
      for (const item of menu.submenu?.items ?? []) {
        if (item.label === wanted && item.visible) {
          item.click();
          return item.accelerator ?? "";
        }
      }
    }
    return null;
  }, label);

/** The shown labels of the View menu. */
const viewMenu = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? [])
      .find((menu) => menu.label === "View")
      ?.submenu?.items.filter((item) => item.visible && item.label).map((item) => item.label) ?? [],
  );

async function openNote(page: Page, file: string) {
  await page.evaluate(([target, from]) => {
    window.location.hash = `#/files?mode=focus&dir=${encodeURIComponent(from)}&file=${encodeURIComponent(target)}`;
  }, [file, path.dirname(file)]);
  await expect(page.locator(".cm-md-inline-title")).toHaveText(path.basename(file, ".md"));
}

/** The menu item, the IPC call and the main process together: the block shows the file facts the main process read. */
test("View > Show Properties opens the block under the title, and it stays open on a log page", async ({ electronApp, page }) => {
  const daily = path.join(root, "Library/daily/2026-10-28.md");
  // Launch opens Daily in a vault with Library/daily; the test's page comes after it.
  const today = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  // Daily is a stream of daily pages; its head's title is drawn by the stack.
  await expect(page.locator('[data-role="head"] .opal-stack-label')).toHaveText(today, { timeout: 15000 });
  await openNote(page, daily);
  const toggle = page.locator("[data-properties-toggle]");
  await expect(toggle).toHaveText("2 properties · 0 words");
  await expect(page.locator("[data-page-properties]")).toHaveCount(0);

  expect(await clickMenuItem(electronApp, "Show Properties")).toBe("CmdOrCtrl+Shift+I");
  const block = page.locator("[data-page-properties]");
  await expect(block).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const { size } = await stat(daily);
  await expect(block.locator("dt")).toHaveText(["date", "tags", "Path", "Created", "Modified", "Size"]);
  // A daily page's date is the day it was created.
  await expect(block.locator("dd")).toHaveText(["2026-10-28", "daily", "Library/daily/2026-10-28.md", "Oct 28, 2026", /2026 at \d\d:\d\d$/, `${size} bytes`]);
  // The menu now offers to close it.
  await expect.poll(() => viewMenu(electronApp)).toContain("Hide Properties");
  expect(await viewMenu(electronApp)).not.toContain("Show Properties");

  // Another page keeps the block open; a log page also says it is read-only.
  await openNote(page, path.join(root, "Library/logs/2026-10-28 log.md"));
  await expect(toggle).toHaveText(/^Read-only · 3 properties · \d+ words$/);
  await expect(block.locator("dd").first()).toHaveText("ai");
  await expect(block.locator("dt")).toHaveText(["written_by", "type", "date", "Path", "Created", "Modified", "Size"]);
  await expect(block.locator("dd").nth(4)).toHaveText("Oct 28, 2026");

  // Escape in the block closes it; the menu reads Show Properties again.
  await block.focus();
  await page.keyboard.press("Escape");
  await expect(block).toHaveCount(0);
  await expect.poll(() => viewMenu(electronApp)).toContain("Show Properties");
  await toggle.click();
  await expect(block).toBeVisible();
  await expect.poll(() => viewMenu(electronApp)).toContain("Hide Properties");
  expect(await clickMenuItem(electronApp, "Hide Properties")).toBe("CmdOrCtrl+Shift+I");
  await expect(block).toHaveCount(0);
});
