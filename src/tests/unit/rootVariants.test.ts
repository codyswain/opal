import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOT_VARIANTS, VARIANTS } from '@/common/variants';
import { applyRootVariants, startRootVariants, useVariantsStore } from '@/renderer/features/variants';
import { readRootLength } from '@/renderer/shared/hooks/useRootLength';

const root = document.documentElement;
const mirror = () => window.localStorage.getItem('opal.variants');

/** The inline scripts of index.html, run as the page runs them before any bundle. */
function runPrePaint() {
  const html = readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8');
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    new Function(code)();
  }
}

beforeEach(() => {
  window.localStorage.clear();
  root.removeAttribute('data-roomy');
  root.classList.remove('light', 'dark');
  useVariantsStore.setState({ known: VARIANTS, sides: {}, loaded: false, ready: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  root.removeAttribute('data-roomy');
  root.removeAttribute('style');
});

describe('variants that are token sets', () => {
  it('include roomy, which this build knows', () => {
    expect(ROOT_VARIANTS).toEqual(['roomy']);
    expect(VARIANTS).toContain('roomy');
  });

  it('put data-roomy on the root while roomy is on B, take it off on A, and mirror the sides', () => {
    applyRootVariants({ roomy: 'b' });
    expect(root.hasAttribute('data-roomy')).toBe(true);
    expect(JSON.parse(mirror() ?? 'null')).toEqual({ version: 1, value: { roomy: 'b' } });
    applyRootVariants({});
    expect(root.hasAttribute('data-roomy')).toBe(false);
    expect(JSON.parse(mirror() ?? 'null')).toEqual({ version: 1, value: {} });
  });

  it('leave the attribute the pre-paint script set until the main process answers, then follow it', async () => {
    let answer: (value: { data: Record<string, 'b'> }) => void = () => undefined;
    vi.stubGlobal('vaultAPI', { variants: () => new Promise((resolve) => { answer = resolve; }) });
    root.setAttribute('data-roomy', '');
    const stop = startRootVariants();
    // The store is loading: no flash to A while the sides are on their way.
    expect(useVariantsStore.getState().loaded).toBe(true);
    expect(root.hasAttribute('data-roomy')).toBe(true);
    answer({ data: {} });
    await vi.waitFor(() => expect(root.hasAttribute('data-roomy')).toBe(false));
    useVariantsStore.getState().take({ roomy: 'b' });
    expect(root.hasAttribute('data-roomy')).toBe(true);
    stop();
  });
});

describe('the pre-paint script', () => {
  it('puts data-roomy on the root before any bundle when the mirror says B', () => {
    window.localStorage.setItem('opal.variants', JSON.stringify({ version: 1, value: { roomy: 'b' } }));
    runPrePaint();
    expect(root.hasAttribute('data-roomy')).toBe(true);
  });

  it('leaves the root alone on A, and on a corrupt or old mirror', () => {
    for (const stored of [JSON.stringify({ version: 1, value: {} }), '{nope', JSON.stringify({ version: 2, value: { roomy: 'b' } })]) {
      window.localStorage.setItem('opal.variants', stored);
      runPrePaint();
      expect(root.hasAttribute('data-roomy')).toBe(false);
    }
  });
});

describe('a length token read in code', () => {
  it('reads px and rem, and falls back when the token is missing or not a length', () => {
    root.style.setProperty('--test-length', '2rem');
    root.style.fontSize = '16px';
    expect(readRootLength('--test-length', 28)).toBe(32);
    root.style.setProperty('--test-length', '34px');
    expect(readRootLength('--test-length', 28)).toBe(34);
    root.style.setProperty('--test-length', 'var(--other)');
    expect(readRootLength('--test-length', 28)).toBe(28);
    expect(readRootLength('--missing-length', 28)).toBe(28);
  });
});
