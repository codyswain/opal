import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import fs from 'fs';

const PROJECT_ROOT = path.join(__dirname, '../..');
const MAIN_JS_PATH = path.join(PROJECT_ROOT, '.vite/build/main.js');

type ElectronFixtures = {
  /** Absolute path to this test's isolated user-data directory. */
  userDataDir: string;
  electronApp: ElectronApplication;
  page: Page;
};

export const test = base.extend<ElectronFixtures>({
  // Created before the app launches so a test can seed files (e.g. disk-roots.json)
  // that the main process reads during startup.
  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'opal-test-userdata-'));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },

  electronApp: async ({ userDataDir }, use) => {
    if (!fs.existsSync(MAIN_JS_PATH)) {
      throw new Error(
        `Built main.js not found at ${MAIN_JS_PATH}. Run the Vite builds first:\n` +
        `  npx vite build --config vite.main.config.ts && npx vite build --config vite.preload.config.ts && npx vite build --config vite.renderer.config.ts`
      );
    }

    const testDbDir = await mkdtemp(path.join(os.tmpdir(), 'opal-test-'));

    const app = await electron.launch({
      args: [PROJECT_ROOT],
      env: {
        ...process.env,
        OPAL_TEST_DB_DIR: testDbDir,
        OPAL_TEST_USER_DATA_DIR: userDataDir,
      },
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
