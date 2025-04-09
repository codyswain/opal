import type { ConfigEnv, UserConfig } from 'vite';
import { defineConfig, mergeConfig } from 'vite';
import { getBuildConfig, pluginHotRestart, external } from './vite.base.config';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import path from 'path';

// https://vitejs.dev/config
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<'build'>;
  // const { forgeConfigSelf } = forgeEnv;

  // Define config for main process
  const config: UserConfig = {
    build: {
      // Enable watch mode for development
      watch: env.command === 'serve' ? {} : null,
      // Explicitly set the source file to be the main.ts file only
      lib: {
        entry: path.resolve(__dirname, 'src/main.ts'),
        formats: ['cjs'],
        fileName: () => 'main.js',
      },
      // Keep rollup options, especially external
      rollupOptions: {
        // Preserve entry signatures to avoid trying to bundle deep imports
        preserveEntrySignatures: 'strict',
        // Explicitly ignore all renderer imports
        external: [
          ...external,
          // Regex to exclude all renderer-related imports
          /^@\/renderer/,
          /^react/,
          /^@radix-ui/,
          /^@tiptap/,
          'keytar',
        ],
        output: {
          // Ensure CJS format as required by Electron main process
          format: 'cjs',
          dir: '.vite/build',
          entryFileNames: 'main.js',
        },
      },
      // Ensure minify is only applied during 'build' command
      minify: env.command === 'build',
      // Don't clean output directory to avoid conflicts with other builds
      emptyOutDir: false,
    },
    plugins: [
      commonjs({
        transformMixedEsModules: true,
      }),
      nodeResolve({
        preferBuiltins: true,
        browser: false,
        exportConditions: ['node', 'require', 'default'],
      }),
      // Keep hot restart for development
      pluginHotRestart('restart'),
    ],
    // define should be managed by forge plugin or base config
    resolve: {
      // Load Node.js entry points
      mainFields: ['main', 'module', 'jsnext:main', 'jsnext'],
      // Add path alias for @ to fix import resolution
      alias: {
        '@': path.resolve(__dirname, './src')
      },
    },
  };

  // Merge with base config, let forge plugin handle specifics
  return mergeConfig(getBuildConfig(forgeEnv), config);
});
