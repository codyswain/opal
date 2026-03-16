import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import fs from 'fs';

const PROJECT_ROOT = path.join(__dirname, '../..');
const MAIN_JS_PATH = path.join(PROJECT_ROOT, '.vite/build/main.js');

type ElectronFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

export const test = base.extend<ElectronFixtures>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    if (!fs.existsSync(MAIN_JS_PATH)) {
      throw new Error(
        `Built main.js not found at ${MAIN_JS_PATH}. Run the Vite builds first:\n` +
        `  npx vite build --config vite.main.config.ts && npx vite build --config vite.preload.config.ts && npx vite build --config vite.renderer.config.ts`
      );
    }

    const testDbDir = await mkdtemp(path.join(os.tmpdir(), 'opal-test-'));

    const app = await electron.launch({
      args: [PROJECT_ROOT],
      env: { ...process.env, OPAL_TEST_DB_DIR: testDbDir },
    });

    await use(app);

    await app.close();
    await rm(testDbDir, { recursive: true, force: true });
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
