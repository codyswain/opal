import { test, expect } from '../fixtures/electronApp';
import type { Page } from '@playwright/test';
import { createTempVault, seedRoots, type TempVault } from '../helpers/tempVault';
import { realpath } from 'fs/promises';

/**
 * The app uses a HashRouter loaded from a file:// URL, and the Playwright config
 * sets no baseURL, so page.goto('#/files') cannot resolve. Setting the hash
 * directly is the reliable way to navigate.
 */
async function gotoFiles(page: Page): Promise<void> {
  await page.evaluate(() => { window.location.hash = '#/files'; });
  await page.waitForSelector('[role="tree"], [data-testid="disk-tree-empty"]');
}

let vault: TempVault;
/** RootRegistry stores resolved real paths; on macOS /var is a symlink to /private/var. */
let vaultRoot: string;

test.beforeAll(async () => {
  vault = await createTempVault();
  vaultRoot = await realpath(vault.root);
});

test.afterAll(async () => {
  await vault.cleanup();
});

// Seeding must happen before the app starts. Depending on userDataDir here (rather
// than inside the test body) guarantees the file exists before electronApp launches,
// because Playwright resolves fixture dependencies in order.
test.beforeEach(async ({ userDataDir }) => {
  await seedRoots(userDataDir, [vaultRoot]);
});

test.describe('disk explorer', () => {
  test('browses a real folder and streams images over opal-thumb://', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
    });

    await gotoFiles(page);

    await expect(page.getByTestId(`disk-tree-item-${vaultRoot}`)).toBeVisible();

    const photosPath = `${vaultRoot}/Photos`;
    await page.getByTestId(`disk-tree-toggle-${vaultRoot}`).click();
    await page.getByTestId(`disk-tree-item-${photosPath}`).click();

    await expect(page.getByTestId('disk-folder-gallery')).toBeVisible();

    const alpha = page.getByAltText('alpha.png');
    await expect(alpha).toBeVisible();

    // The src must be a streamed protocol URL, never a base64 data URL.
    await expect(alpha).toHaveAttribute('src', /^opal-thumb:\/\//);

    // And the bytes must have actually decoded. A broken image still renders an
    // <img> element and still reports "visible", but naturalWidth stays 0 — this
    // assertion is the one that would catch a protocol or CSP regression.
    await expect
      .poll(() => alpha.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);

    expect(violations).toEqual([]);
  });

  test('does not read a directory before it is expanded', async ({ page }) => {
    await gotoFiles(page);

    await expect(page.getByTestId(`disk-tree-item-${vaultRoot}`)).toBeVisible();

    // The root's children appear only after it is expanded. Photos must then
    // be visible, but its children must not — that is the lazy-loading guarantee.
    await page.getByTestId(`disk-tree-toggle-${vaultRoot}`).click();
    await expect(page.getByTestId(`disk-tree-item-${vaultRoot}/Photos`)).toBeVisible();
    await expect(page.getByText('alpha.png')).toHaveCount(0);
  });

  test('refuses to serve a file outside every opened root', async ({ page }) => {
    await gotoFiles(page);
    await expect(page.getByTestId(`disk-tree-item-${vaultRoot}`)).toBeVisible();

    // The allowed-roots guard is the security boundary. Fetching a path that was
    // never opened must be rejected by the protocol handler, not served.
    const status = await page.evaluate(async () => {
      const response = await fetch('opal-file:///etc/hosts');
      return response.status;
    });

    expect(status).toBe(403);
  });
});
