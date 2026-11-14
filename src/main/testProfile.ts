/**
 * Test-profile isolation for the main process.
 *
 * OPAL_TEST_USER_DATA_DIR points Opal's own stores at a throwaway directory,
 * but Electron's Chromium profile (localStorage, session storage, caches)
 * lives under `userData`/`sessionData`, which defaults to the real
 * Application Support folder. Unless those paths move too, every E2E run and
 * acceptance tour reads and writes the user's actual preferences — theme,
 * pane sizes, view drafts, open tabs — and leaves synthetic state behind.
 */
export interface PathSettingApp {
  setPath: (name: string, value: string) => void;
}

/** Applies the override and returns the directory, or null when unset. */
export function applyTestProfile(
  env: Record<string, string | undefined>,
  app: PathSettingApp,
): string | null {
  const dir = env.OPAL_TEST_USER_DATA_DIR?.trim();
  if (!dir) return null;
  app.setPath('userData', dir);
  app.setPath('sessionData', dir);
  return dir;
}

/** What a stubbed Touch ID prompt does in a test run. */
export type TouchIdStub = 'pass' | 'fail' | 'none';

/**
 * The Touch ID stub a test run asks for with OPAL_TEST_TOUCH_ID, honoured
 * only when the app is not packaged and runs under the test profile
 * (OPAL_TEST_USER_DATA_DIR). A packaged build always uses the real prompt,
 * whatever its environment says.
 */
export function touchIdStub(
  env: Record<string, string | undefined>,
  isPackaged: boolean,
): TouchIdStub | null {
  if (isPackaged || !env.OPAL_TEST_USER_DATA_DIR?.trim()) return null;
  const stub = env.OPAL_TEST_TOUCH_ID?.trim();
  return stub === 'pass' || stub === 'fail' || stub === 'none' ? stub : null;
}

/**
 * Where Opal keeps copies of the builds it replaced. A test run under
 * OPAL_TEST_USER_DATA_DIR may move it with OPAL_TEST_UPDATE_BACKUPS_DIR;
 * without the test profile that variable is ignored.
 */
export function updateBackupsDir(env: Record<string, string | undefined>, home: string): string {
  const override = env.OPAL_TEST_UPDATE_BACKUPS_DIR?.trim();
  if (env.OPAL_TEST_USER_DATA_DIR?.trim() && override) return override;
  return `${home}/Library/Caches/Opal-app-backups`;
}

/**
 * Where a test run looks for Comment's command. Under the test profile in an
 * unpackaged run, OPAL_TEST_AGENT_HOME stands for the home folder and
 * OPAL_TEST_AGENT_PATH for the login shell's PATH, so a test can never find
 * or run a real command installed on the Mac. Otherwise null.
 */
export function agentLookup(
  env: Record<string, string | undefined>,
  isPackaged: boolean,
): { home: string; path: string } | null {
  if (isPackaged || !env.OPAL_TEST_USER_DATA_DIR?.trim()) return null;
  const home = env.OPAL_TEST_AGENT_HOME?.trim();
  const searchPath = env.OPAL_TEST_AGENT_PATH?.trim();
  return home && searchPath ? { home, path: searchPath } : null;
}

/**
 * What a build relaunched after an update must start with. Under a test
 * profile the new build gets the same profile (and backups folder), so it
 * never opens the real one; otherwise nothing, and the bundle opens as from
 * the Dock.
 */
export function updateRelaunchEnv(env: Record<string, string | undefined>): Record<string, string> | null {
  const profile = env.OPAL_TEST_USER_DATA_DIR?.trim();
  if (!profile) return null;
  const backups = env.OPAL_TEST_UPDATE_BACKUPS_DIR?.trim();
  return { OPAL_TEST_USER_DATA_DIR: profile, ...(backups ? { OPAL_TEST_UPDATE_BACKUPS_DIR: backups } : {}) };
}
