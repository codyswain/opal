import { readdirSync, readFileSync, statSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { describe, expect, it } from 'vitest';
import resolveConfig from 'tailwindcss/resolveConfig';

/**
 * Opal is black and white first (the pages-first spec, "Look"): every token is
 * a neutral grey, and no component can reach a hued colour. The only colour on
 * screen comes from images inside notes.
 */

const ROOT = path.resolve(__dirname, '../../..');
const require = createRequire(__filename);

/** Channel spread in 0-255. The spec's chrome greys (#f4f4f5, #08090a) spread by 1 to 2. */
const MAX_SPREAD = 2;

function hslSpread(saturation: number, lightness: number): number {
  return (1 - Math.abs(2 * lightness - 1)) * saturation * 255;
}

function hexSpread(hex: string): number {
  const digits = hex.length <= 5 ? [...hex.slice(1, 4)].map((digit) => digit + digit) : hex.slice(1, 7).match(/../g) ?? [];
  const channels = digits.map((pair) => parseInt(pair, 16));
  return Math.max(...channels) - Math.min(...channels);
}

/** Every colour written out in a piece of CSS or code, with how far it is from grey. */
function colours(text: string): { colour: string; spread: number }[] {
  const found: { colour: string; spread: number }[] = [];
  for (const [colour, s, l] of text.matchAll(/\b\d+(?:\.\d+)?\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/g)) {
    found.push({ colour, spread: hslSpread(Number(s) / 100, Number(l) / 100) });
  }
  for (const [colour] of text.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    found.push({ colour, spread: hexSpread(colour) });
  }
  for (const [colour, r, g, b] of text.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
    const channels = [r, g, b].map(Number);
    found.push({ colour, spread: Math.max(...channels) - Math.min(...channels) });
  }
  return found;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name);
    if (statSync(file).isDirectory()) return sourceFiles(file);
    return /\.(tsx?|css)$/.test(name) ? [file] : [];
  });
}

const HUES = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

describe('black and white', () => {
  it('defines every colour token as a neutral grey, in light and dark', () => {
    const css = readFileSync(path.join(ROOT, 'src/renderer/styles/index.css'), 'utf8');
    const found = colours(css);
    expect(found.length).toBeGreaterThan(20);
    expect(found.filter(({ spread }) => spread > MAX_SPREAD)).toEqual([]);
    expect(css).not.toMatch(/--(link|success|warning|danger|info|destructive)\s*:/);
  });

  it('gives Tailwind no hued palette and a neutral default ring', () => {
    const { theme } = resolveConfig(require(path.join(ROOT, 'tailwind.config.js')));
    const names = Object.keys(theme.colors);
    expect(names.filter((name) => new RegExp(`^(${HUES})$`).test(name))).toEqual([]);
    const values = names.flatMap((name) => {
      const value = theme.colors[name];
      return typeof value === 'string' ? [value] : Object.values(value as Record<string, string>);
    });
    expect(
      values.filter((value) => !/^hsl\(var\(--[a-z-]+\)\)$|^(transparent|currentColor|inherit|#ffffff|#000000)$/.test(value))
    ).toEqual([]);
    expect(theme.ringColor.DEFAULT).toBe('hsl(var(--focus))');
  });

  it('keeps hued colours and palette classes out of the renderer source', () => {
    const offenders = sourceFiles(path.join(ROOT, 'src/renderer')).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const classes = [...text.matchAll(new RegExp(`\\b[a-z-]+-(?:${HUES})-\\d{2,3}\\b`, 'g'))].map(([match]) => match);
      const literals = colours(text).filter(({ spread }) => spread > MAX_SPREAD).map(({ colour }) => colour);
      return [...classes, ...literals].map((match) => `${path.relative(ROOT, file)}: ${match}`);
    });
    expect(offenders).toEqual([]);
  });
});
