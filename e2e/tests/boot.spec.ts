import { expect, test } from '../fixtures/electronApp';

/**
 * The one launch check: the shell renders and the Files surface is the home
 * route. Everything else about Files is covered by the disk-explorer specs.
 */
test('app launches into the Files surface', async ({ page }) => {
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('workspace-sidebar')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Files' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Recent' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notes' })).toHaveCount(0);
  await expect(page.getByTestId('welcome-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open folder…' })).toBeVisible();
});
