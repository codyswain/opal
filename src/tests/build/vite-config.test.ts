import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Vite Configuration Tests', () => {
  it('should have valid vite.main.config.ts structure', () => {
    const configPath = path.resolve(process.cwd(), 'vite.main.config.ts');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    
    // Check for critical parts of the config
    expect(configContent).toContain('defineConfig');
    expect(configContent).toContain('lib: {');
    expect(configContent).toContain('entry: path.resolve(__dirname, \'src/main.ts\')');
    expect(configContent).toContain('formats: [\'cjs\']');
  });

  it('should contain a valid vite.base.config.ts', () => {
    const configPath = path.resolve(process.cwd(), 'vite.base.config.ts');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    
    // Check for critical parts of the base config
    expect(configContent).toContain('getBuildConfig');
    expect(configContent).toContain('export const external =');
    expect(configContent).toContain('pluginHotRestart');
  });

  it('should properly handle external dependencies', () => {
    const configPath = path.resolve(process.cwd(), 'vite.base.config.ts');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    
    // Check for proper external dependencies handling
    expect(configContent).toContain('builtinModules');
    expect(configContent).toContain('electron');
  });

  it('build output directory structure should be properly defined', () => {
    const mainConfigPath = path.resolve(process.cwd(), 'vite.main.config.ts');
    const mainConfigContent = fs.readFileSync(mainConfigPath, 'utf-8');
    
    // Verify output directory config
    expect(mainConfigContent).toContain('.vite/build');
    expect(mainConfigContent).toContain('emptyOutDir: false');
  });
}); 