import { existsSync } from "fs";
import path from "path";
import { expect, test } from "../fixtures/electronApp";

/** Real-process launch and vault IPC check; page behavior is covered by unit tests. */
test("app launches into Today with the vault bridge available", async ({
  page,
  userDataDir,
}) => {
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("workspace-sidebar")).toBeVisible();
  await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Library" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "A home for your day" }),
  ).toBeVisible();
  const discovery = await page.evaluate(() => window.vaultAPI.discover());
  expect(discovery).toEqual({ success: true, data: [] });
  // The Chromium profile must live in the test directory too, or every run
  // reads and writes the real profile's localStorage preferences.
  await page.evaluate(() => localStorage.setItem("opal.e2e-probe", "1"));
  expect(existsSync(path.join(userDataDir, "Local Storage"))).toBe(true);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith("opal.viewDrafts")),
    ),
  ).toEqual([]);
});
