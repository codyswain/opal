import { join } from 'path';
import { builtinModules } from 'module';
import { defineConfig, Plugin, UserConfig } from 'vite';
import { loadAndSetEnv } from '@electron-forge/core/dist/util/env';

export function resolveForgeConfig(config: UserConfig) {
  if (!config.plugins) {
    return config;
  }

  const forgePlugin = config.plugins.find(
    (p) => (p as Plugin).name === 'electron-forge'
  ) as Plugin | undefined;

  return forgePlugin?.config.forgeConfig;
}

// Load electron-forge CFG. Must be called before all other require.
// Like nodeIntegration: true requires assign process.env.
loadAndSetEnv(process.cwd());

const PACKAGE_ROOT = __dirname;

/**
 * @see https://vitejs.dev/config/
 */
export default defineConfig((env) => {
  const forgeConfig = resolveForgeConfig(env as UserConfig);
  const forgeConfigSelf = forgeConfig?.plugin?.vite?.config?.preload ?? {};

  const forgeEnv = env as ConfigEnv<'build'>;
  const { forgeConfigSelf: forgeEnvConfigSelf } = forgeEnv;
  const config: UserConfig = {
    mode: process.env.MODE,
    root: PACKAGE_ROOT,
    envDir: process.cwd(),
    resolve: {
      alias: {
        '@': join(PACKAGE_ROOT, 'src'),
      },
    },
    build: {
      sourcemap: true,
      minify: false,
      outDir: join(
        forgeConfig?.root ?? '',
        '.vite',
        'preload'
      ),
      assetsDir: '.',
      rollupOptions: {
        external: [
          'electron',
          ...builtinModules.flatMap((p) => [p, `node:${p}`]),
        ],
        input: forgeEnvConfigSelf.entry?.replace(/\\/g, '/'),
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

  return mergeConfig(getBuildConfig(forgeEnv), config);
});
