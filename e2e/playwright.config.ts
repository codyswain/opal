import { defineConfig } from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,

  // Each test launches a real Electron process, so environmental flakiness is
  // real. Locally a flake is noise worth seeing; in CI it blocks a merge.
  retries: isCI ? 2 : 0,

  // Electron instances hold exclusive locks on their userData directory. Each
  // test already gets its own, but keeping concurrency modest avoids
  // machine-level contention on CI runners.
  workers: isCI ? 1 : 2,

  // Fail the run if a test was left focused with .only.
  forbidOnly: isCI,

  reporter: isCI
    ? [['html', { open: 'never' }], ['github']]
    : [['html', { open: 'never' }], ['list']],

  use: {
    // Was 'on-first-retry' while retries was 0 — which meant never. A failing
    // UI test must leave behind something you can actually look at.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
