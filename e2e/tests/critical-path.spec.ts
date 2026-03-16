import { test, expect } from '../fixtures/electronApp';

test('app launches and renders correctly', async ({ page }) => {
  // Wait for the app to fully render (DB init, VFS load, React mount)
  await expect(page.getByTestId('navbar')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('create-folder-btn')).toBeVisible();
  await expect(page.getByTestId('create-note-btn')).toBeVisible();
  await expect(page.getByTestId('file-tree')).toBeVisible();
});

test('create folder and note via UI', async ({ page }) => {
  const treeItems = page.getByTestId('file-tree').locator('[data-testid^="tree-item-"]');

  // Fresh database should start empty
  await page.waitForTimeout(2000);
  const initialCount = await treeItems.count();

  // Create a folder
  await page.getByTestId('create-folder-btn').click();
  await page.waitForTimeout(1000);
  expect(await treeItems.count()).toBeGreaterThan(initialCount);

  // Select the folder to view it
  await treeItems.first().click();
  await page.waitForTimeout(500);

  // Create a note inside the folder
  await page.getByTestId('create-note-btn').click();
  await page.waitForTimeout(2000);

  // The note appears in the center panel's folder view — click it there
  const noteInFolderView = page.locator('text=New Note');
  await expect(noteInFolderView).toBeVisible({ timeout: 5000 });
  await noteInFolderView.click();
  await page.waitForTimeout(1000);

  // Editor should now be visible
  const editor = page.getByTestId('editor-content');
  await expect(editor).toBeVisible({ timeout: 10000 });

  // Type content
  await editor.click();
  await page.keyboard.type('Hello from E2E test');
  await expect(editor).toContainText('Hello from E2E test');
});
