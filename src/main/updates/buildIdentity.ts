import type { BuildIdentity } from '@/types/updates';

/** The running build, stamped by vite.main.config.ts; null where nothing stamped it, as under Vitest. */
export function runningBuild(): BuildIdentity | null {
  const build = typeof __OPAL_BUILD__ !== 'undefined' ? __OPAL_BUILD__ : undefined;
  return build && typeof build.commit === 'string' && typeof build.builtAt === 'string'
    ? { commit: build.commit, builtAt: build.builtAt }
    : null;
}
