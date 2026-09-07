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

  // The newer namespaces cross the same boundary with the same guard: activity
  // refuses paths outside opened roots, a collection scoped outside them
  // reports the scope instead of searching elsewhere, and a saved view's
  // revision check holds through IPC.
  const boundary = await page.evaluate(async () => {
    const query = {
      version: 1 as const,
      scope: { kind: 'folders' as const, folders: ['/etc'], includeDescendants: true },
      filters: [] as never[],
      sort: { field: 'name' as const, direction: 'asc' as const },
    };
    const created = await window.viewsAPI.create({ name: 'Boundary check', layout: 'list', query });
    const stale = created.success
      ? await window.viewsAPI.save(created.data.id, { name: 'Changed', layout: 'list', query }, 'not-the-revision')
      : null;
    return {
      activity: await window.activityAPI.record('/etc/hosts', 'opened'),
      collection: await window.collectionsAPI.query(query),
      created: created.success,
      stale,
    };
  });

  expect(boundary.activity.success).toBe(false);
  expect(boundary.collection.success).toBe(true);
  expect(boundary.collection.data?.unavailableScopes).toEqual(['/etc']);
  expect(boundary.collection.data?.rows).toEqual([]);
  expect(boundary.created).toBe(true);
  expect(boundary.stale).toMatchObject({ success: false, conflict: true });
});
