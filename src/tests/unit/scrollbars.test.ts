import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCROLLBAR_ATTRIBUTE,
  SCROLLBAR_HIDE_AFTER_MS,
  installScrollbarVisibility,
  isOnScrollbar,
} from '@/renderer/shared/scrollbars/scrollbarVisibility';

const ROOT = path.resolve(__dirname, '../../..');

/** A 200 by 100 scroll area at (10, 20) with a 10px vertical scrollbar and no border. */
function scrollArea(): HTMLDivElement {
  const element = document.createElement('div');
  const sizes = { offsetWidth: 200, clientWidth: 190, clientLeft: 0, offsetHeight: 100, clientHeight: 100, clientTop: 0 };
  for (const [key, value] of Object.entries(sizes)) Object.defineProperty(element, key, { configurable: true, value });
  element.getBoundingClientRect = () => ({ left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100, x: 10, y: 20, toJSON: () => ({}) });
  document.body.append(element);
  return element;
}

const state = (element: Element) => element.getAttribute(SCROLLBAR_ATTRIBUTE);
const scroll = (element: Element) => element.dispatchEvent(new Event('scroll'));
const pointer = (target: Element, clientX: number, clientY: number) =>
  target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY }));

describe('scrollbars', () => {
  let stop: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    stop = installScrollbarVisibility(document);
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('hides the thumb at rest, shows it while scrolling, and hides it a second after the last scroll', () => {
    const area = scrollArea();
    expect(state(area)).toBeNull();
    scroll(area);
    expect(state(area)).toBe('shown');
    vi.advanceTimersByTime(SCROLLBAR_HIDE_AFTER_MS - 100);
    scroll(area);
    vi.advanceTimersByTime(SCROLLBAR_HIDE_AFTER_MS - 100);
    // Still scrolling a moment ago, so still shown.
    expect(state(area)).toBe('shown');
    vi.advanceTimersByTime(100);
    expect(state(area)).toBe('hidden');
    // Every scroll area is marked on its own.
    const other = scrollArea();
    scroll(other);
    expect([state(area), state(other)]).toEqual(['hidden', 'shown']);
  });

  it('shows the thumb while the pointer is on the scrollbar, and not over the content', () => {
    const area = scrollArea();
    pointer(area, 100, 60);
    expect(state(area)).toBeNull();
    pointer(area, 205, 60);
    expect(state(area)).toBe('shown');
    vi.advanceTimersByTime(SCROLLBAR_HIDE_AFTER_MS * 3);
    expect(state(area)).toBe('shown');
    // A scroll while the pointer is on the scrollbar does not start the timer.
    scroll(area);
    vi.advanceTimersByTime(SCROLLBAR_HIDE_AFTER_MS * 2);
    expect(state(area)).toBe('shown');
    pointer(area, 100, 60);
    vi.advanceTimersByTime(SCROLLBAR_HIDE_AFTER_MS);
    expect(state(area)).toBe('hidden');
  });

  it('finds the scrollbar from the client box, outside any border', () => {
    const area = scrollArea();
    expect(isOnScrollbar(area, 199, 60)).toBe(false);
    expect(isOnScrollbar(area, 200, 60)).toBe(true);
    expect(isOnScrollbar(area, 209, 119)).toBe(true);
    expect(isOnScrollbar(area, 210, 60)).toBe(false);
    expect(isOnScrollbar(area, 205, 130)).toBe(false);
  });

  it('stops listening when uninstalled', () => {
    stop();
    const area = scrollArea();
    scroll(area);
    expect(state(area)).toBeNull();
    stop = () => undefined;
  });

  it('paints no thumb at rest and the thumb while marked, 3px in from the outer edge', () => {
    const css = readFileSync(path.join(ROOT, 'src/renderer/styles/index.css'), 'utf8');
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf('}', start));
    };
    // The thumb's colour is scaled by --scrollbar-alpha, which is 0 unless the area is marked shown.
    expect(css).toMatch(/@property --scrollbar-alpha \{[^}]*inherits: true;[^}]*initial-value: 0;/);
    expect(rule('::-webkit-scrollbar-thumb')).toMatch(/calc\(var\(--scrollbar-alpha\) \* 100%\)/);
    expect(rule('[data-scrollbar="shown"]')).toMatch(/--scrollbar-alpha: 1;/);
    expect(rule(':where([data-scrollbar]) > :where(:not([data-scrollbar]))')).toMatch(/--scrollbar-alpha: 0;/);
    expect(rule('::-webkit-scrollbar-thumb:vertical')).toMatch(/border-width: \S+ 3px \S+ \S+;/);
    expect(rule('::-webkit-scrollbar-thumb:horizontal')).toMatch(/border-width: \S+ \S+ 3px \S+;/);
    expect(rule('::-webkit-scrollbar-thumb')).toMatch(/border-radius: 999px;/);
  });

  it('leaves no scroll area on standard scrollbars, which would skip these rules', () => {
    const files = (directory: string): string[] =>
      readdirSync(directory).flatMap((name) => {
        const file = path.join(directory, name);
        return statSync(file).isDirectory() ? files(file) : /\.(tsx?|css)$/.test(name) ? [file] : [];
      });
    const offenders = files(path.join(ROOT, 'src/renderer')).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => /scrollbar-(width|color)\s*:/.test(line) && !/scrollbar-width:none/.test(line) && !line.trim().startsWith('*'))
        .map((line) => `${path.relative(ROOT, file)}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
