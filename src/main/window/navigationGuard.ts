/**
 * The renderer must never leave the app document. Without a guard, dropping a
 * file or folder from Finder onto the window navigates the whole window to
 * its file:// URL, which blanks the app until it is restarted.
 */
export interface NavigationGuardOptions {
  /** The dev server URL when running under Vite, if any. */
  devServerUrl?: string | null;
  /** The built renderer's index.html path when running packaged, if any. */
  indexFile?: string | null;
}

function stripHash(url: string): string {
  const index = url.indexOf('#');
  return index === -1 ? url : url.slice(0, index);
}

/** True only for the app's own document; hash routing never triggers this check. */
export function isAllowedNavigation(url: string, options: NavigationGuardOptions): boolean {
  const target = stripHash(url);
  if (options.devServerUrl) {
    try {
      const dev = new URL(options.devServerUrl);
      const candidate = new URL(target);
      if (candidate.origin === dev.origin && (candidate.pathname === '/' || candidate.pathname === dev.pathname)) {
        return true;
      }
    } catch {
      // Fall through to the packaged check.
    }
  }
  if (options.indexFile) {
    try {
      const candidate = new URL(target);
      if (candidate.protocol === 'file:' && decodeURIComponent(candidate.pathname) === options.indexFile) return true;
    } catch {
      return false;
    }
  }
  return false;
}
