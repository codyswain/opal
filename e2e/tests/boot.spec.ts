import { expect, test } from "../fixtures/electronApp";

/** Real-process launch and vault IPC check; page behavior is covered by unit tests. */
test("app launches into Today with the vault bridge available", async ({
  page,
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
});
