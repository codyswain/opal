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
