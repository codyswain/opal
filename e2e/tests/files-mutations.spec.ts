import { mkdir, readFile, realpath, stat, writeFile } from 'fs/promises';
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

  // Metadata is authored by main and marshalled through preload. Exercise the
  // real boundary in this existing app session, not another slow UI scenario.
  const imagePath = path.join(vaultRoot, 'Photos', 'alpha.png');
  const notePath = path.join(vaultRoot, 'Renamed Folder', 'readme.md');
  const metadata = await page.evaluate(async ({ imagePath, notePath }) => {
    const initial = await window.metadataAPI.read(imagePath);
    if (!initial.success) throw new Error(initial.error);
    const saved = await window.metadataAPI.saveProperties(imagePath,
      { tags: ['reference'], description: 'A visual reference' }, initial.data.revision);
    if (!saved.success) throw new Error(saved.error);
    const connected = await window.metadataAPI.addRelated(imagePath, notePath);
    if (!connected.success) throw new Error(connected.error);
    const reverse = await window.metadataAPI.read(notePath);
    if (!reverse.success) throw new Error(reverse.error);
    const edge = reverse.data.related[0];
    if (!edge) throw new Error('Reverse connection missing');
    const removed = await window.metadataAPI.removeRelated(notePath, edge.edgeId);
    if (!removed.success) throw new Error(removed.error);
    return { saved: saved.data, reverse: reverse.data, remaining: await window.metadataAPI.read(imagePath) };
  }, { imagePath, notePath });

  expect(metadata.saved.properties).toEqual({ tags: ['reference'], description: 'A visual reference' });
  expect(metadata.reverse.related).toEqual([expect.objectContaining({
    direction: 'incoming', targetPath: imagePath, status: 'available',
  })]);
  expect(metadata.remaining).toMatchObject({ success: true, data: { related: [] } });
  expect(await readFile(`${imagePath}.opal.yaml`, 'utf8')).toContain('A visual reference');
  expect(await readFile(notePath, 'utf8')).toContain('# Test Vault');
});

test('refuses every mutation outside an opened root', async ({ page }) => {
  const forbidden = path.join(path.dirname(vaultRoot), 'Forbidden');
  const forbiddenFile = path.join(forbidden, 'secret.txt');
  const openedFile = path.join(vaultRoot, 'readme.md');
  await mkdir(forbidden, { recursive: true });
  await writeFile(forbiddenFile, 'do not touch');
  await writeFile(openedFile, '# still here');

  await page.evaluate(() => {
    window.location.hash = '#/files';
  });
  await page.waitForSelector('[role="tree"]');

  const results = await page.evaluate(async (dir) => ({
    create: await window.diskAPI.createDirectory(dir, 'nope'),
    rename: await window.diskAPI.rename(`${dir}/secret.txt`, 'renamed.txt'),
    trash: await window.diskAPI.trash(`${dir}/secret.txt`),
  }), forbidden);

  const moveResults = await page.evaluate(async ({ openedRoot, openedFile, forbiddenDir, forbiddenFile }) => ({
    fromForbiddenIntoOpenedRoot: await window.diskAPI.move(forbiddenFile, openedRoot),
    fromOpenedRootIntoForbidden: await window.diskAPI.move(openedFile, forbiddenDir),
  }), {
    openedRoot: vaultRoot,
    openedFile,
    forbiddenDir: forbidden,
    forbiddenFile,
  });

  expect(results.create.success).toBe(false);
  expect(results.rename.success).toBe(false);
  expect(results.trash.success).toBe(false);
  expect(moveResults.fromForbiddenIntoOpenedRoot.success).toBe(false);
  expect(moveResults.fromOpenedRootIntoForbidden.success).toBe(false);
  expect(await exists(openedFile)).toBe(true);
  expect(await exists(forbiddenFile)).toBe(true);
  expect(await exists(path.join(forbidden, 'nope'))).toBe(false);

  const metadataDenied = await page.evaluate(async ({ openedFile, forbiddenFile }) => [
    await window.metadataAPI.read(forbiddenFile),
    await window.metadataAPI.saveProperties(forbiddenFile, { tags: [], description: 'changed' }, 'stale'),
    await window.metadataAPI.addRelated(openedFile, forbiddenFile),
    await window.metadataAPI.removeRelated(forbiddenFile, '00000000-0000-4000-8000-000000000001'),
  ], { openedFile, forbiddenFile });
  expect(metadataDenied.every((result) => !result.success)).toBe(true);
  expect(await readFile(forbiddenFile, 'utf8')).toBe('do not touch');
  expect(await exists(`${forbiddenFile}.opal.yaml`)).toBe(false);
});
