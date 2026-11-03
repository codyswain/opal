import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { WindowStateStore } from '@/main/window/WindowStateStore';
import type { SavedBounds } from '@/main/window/windowBounds';

let tmp: string;
let storePath: string;

const BOUNDS: SavedBounds = {
  x: 10, y: 20, width: 1000, height: 700, isMaximized: false,
};

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-winstate-'));
  storePath = path.join(tmp, 'window-state.json');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('WindowStateStore', () => {
  it('reports null before anything is saved', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    expect(store.get()).toBeNull();
  });

  it('round-trips bounds through the file', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    await store.save(BOUNDS);

    const reloaded = new WindowStateStore({ storePath });
    await reloaded.load();
    expect(reloaded.get()).toEqual(BOUNDS);
  });

  it('creates the parent directory if it does not exist', async () => {
    const nested = path.join(tmp, 'a', 'b', 'window-state.json');
    const store = new WindowStateStore({ storePath: nested });
    await store.load();
    await store.save(BOUNDS);

    const raw = await readFile(nested, 'utf-8');
    expect(JSON.parse(raw).bounds).toEqual(BOUNDS);
  });

  it('writes a version field', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    await store.save(BOUNDS);

    const raw = await readFile(storePath, 'utf-8');
    expect(JSON.parse(raw).version).toBe(1);
  });

  it('treats a corrupt file as empty rather than throwing', async () => {
    await writeFile(storePath, 'not json{{{', 'utf-8');
    const store = new WindowStateStore({ storePath });
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.get()).toBeNull();
  });

  it('ignores a file written by a newer version', async () => {
    await writeFile(
      storePath,
      JSON.stringify({ version: 99, bounds: BOUNDS }),
      'utf-8'
    );
    const store = new WindowStateStore({ storePath });
    await store.load();
    expect(store.get()).toBeNull();
  });

  it('ignores a file whose bounds are not an object', async () => {
    await writeFile(storePath, JSON.stringify({ version: 1, bounds: 'nope' }), 'utf-8');
    const store = new WindowStateStore({ storePath });
    await store.load();
    expect(store.get()).toBeNull();
  });

  it('overwrites previous bounds rather than appending', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    await store.save(BOUNDS);
    await store.save({ ...BOUNDS, width: 1234 });

    const reloaded = new WindowStateStore({ storePath });
    await reloaded.load();
    expect(reloaded.get()?.width).toBe(1234);
  });

  it('does not reject when the directory cannot be written', async () => {
    // A read-only location must not crash the app on quit.
    const readOnlyDir = path.join(tmp, 'ro');
    await mkdir(readOnlyDir);
    const store = new WindowStateStore({
      storePath: path.join(readOnlyDir, 'sub', 'nested', 'window-state.json'),
    });
    await store.load();
    await expect(store.save(BOUNDS)).resolves.toBeUndefined();
  });
});

describe('theme hint', () => {
  it('defaults to light', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    expect(store.getThemeHint()).toBe('light');
  });

  it('uses a supplied system fallback when no resolved hint has been saved', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    expect(store.getThemeHint('dark')).toBe('dark');
  });

  it('round-trips a saved theme alongside bounds', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    await store.save(BOUNDS);
    await store.saveTheme({ preference: 'dark', resolved: 'dark' });

    const reloaded = new WindowStateStore({ storePath });
    await reloaded.load();
    expect(reloaded.getThemeHint()).toBe('dark');
    expect(reloaded.getThemeHint('light')).toBe('dark');
    expect(reloaded.getThemePreference()).toBe('dark');
    expect(reloaded.get()).toEqual(BOUNDS);
  });

  it('re-resolves a saved system preference against the current OS fallback', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    await store.save(BOUNDS);
    await store.saveTheme({ preference: 'system', resolved: 'dark' });

    const reloaded = new WindowStateStore({ storePath });
    await reloaded.load();
    expect(reloaded.getThemePreference()).toBe('system');
    expect(reloaded.getThemeHint('light')).toBe('light');
    expect(reloaded.getThemeHint('dark')).toBe('dark');
  });

  it('keeps bounds when only the theme changes', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    await store.save(BOUNDS);
    await store.saveTheme({ preference: 'dark', resolved: 'dark' });

    const reloaded = new WindowStateStore({ storePath });
    await reloaded.load();
    expect(reloaded.get()?.width).toBe(BOUNDS.width);
  });
});
