import { existsSync } from "fs";
import { mkdir, realpath, writeFile } from "fs/promises";
import path from "path";
import { expect, test } from "../fixtures/electronApp";
import { createTempVault, seedRoots, type TempVault } from "../helpers/tempVault";

/** Real-process launch and vault IPC check; page behavior is covered by unit tests. */
test("app without a vault launches with the sidebar", async ({
  page,
  userDataDir,
}) => {
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("workspace-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recent" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Library" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Threads" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toMatch(/^#\/files/);
  // The UI font ships in the bundle; the CSP must let the page load it.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some(
          (face) => face.family.includes("Inter Variable") && face.status === "loaded",
        );
      }),
    )
    .toBe(true);
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
    await mkdir(path.join(vault.root, "Library/logs"), { recursive: true });
    root = await realpath(vault.root);
  });

  test.afterAll(async () => {
    await vault.cleanup();
  });

  test.beforeEach(async ({ userDataDir }) => {
    await seedRoots(userDataDir, [root]);
  });

  test("launches into today's daily page, and the day's files cross the bridge", async ({ page }) => {
    const date = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    });
    const daily = path.join(root, "Library/daily", `${date}.md`);
    await expect
      .poll(() => page.evaluate(() => decodeURIComponent(window.location.hash)))
      .toContain(`file=${daily}`);
    expect(existsSync(daily)).toBe(true);
    await writeFile(daily, "Kept as written\n");
    // The tab is named Today too, so its close button also matches a loose name.
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByText("Kept as written")).toBeVisible();

    const log = path.join(root, "Library/logs", `${date} log.md`);
    await page.evaluate((target) => {
      const changes: string[] = [];
      (window as unknown as { dayChanges: string[] }).dayChanges = changes;
      window.vaultAPI.onDayChanged((change) => changes.push(`${change.root} ${change.date}`));
      return window.vaultAPI.day(target.root, target.date);
    }, { root, date });
    await writeFile(log, "---\ntype: log\n---\n- 09:00 Ran the digest. · routine run\n");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { dayChanges: string[] }).dayChanges))
      .toContain(`${root} ${date}`);
    const day = await page.evaluate((target) => window.vaultAPI.day(target.root, target.date), { root, date });
    expect(day).toMatchObject({
      success: true,
      data: { date, daily, log, entries: [{ time: "09:00", text: "Ran the digest.", kind: "routine run" }] },
    });
  });
});
