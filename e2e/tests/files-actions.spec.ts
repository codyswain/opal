import { realpath } from 'fs/promises';
import { expect, test } from '../fixtures/electronApp';
import { createTempVault, seedRoots, type TempVault } from '../helpers/tempVault';

let vault: TempVault;
let vaultRoot: string;

test.beforeAll(async () => {
  vault = await createTempVault();
  vaultRoot = await realpath(vault.root);
});

test.afterAll(async () => {
  await vault.cleanup();
});

test.beforeEach(async ({ userDataDir }) => {
  await seedRoots(userDataDir, [vaultRoot]);
});

test('refuses to reveal or open a path outside every opened root', async ({ page }) => {
  await page.evaluate(() => {
    window.location.hash = '#/files';
  });
  await page.waitForSelector('[role="tree"]');

  // The guard must hold for both OS-handoff channels. If either succeeds,
  // Opal can be made to act on any file the user can read.
  const results = await page.evaluate(async () => ({
    reveal: await window.diskAPI.reveal('/etc/hosts'),
    open: await window.diskAPI.openExternal('/etc/hosts'),
  }));

  expect(results.reveal.success).toBe(false);
  expect(results.open.success).toBe(false);
});
