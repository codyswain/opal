import type { ConfigEnv, UserConfig } from 'vite';
import { defineConfig, mergeConfig } from 'vite';
import { getBuildConfig, pluginHotRestart, external } from './vite.base.config';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

// https://vitejs.dev/config
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<'build'>;
  const { forgeConfigSelf } = forgeEnv;
  
  // Safe define without relying on forgeConfig.renderer
  const define = {}; // Skip getBuildDefine since it might cause issues

  // Define config for main process
  const config: UserConfig = {
    build: {
      outDir: '.vite/build',
      lib: {
        entry: forgeConfigSelf?.entry || 'src/main.ts', // Default to src/main.ts if not provided
        fileName: () => '[name].js',
        formats: ['cjs'],
      },
      rollupOptions: {
        // Use external from vite.base.config.ts
        external, 
        output: {
          format: 'cjs',
        },
      },
    },
    plugins: [
      commonjs({
        // Enhanced CommonJS plugin options to handle node modules
        transformMixedEsModules: true,
      }),
      nodeResolve({
        preferBuiltins: true,
        browser: false, // Not targeting a browser environment
        // Make sure all types of dependencies are processed
        exportConditions: ['node', 'require', 'default'],
      }),
      pluginHotRestart('restart'),
    ],
    define,
    resolve: {
      // Load Node.js entry points
      mainFields: ['main', 'module', 'jsnext:main', 'jsnext'],
    },
  };

  return mergeConfig(getBuildConfig(forgeEnv), config);
});
