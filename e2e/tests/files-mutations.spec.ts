import { mkdir, realpath, stat, writeFile } from 'fs/promises';
import path from 'path';
import { expect, test } from '../fixtures/electronApp';
import { createTempVault, seedRoots, type TempVault } from '../helpers/tempVault';

let vault: TempVault;
let vaultRoot: string;

const exists = (target: string) => stat(target).then(() => true).catch(() => false);

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

test('creates, renames, and moves real files on disk', async ({ page }) => {
  await page.evaluate(() => {
    window.location.hash = '#/files';
  });
  await page.waitForSelector('[role="tree"]');

  const created = await page.evaluate(
    (root) => window.diskAPI.createDirectory(root, 'E2E Folder'),
    vaultRoot
  );
  expect(created.success).toBe(true);
  expect(await exists(path.join(vaultRoot, 'E2E Folder'))).toBe(true);

  const renamed = await page.evaluate(
    (root) => window.diskAPI.rename(`${root}/E2E Folder`, 'Renamed Folder'),
    vaultRoot
  );
  expect(renamed.success).toBe(true);
  expect(await exists(path.join(vaultRoot, 'Renamed Folder'))).toBe(true);
  expect(await exists(path.join(vaultRoot, 'E2E Folder'))).toBe(false);

  const moved = await page.evaluate(
    (root) => window.diskAPI.move(`${root}/readme.md`, `${root}/Renamed Folder`),
    vaultRoot
  );
  expect(moved.success).toBe(true);
  expect(await exists(path.join(vaultRoot, 'Renamed Folder', 'readme.md'))).toBe(true);
  expect(await exists(path.join(vaultRoot, 'readme.md'))).toBe(false);
});

test('refuses every mutation outside an opened root', async ({ page }) => {
  const forbidden = path.join(path.dirname(vaultRoot), 'Forbidden');
  await mkdir(forbidden, { recursive: true });
  await writeFile(path.join(forbidden, 'secret.txt'), 'do not touch');

  await page.evaluate(() => {
    window.location.hash = '#/files';
  });
  await page.waitForSelector('[role="tree"]');

  const results = await page.evaluate(async (dir) => ({
    create: await window.diskAPI.createDirectory(dir, 'nope'),
    rename: await window.diskAPI.rename(`${dir}/secret.txt`, 'renamed.txt'),
    trash: await window.diskAPI.trash(`${dir}/secret.txt`),
  }), forbidden);

  expect(results.create.success).toBe(false);
  expect(results.rename.success).toBe(false);
  expect(results.trash.success).toBe(false);
  expect(await exists(path.join(forbidden, 'secret.txt'))).toBe(true);
  expect(await exists(path.join(forbidden, 'nope'))).toBe(false);
});
