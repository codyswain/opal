import { _electron as electron } from "@playwright/test";
import { readFile, realpath } from "fs/promises";
import path from "path";
import { expect, test } from "../fixtures/electronApp";
import { createTempVault, seedRoots } from "../helpers/tempVault";

const PROJECT_ROOT = path.join(__dirname, "../..");

/**
 * Only a real quit shows the main process holding the close until the
 * renderer's last save lands; page saving itself is covered by unit tests.
 */
test("quitting inside the autosave delay keeps what was typed", async ({
  userDataDir,
}) => {
  const vault = await createTempVault();
  try {
    const root = await realpath(vault.root);
    const note = path.join(root, "readme.md");
    await seedRoots(userDataDir, [root]);
    const app = await electron.launch({
      args: [PROJECT_ROOT],
      env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userDataDir },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate((target) => {
      window.location.hash = `#/files?mode=focus&dir=${encodeURIComponent(target.slice(0, target.lastIndexOf("/")))}&file=${encodeURIComponent(target)}`;
    }, note);
    await page.getByTestId("markdown-editor").click();
    await page.keyboard.press("Meta+ArrowDown");
    await page.keyboard.type("Typed just before quitting.");
    // The autosave has not run yet; the quit has to carry the edit.
    expect(await readFile(note, "utf8")).toBe("# Test Vault\n");
    await app.close();
    expect(await readFile(note, "utf8")).toBe(
      "# Test Vault\nTyped just before quitting.",
    );
  } finally {
    await vault.cleanup();
  }
});
