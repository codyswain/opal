import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Keep DOM-heavy tests responsive alongside the desktop app and build checks.
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