import { existsSync } from "fs";
import { mkdir, realpath, writeFile } from "fs/promises";
import path from "path";
import { expect, test } from "../fixtures/electronApp";
import { createTempVault, seedRoots, type TempVault } from "../helpers/tempVault";

/** Real-process launch and vault IPC check; page behavior is covered by unit tests. */
test("app without a vault launches into the Library", async ({
  page,
  userDataDir,
}) => {
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("workspace-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Threads" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toMatch(/^#\/files/);
  const discovery = await page.evaluate(() => window.vaultAPI.discover());
  expect(discovery).toEqual({ success: true, data: [] });
  // The Chromium profile must live in the test directory too, or every run
  // reads and writes the real profile's localStorage preferences.
  await page.evaluate(() => localStorage.setItem("opal.e2e-probe", "1"));
  expect(existsSync(path.join(userDataDir, "Local Storage"))).toBe(true);
});

test.describe("with a vault", () => {
  let vault: TempVault;
  let root: string;

  test.beforeAll(async () => {
    vault = await createTempVault();
    await mkdir(path.join(vault.root, "Inbox/Logs"), { recursive: true });
    root = await realpath(vault.root);
  });

  test.afterAll(async () => {
    await vault.cleanup();
  });

  test.beforeEach(async ({ userDataDir }) => {
    await seedRoots(userDataDir, [root]);
  });

  test("launches into today's log page", async ({ page }) => {
    const date = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    });
    const log = path.join(root, "Inbox/Logs", `${date}.md`);
    await expect
      .poll(() => page.evaluate(() => decodeURIComponent(window.location.hash)))
      .toContain(`file=${log}`);
    expect(existsSync(log)).toBe(true);
    await writeFile(log, "Kept as written\n");
    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByText("Kept as written")).toBeVisible();
  });
});
