import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

describe('Build Process Tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('vite config files should exist', () => {
    const configFiles = [
      'vite.base.config.ts',
      'vite.main.config.ts',
      'vite.preload.config.ts',
      'vite.renderer.config.ts'
    ];

    configFiles.forEach(file => {
      const filePath = path.resolve(process.cwd(), file);
      expect(fs.existsSync(filePath)).toBeTruthy();
    });
  });

  it('build scripts in package.json should be valid', () => {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    
    expect(packageJson.scripts).toHaveProperty('start');
    expect(packageJson.scripts).toHaveProperty('package');
    expect(packageJson.scripts).toHaveProperty('make');
    expect(packageJson.scripts).toHaveProperty('publish');
    
    // Check that all build scripts include the necessary Vite build commands
    const buildScripts = ['start', 'package', 'make', 'publish'];
    buildScripts.forEach(script => {
      expect(packageJson.scripts[script]).toContain('vite build --config vite.main.config.ts');
      expect(packageJson.scripts[script]).toContain('vite build --config vite.preload.config.ts');
      expect(packageJson.scripts[script]).toContain('vite build --config vite.renderer.config.ts');
    });
  });

  it('should check for critical dependencies in package.json', () => {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    
    const requiredDeps = ['electron', 'vite', '@electron-forge/cli'];
    
    requiredDeps.forEach(dep => {
      expect(
        packageJson.dependencies?.[dep] || packageJson.devDependencies?.[dep]
      ).toBeDefined();
    });
  });

  it('main entry point file should exist', () => {
    const mainFilePath = path.resolve(process.cwd(), 'src/main.ts');
    expect(fs.existsSync(mainFilePath)).toBeTruthy();
  });
}); 