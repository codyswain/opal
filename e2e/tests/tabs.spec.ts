import { realpath, writeFile } from 'fs/promises';
import path from 'path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, launchOpal, test } from '../fixtures/electronApp';
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

const tabs = (page: Page) =>
  page.$$eval('[data-testid="tab-strip"] [role="tab"]', (found) =>
    found.map((tab) => `${tab.getAttribute('aria-selected') === 'true' ? '*' : ''}${tab.textContent}`)
  );

/** Clicks a shown item of the real application menu, as a key equivalent would. */
const clickMenuItem = (app: ElectronApplication, label: string) =>
  app.evaluate(({ Menu }, wanted) => {
    for (const menu of Menu.getApplicationMenu()?.items ?? []) {
      for (const item of menu.submenu?.items ?? []) {
        if (item.label === wanted && item.visible) {
          item.click();
          return true;
        }
      }
    }
    return false;
  }, label);

/** A folder without Library/daily or Library/logs has no Daily, so launch leaves the page empty. */
async function openTwoTabs(page: Page) {
  await page.getByTestId(`disk-tree-item-${vaultRoot}/readme.md`).click();
  await page.getByTestId(`disk-tree-item-${vaultRoot}/Photos`).click();
  await page.getByTestId(`disk-tree-item-${vaultRoot}/Photos/alpha.png`).click({ modifiers: ['Meta'] });
  await expect.poll(() => tabs(page)).toEqual(['readme', '*alpha.png']);
}

/**
 * One launch-and-relaunch test: native menu accelerators and window titles
 * exist only in a real Electron process, and so does a restore across launches.
 */
test('tabs answer the native menu and come back on relaunch', async ({ userDataDir }) => {
  let app = await launchOpal(userDataDir);
  let page = await app.firstWindow();
  await expect(page.getByTestId('no-page-open')).toBeVisible();
  await openTwoTabs(page);
  const title = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
  await expect.poll(title).toBe('alpha.png');

  // Every accelerator in the menu is one Electron itself can parse; the
  // check registers nothing.
  const accelerators = await app.evaluate(({ Menu, globalShortcut }) =>
    (Menu.getApplicationMenu()?.items ?? []).flatMap((menu) =>
      (menu.submenu?.items ?? []).flatMap((item) => {
        if (!item.accelerator) return [];
        try {
          globalShortcut.isRegistered(item.accelerator);
          return [`${item.label} ${item.accelerator}`];
        } catch (error) {
          return [`${item.label} ${item.accelerator} rejected: ${String(error)}`];
        }
      })
    )
  );
  expect(accelerators.filter((line) => line.includes('rejected'))).toEqual([]);
  expect(accelerators).toEqual(
    expect.arrayContaining([
      'New Tab CmdOrCtrl+T',
      'Close Tab CmdOrCtrl+W',
      'Reopen Closed Tab CmdOrCtrl+Shift+T',
      'Show Previous Tab CmdOrCtrl+Shift+[',
      'Show Next Tab Ctrl+Tab',
      'Show Last Tab CmdOrCtrl+9',
      'Back CmdOrCtrl+[',
      'Forward CmdOrCtrl+]',
      'Toggle Sidebar CmdOrCtrl+\\',
      'Toggle Right Sidebar CmdOrCtrl+Shift+\\',
    ])
  );

  expect(await clickMenuItem(app, 'Show Next Tab')).toBe(true);
  await expect.poll(() => tabs(page)).toEqual(['*readme', 'alpha.png']);
  await expect.poll(title).toBe('readme');
  await clickMenuItem(app, 'Close Tab');
  await expect.poll(() => tabs(page)).toEqual(['*alpha.png']);
  await clickMenuItem(app, 'Reopen Closed Tab');
  await expect.poll(() => tabs(page)).toEqual(['*readme', 'alpha.png']);

  // Back and Forward walk the active tab's own history.
  await page.getByTestId(`disk-tree-item-${vaultRoot}/Photos/beta.png`).click();
  await expect.poll(() => tabs(page)).toEqual(['*beta.png', 'alpha.png']);
  await clickMenuItem(app, 'Back');
  await expect.poll(() => tabs(page)).toEqual(['*readme', 'alpha.png']);
  await app.close();

  // The same day, launch brings the tabs back, the active one included,
  // instead of opening Daily.
  app = await launchOpal(userDataDir);
  page = await app.firstWindow();
  await expect.poll(() => tabs(page)).toEqual(['*readme', 'alpha.png']);
  await expect
    .poll(() => page.evaluate(() => decodeURIComponent(window.location.hash)))
    .toContain(`file=${vaultRoot}/readme.md`);
  await clickMenuItem(app, 'Forward');
  await expect.poll(() => tabs(page)).toEqual(['*beta.png', 'alpha.png']);
  await app.close();
});

/** Real Cmd+click and middle-click events, which CodeMirror would otherwise take for its own. */
test('Cmd+click or middle-click on a wiki link opens its note in a new tab beside the page', async ({ userDataDir }) => {
  await writeFile(path.join(vaultRoot, 'Links.md'), 'See [[readme]] for more.\n');
  const app = await launchOpal(userDataDir);
  try {
    const page = await app.firstWindow();
    await page.getByTestId(`disk-tree-item-${vaultRoot}/Links.md`).click();
    await expect(page.locator('.cm-md-inline-title')).toHaveText('Links');
    await page.locator('.cm-md-wikilink').click({ modifiers: ['Meta'] });
    await expect.poll(() => tabs(page)).toEqual(['Links', '*readme']);
    await expect(page.locator('.cm-md-inline-title')).toHaveText('readme');
    await page.locator('[data-testid="tab-strip"] [role="tab"]', { hasText: 'Links' }).click();
    await page.locator('.cm-md-wikilink').click({ button: 'middle' });
    await expect.poll(() => tabs(page)).toEqual(['Links', '*readme', 'readme']);
  } finally {
    await app.close();
  }
});
