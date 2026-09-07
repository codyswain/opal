import { describe, expect, it } from 'vitest';
import { isAllowedNavigation, type NavigationGuardOptions } from '@/main/window/navigationGuard';
import { installDropGuard } from '@/renderer/shared/dropGuard';

describe('isAllowedNavigation', () => {
  const dev: NavigationGuardOptions = { devServerUrl: 'http://localhost:5173/', indexFile: null };
  const packaged: NavigationGuardOptions = { devServerUrl: null, indexFile: '/Applications/Opal.app/Contents/Resources/app/.vite/renderer/main_window/index.html' };

  it('allows the app document with any hash route and nothing else', () => {
    expect(isAllowedNavigation('http://localhost:5173/#/files?mode=browse', dev)).toBe(true);
    expect(isAllowedNavigation('http://localhost:5173/', dev)).toBe(true);
    expect(isAllowedNavigation('http://localhost:5173/other', dev)).toBe(false);
    expect(isAllowedNavigation('http://evil.example/', dev)).toBe(false);
    expect(isAllowedNavigation('file:///Users/someone/Dropped Folder/', dev)).toBe(false);
    expect(isAllowedNavigation('file:///Applications/Opal.app/Contents/Resources/app/.vite/renderer/main_window/index.html#/files', packaged)).toBe(true);
    expect(isAllowedNavigation('file:///Users/someone/cost-of-cognition/', packaged)).toBe(false);
    expect(isAllowedNavigation('not a url', packaged)).toBe(false);
  });
});

describe('installDropGuard', () => {
  it('cancels the default for drops the app did not handle, and can be removed', () => {
    const uninstall = installDropGuard(window);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    uninstall();
    const later = new Event('drop', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });
});
