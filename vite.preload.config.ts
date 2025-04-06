import { join } from 'path';
import { builtinModules } from 'module';
import { defineConfig, Plugin, UserConfig, mergeConfig, type ConfigEnv } from 'vite';
import { getBuildConfig, pluginHotRestart } from './vite.base.config';

const PACKAGE_ROOT = __dirname;

/**
 * @see https://vitejs.dev/config/
 */
export default defineConfig((env) => {
  const { forgeConfigSelf, root } = env as ConfigEnv<'build'>;

  const config: UserConfig = {
    mode: process.env.MODE,
    root: root,
    envDir: process.cwd(),
    resolve: {
      alias: {
        '@': join(PACKAGE_ROOT, 'src'),
      },
    },
    build: {
      sourcemap: true,
      minify: false,
      outDir: join(root, '.vite', 'build'),
      assetsDir: '.',
      rollupOptions: {
        external: [
          'electron',
          ...builtinModules.flatMap((p) => [p, `node:${p}`]),
        ],
        input: (forgeConfigSelf.entry as string)?.replace(/\\/g, '/'),
        output: {
          format: 'cjs',
          inlineDynamicImports: true,
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]',
        },
      },
      emptyOutDir: true,
      reportCompressedSize: false,
    },
    plugins: [pluginHotRestart('reload')],
  };

  return mergeConfig(getBuildConfig(env as ConfigEnv<'build'>), config);
});
