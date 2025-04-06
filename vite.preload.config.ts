import { join } from 'path';
import { builtinModules } from 'module';
import { defineConfig, UserConfig, mergeConfig, type ConfigEnv } from 'vite';
import { getBuildConfig } from './vite.base.config';

const PACKAGE_ROOT = __dirname;

/**
 * @see https://vitejs.dev/config/
 */
export default defineConfig((env) => {
  const { forgeConfigSelf } = env as ConfigEnv<'build'>;
  const root = PACKAGE_ROOT;

  const config: UserConfig = {
    mode: process.env.MODE,
    root,
    envDir: process.cwd(),
    resolve: {
      alias: {
        '@': join(PACKAGE_ROOT, 'src'),
      },
    },
    build: {
      sourcemap: true,
      minify: false,
      outDir: join(PACKAGE_ROOT, '.vite', 'build'),
      assetsDir: '.',
      lib: {
        entry: forgeConfigSelf?.entry || 'src/preload.ts',
        formats: ['cjs'],
        fileName: () => 'preload.js',
      },
      rollupOptions: {
        external: [
          'electron',
          ...builtinModules.flatMap((p) => [p, `node:${p}`]),
        ],
        output: {
          format: 'cjs',
          entryFileNames: 'preload.js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]',
        },
      },
      emptyOutDir: false,
      reportCompressedSize: false,
    },
  };

  return mergeConfig(getBuildConfig(env as ConfigEnv<'build'>), config);
});
