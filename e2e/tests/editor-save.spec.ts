import { _electron as electron } from "@playwright/test";
import { chmod, mkdir, readFile, readdir, realpath, writeFile } from "fs/promises";
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

test("quitting over a note that cannot be saved asks first and keeps a copy", async ({
  userDataDir,
}) => {
  const vault = await createTempVault();
  const root = await realpath(vault.root);
  const folder = path.join(root, "Locked");
  const note = path.join(folder, "plain.md");
  await mkdir(folder);
  await writeFile(note, "# Plain\n");
  try {
    await seedRoots(userDataDir, [root]);
    const app = await electron.launch({
      args: [PROJECT_ROOT],
      env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userDataDir },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    // The native dialog answers Cancel, then Quit anyway.
    await app.evaluate(({ dialog }) => {
      const answers = [0, 1];
      const asked: string[] = [];
      Object.assign(globalThis, { asked });
      dialog.showMessageBox = (async (_window: unknown, options: { message: string }) => {
        asked.push(options.message);
        return { response: answers.shift() ?? 1, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    });
    await page.evaluate((target) => {
      window.location.hash = `#/files?mode=focus&dir=${encodeURIComponent(target.slice(0, target.lastIndexOf("/")))}&file=${encodeURIComponent(target)}`;
    }, note);
    await page.getByTestId("markdown-editor").click();
    await page.keyboard.press("Meta+ArrowDown");
    await chmod(folder, 0o555);
    await page.keyboard.type("Typed into a locked folder.");
    const asked = () => app.evaluate(() => (globalThis as unknown as { asked: string[] }).asked);
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await expect.poll(asked).toEqual(["1 note could not be saved"]);
    // Cancel keeps the window and the page.
    await expect(page.getByTestId("markdown-editor")).toContainText("Typed into a locked folder.");
    const exited = new Promise((resolve) => app.process().once("exit", resolve));
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await exited;
    expect(await readFile(note, "utf8")).toBe("# Plain\n");
    const recovered = path.join(userDataDir, "Recovered");
    // One copy for each time the quit asked.
    expect((await readdir(recovered)).sort()).toEqual(["plain (unsaved copy) 2.md", "plain (unsaved copy).md"]);
    expect(await readFile(path.join(recovered, "plain (unsaved copy) 2.md"), "utf8")).toBe("# Plain\nTyped into a locked folder.");
  } finally {
    await chmod(folder, 0o755).catch(() => undefined);
    await vault.cleanup();
  }
});
