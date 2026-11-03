import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '../fixtures/electronApp';
import { seedRoots } from '../helpers/tempVault';

let dir: string;
let vaultRoot: string;

/** Names shaped like a vault's: a person's note beside newer date-prefixed notes about them. */
const FILES: Record<string, string> = {
  'Library/people/Ada Lovelace.md': '# Ada Lovelace\n',
  'Library/people/grace hopper.md': '# Grace Hopper\n',
  'Library/1-on-1s/2026-10-27 Ada Lovelace (draft).md': '# Draft\n',
  'Library/offers/Ada Lovelace Offer Letter.pdf': 'pdf',
  'Library/data/freight-large-dataset.md': '# Freight\n',
  'Library/data/freight_box_r4.png': 'png',
  'Library/chats/opal-status.md': '# Opal status\n',
  'Library/chats/garden/2026-09-28-codex-01a0e734.md': '---\ntitle: Garden plan for spring\n---\n# Session\n',
};

test.beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'opal-e2e-switcher-'));
  vaultRoot = path.join(dir, 'Vault');
  for (const [name, text] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(vaultRoot, name)), { recursive: true });
    await writeFile(path.join(vaultRoot, name), text);
  }
  // The person's note is the oldest, so only the ranking can put it first.
  const old = new Date('2026-01-01T00:00:00Z');
  await utimes(path.join(vaultRoot, 'Library/people/Ada Lovelace.md'), old, old);
  vaultRoot = await realpath(vaultRoot);
});

test.afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

test.beforeEach(async ({ userDataDir }) => {
  await seedRoots(userDataDir, [vaultRoot]);
});

/** The File menu's shown items, as `label accelerator`. */
const fileMenu = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items.find((menu) => menu.label === 'File')?.submenu?.items ?? [])
      .filter((item) => item.visible && item.type !== 'separator')
      .map((item) => `${item.label}${item.accelerator ? ` ${item.accelerator}` : ''}`));

/** Clicks the shown menu item with this accelerator, as the key would. */
const pressMenuKey = (app: ElectronApplication, accelerator: string) =>
  app.evaluate(({ Menu }, wanted) => {
    for (const menu of Menu.getApplicationMenu()?.items ?? []) {
      for (const item of menu.submenu?.items ?? []) {
        if (item.accelerator === wanted && item.visible) {
          item.click();
          return true;
        }
      }
    }
    return false;
  }, accelerator);

/** The Files rows in order, as paths from the top of the vault. */
const fileRows = (page: Page) =>
  page.getByRole('group', { name: 'Files', exact: true }).locator('[data-testid^="palette-file-"]')
    .evaluateAll((rows, root) => rows.map((row) => (row.getAttribute('data-testid') ?? '').replace(`palette-file-${root}/`, '')), vaultRoot)
    .catch(() => []);

/**
 * One launch: Cmd+O is a menu accelerator, which exists only in a real
 * Electron process, and the ranking runs on the index main builds from disk.
 */
test('Cmd+O opens the file switcher, which puts the best match first', async ({ electronApp, page }) => {
  await expect(page.getByTestId(`disk-tree-item-${vaultRoot}/Library`)).toBeVisible();
  await expect.poll(() => fileMenu(electronApp)).toContain('Go to File… CmdOrCtrl+O');
  expect((await fileMenu(electronApp)).filter((item) => item.startsWith('Open Folder'))).toEqual([]);

  expect(await pressMenuKey(electronApp, 'CmdOrCtrl+O')).toBe(true);
  const input = page.getByRole('combobox', { name: 'Search files and commands' });
  await expect(input).toHaveAttribute('placeholder', 'Open a file');

  await input.fill('Ada Lovelace');
  await expect.poll(() => fileRows(page)).toEqual([
    'Library/people/Ada Lovelace.md',
    'Library/offers/Ada Lovelace Offer Letter.pdf',
    'Library/1-on-1s/2026-10-27 Ada Lovelace (draft).md',
  ]);
  await input.fill('freight');
  await expect.poll(() => fileRows(page)).toEqual(['Library/data/freight-large-dataset.md', 'Library/data/freight_box_r4.png']);
  await input.fill('opal status');
  await expect.poll(() => fileRows(page)).toEqual(['Library/chats/opal-status.md']);
  await input.fill('hopper grace');
  await expect.poll(() => fileRows(page)).toEqual(['Library/people/grace hopper.md']);
  // The title is read after the names, in the background.
  await input.fill('spring plan');
  await expect.poll(() => fileRows(page)).toEqual(['Library/chats/garden/2026-09-28-codex-01a0e734.md']);

  await input.fill('Ada Lovelace');
  await expect.poll(() => fileRows(page)).toContain('Library/people/Ada Lovelace.md');
  await input.press('Enter');
  await expect(page.getByTestId('tab-strip').getByRole('tab').filter({ hasText: 'Ada Lovelace' })).toBeVisible();
});
