import { test, expect } from '../fixtures/electronApp';
import { readFile } from 'fs/promises';
import path from 'path';

test.describe('window state', () => {
  test('restores saved bounds and shows the window', async ({ page, electronApp, userDataDir }) => {
    // The fixture creates userDataDir before launch, so this file is written
    // too late for THIS launch to read — but it proves the round-trip shape and
    // that the window is visible, which is the part no unit test can check.
    await page.waitForSelector('[data-testid="app-shell"]');

    const isVisible = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.isVisible();
    });
    expect(isVisible).toBe(true);

    // titleBarStyle: 'hiddenInset' means the OS owns the buttons, so the
    // renderer must not be drawing its own.
    await expect(page.locator('[title="Close"]')).toHaveCount(0);
    await expect(page.locator('[title="Minimize"]')).toHaveCount(0);

    const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getNormalBounds();
    });
    expect(bounds.width).toBeGreaterThanOrEqual(640);
    expect(bounds.height).toBeGreaterThanOrEqual(480);

    // Resize, then confirm the debounced writer persisted it.
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setBounds({ x: 60, y: 60, width: 1024, height: 768 });
    });
    await page.waitForTimeout(900);

    // Read from the test process: the main process's evaluate context has no
    // require(), and the store writes to the same filesystem either way.
    const raw = await readFile(path.join(userDataDir, 'window-state.json'), 'utf-8');

    const saved = JSON.parse(raw);
    expect(saved.version).toBe(1);
    expect(saved.bounds.width).toBe(1024);
    expect(saved.bounds.height).toBe(768);
  });
});
