import { appendFile, mkdir, realpath, writeFile } from "fs/promises";
import path from "path";
import { expect, test } from "../fixtures/electronApp";
import { createTempVault, seedRoots, type TempVault } from "../helpers/tempVault";

let vault: TempVault;
let root: string;

test.beforeAll(async () => {
  vault = await createTempVault();
  await mkdir(path.join(vault.root, "Library/logs"), { recursive: true });
  root = await realpath(vault.root);
});

test.afterAll(async () => {
  await vault.cleanup();
});

test.beforeEach(async ({ userDataDir }) => {
  await seedRoots(userDataDir, [root]);
});

/** The disk watcher, the day IPC and the renderer together: a line appended to today's log shows in the open sidebar. */
test("the right sidebar shows a line appended to today's log", async ({ page }) => {
  const date = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const log = path.join(root, "Library/logs", `${date} log.md`);
  await writeFile(log, `---\nwritten_by: ai\ntype: log\ndate: ${date}\n---\n- 09:00 Ran the morning digest. · routine run\n`);

  // The launch window is narrow, so the right sidebar waits behind the left one until it is asked for.
  await expect(page.getByTestId("workspace-sidebar")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Show right sidebar" }).click();
  const sidebar = page.getByTestId("day-sidebar");
  await expect(sidebar.getByText("Today", { exact: true })).toBeVisible();
  const card = sidebar.getByRole("region", { name: "Activity log" });
  await expect(card.getByText("Ran the morning digest.")).toBeVisible();

  await appendFile(log, "- 09:05 Appended while the sidebar was open. · agent turn\n");
  await expect(card.getByText("Appended while the sidebar was open.")).toBeVisible({ timeout: 10000 });
  await expect(card.getByRole("button", { name: /^Activity log/ })).toContainText("2");
});
