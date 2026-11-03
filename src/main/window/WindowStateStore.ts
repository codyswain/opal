import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import {
  isResolvedTheme,
  isThemePreference,
  type ResolvedTheme,
  type ThemePreference,
  type ThemeReport,
} from '@/common/theme';
import type { SavedBounds } from './windowBounds';

const STORE_VERSION = 1;

export interface WindowStateStoreDependencies {
  /** Absolute path to the JSON file holding the window bounds. */
  storePath: string;
}

interface WindowStateFile {
  version: number;
  bounds: SavedBounds;
  /** Mirror of the renderer's theme, used only to pick a pre-paint background. */
  theme?: ResolvedTheme;
  themePreference?: ThemePreference;
}

function isSavedBounds(candidate: unknown): candidate is SavedBounds {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const value = candidate as Record<string, unknown>;
  return (
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.isMaximized === 'boolean'
  );
}

/**
 * Persists window geometry between launches.
 *
 * Mirrors RootRegistry: a versioned JSON file under userData, written whole,
 * and treated as absent whenever it cannot be understood. electron-store would
 * be the obvious choice but v10 is ESM-only against this project's CommonJS
 * main build — see Revision 1 of the design doc.
 */
export class WindowStateStore {
  private deps: WindowStateStoreDependencies;
  private bounds: SavedBounds | null = null;
  private theme: ResolvedTheme | null = null;
  private themePreference: ThemePreference | null = null;

  constructor(deps: WindowStateStoreDependencies) {
    this.deps = deps;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.deps.storePath, 'utf-8');
      const parsed = JSON.parse(raw) as WindowStateFile;

      if (parsed?.version !== STORE_VERSION) {
        this.bounds = null;
        this.theme = null;
        this.themePreference = null;
        return;
      }
      this.bounds = isSavedBounds(parsed.bounds) ? parsed.bounds : null;
      this.theme = isResolvedTheme(parsed.theme) ? parsed.theme : null;
      this.themePreference = isThemePreference(parsed.themePreference)
        ? parsed.themePreference
        : null;
    } catch {
      // Missing or corrupt: open at the default size rather than fail to boot.
      this.bounds = null;
      this.theme = null;
      this.themePreference = null;
    }
  }

  get(): SavedBounds | null {
    return this.bounds;
  }

  getThemeHint(fallback: ResolvedTheme = 'light'): ResolvedTheme {
    if (this.themePreference === 'system') return fallback;
    if (isResolvedTheme(this.themePreference)) return this.themePreference;
    return this.theme ?? fallback;
  }

  getThemePreference(): ThemePreference | null {
    return this.themePreference;
  }

  async saveTheme(report: ThemeReport): Promise<void> {
    this.theme = report.resolved;
    this.themePreference = report.preference;
    await this.persist();
  }

  async save(bounds: SavedBounds): Promise<void> {
    this.bounds = bounds;
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (!this.bounds) return;
    const payload: WindowStateFile = {
      version: STORE_VERSION,
      bounds: this.bounds,
      ...(this.theme ? { theme: this.theme } : {}),
      ...(this.themePreference
        ? { themePreference: this.themePreference }
        : {}),
    };

    try {
      await mkdir(path.dirname(this.deps.storePath), { recursive: true });
      await writeFile(this.deps.storePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {
      // Read-only or full disk. Losing the saved position is cosmetic, and this
      // runs during quit where throwing would surface as a crash dialog.
    }
  }
}
