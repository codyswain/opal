// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { APP_CSP, applyAppPolicy } from '@/main/window/contentSecurity';

const directive = (name: string) => APP_CSP.split('; ').find((part) => part.startsWith(`${name} `)) ?? '';

describe('the app policy hook', () => {
  it('leaves opal-file: responses and the PDF viewer alone', () => {
    const own = { 'Content-Security-Policy': ['sandbox'], 'X-Content-Type-Options': ['nosniff'] };
    expect(applyAppPolicy({ url: 'opal-file:///Users/cody/vault/page.html', responseHeaders: own })).toEqual({});
    expect(applyAppPolicy({ url: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html' })).toEqual({});
  });

  it('puts the app policy on the app document', () => {
    const answer = applyAppPolicy({ url: 'file:///Applications/Opal.app/index.html', responseHeaders: { 'Content-Type': ['text/html'] } });
    expect(answer.responseHeaders).toEqual({ 'Content-Type': ['text/html'], 'Content-Security-Policy': [APP_CSP] });
    expect(applyAppPolicy({ url: 'http://localhost:5173/' }).responseHeaders?.['Content-Security-Policy']).toEqual([APP_CSP]);
  });

  it('lets the page fetch nothing from the web or opal-file:', () => {
    expect(directive('connect-src')).toBe("connect-src 'self' ws: http://localhost:11434");
    // Chromium checks the PDF <embed>'s inner frame against frame-src.
    expect(directive('frame-src')).toBe("frame-src 'self' opal-file:");
    expect(directive('object-src')).toBe("object-src 'self' opal-file:");
    expect(directive('img-src')).toContain('opal-file:');
    expect(directive('media-src')).toContain('opal-file:');
  });
});
