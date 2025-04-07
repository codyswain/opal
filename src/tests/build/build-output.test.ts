import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

describe('Build Output Tests', () => {
  // Skip these tests in CI environment to avoid long-running builds
  // Run them locally or with a specific flag
  beforeAll(async () => {
    if (process.env.SKIP_BUILD_TESTS === 'true') {
      return;
    }

    // Run a single vite build for the main process
    try {
      await execPromise('npx vite build --config vite.main.config.ts');
    } catch (err) {
      console.error('Failed to build main process:', err);
    }
  }, 60000); // Increase timeout for build process

  it('should create build output directory', () => {
    if (process.env.SKIP_BUILD_TESTS === 'true') {
      return;
    }
    
    const buildDir = path.resolve(process.cwd(), '.vite/build');
    expect(fs.existsSync(buildDir)).toBeTruthy();
  });

  it('should generate main.js in the build directory', () => {
    if (process.env.SKIP_BUILD_TESTS === 'true') {
      return;
    }
    
    const mainJsPath = path.resolve(process.cwd(), '.vite/build/main.js');
    expect(fs.existsSync(mainJsPath)).toBeTruthy();
  });

  it('main.js should contain appropriate content', () => {
    if (process.env.SKIP_BUILD_TESTS === 'true') {
      return;
    }
    
    const mainJsPath = path.resolve(process.cwd(), '.vite/build/main.js');
    const content = fs.readFileSync(mainJsPath, 'utf-8');
    
    // Check for key Electron imports/functionality
    expect(content).toContain('electron');
    
    // This output should contain CJS format code
    expect(content).toMatch(/require\(.*\)/);
  });

  // Cleanup test to prevent side effects
  afterAll(async () => {
    // Option to clean up build output after tests
    if (process.env.CLEAN_AFTER_BUILD_TESTS === 'true') {
      try {
        // Be careful with rmdir, maybe better to keep the output
        // await fs.promises.rmdir(path.resolve(process.cwd(), '.vite/build'), { recursive: true });
      } catch (err) {
        console.error('Failed to clean up after tests:', err);
      }
    }
  });
}); 