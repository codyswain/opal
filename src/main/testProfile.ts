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
