import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Keep DOM-heavy tests responsive alongside the desktop app and build checks.
    // Opt in only on a busy local workstation; CI retains Vitest's normal limit.
    testTimeout: process.env.OPAL_TEST_SLOW_HOST === '1' && !process.env.CI ? 20_000 : undefined,
    maxWorkers: 4,
    minWorkers: 1,
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'src/tests/'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    },
  },
}); 