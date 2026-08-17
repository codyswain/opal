import { describe, it, expect } from 'vitest';
import {
  toOpalFileUrl,
  opalFileUrlToPath,
  contentTypeFor,
  OPAL_FILE_SCHEME,
} from '@/common/opalFileUrl';

describe('opal-file URL round-trip', () => {
  it('uses the opal-file scheme', () => {
    expect(OPAL_FILE_SCHEME).toBe('opal-file');
    expect(toOpalFileUrl('/Users/cody/a.jpg')).toMatch(/^opal-file:\/\//);
  });

  it('round-trips a simple path', () => {
    const p = '/Users/cody/Photos/a.jpg';
    expect(opalFileUrlToPath(toOpalFileUrl(p))).toBe(p);
  });

  it('round-trips spaces', () => {
    const p = '/Users/cody/My Photos/holiday shot.jpg';
    expect(toOpalFileUrl(p)).not.toContain(' ');
    expect(opalFileUrlToPath(toOpalFileUrl(p))).toBe(p);
  });

  it('round-trips characters that are significant in URLs', () => {
    const p = '/Users/cody/Photos/a#b?c&d=e.jpg';
    expect(opalFileUrlToPath(toOpalFileUrl(p))).toBe(p);
  });

  it('round-trips non-ASCII names', () => {
    const p = '/Users/cody/Photos/Rwanda/café — 2024 (½).jpg';
    expect(opalFileUrlToPath(toOpalFileUrl(p))).toBe(p);
  });

  it('round-trips a path containing a percent sign', () => {
    const p = '/Users/cody/Photos/100%_done.jpg';
    expect(opalFileUrlToPath(toOpalFileUrl(p))).toBe(p);
  });

  it('rejects a URL from a different scheme', () => {
    expect(() => opalFileUrlToPath('file:///Users/cody/a.jpg')).toThrow(/scheme/i);
    expect(() => opalFileUrlToPath('https://example.com/a.jpg')).toThrow(/scheme/i);
  });

  it('restores the leading slash when the first segment was parsed as the host', () => {
    // Electron's standard-scheme parser turns opal-file:///private/var/x
    // into host=private, pathname=/var/x. Dropping the slash would 403 the asset.
    expect(opalFileUrlToPath('opal-file://private/var/x.jpg')).toBe('/private/var/x.jpg');
  });
});

describe('contentTypeFor', () => {
  it('maps common image types', () => {
    expect(contentTypeFor('a.jpg')).toBe('image/jpeg');
    expect(contentTypeFor('a.JPEG')).toBe('image/jpeg');
    expect(contentTypeFor('a.png')).toBe('image/png');
    expect(contentTypeFor('a.gif')).toBe('image/gif');
    expect(contentTypeFor('a.webp')).toBe('image/webp');
    expect(contentTypeFor('a.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('a.heic')).toBe('image/heic');
  });

  it('maps video, audio, pdf, markdown', () => {
    expect(contentTypeFor('a.mp4')).toBe('video/mp4');
    expect(contentTypeFor('a.mov')).toBe('video/quicktime');
    expect(contentTypeFor('a.mp3')).toBe('audio/mpeg');
    expect(contentTypeFor('a.pdf')).toBe('application/pdf');
    expect(contentTypeFor('a.md')).toBe('text/markdown; charset=utf-8');
  });

  it('falls back to octet-stream', () => {
    expect(contentTypeFor('a.unknownext')).toBe('application/octet-stream');
    expect(contentTypeFor('Makefile')).toBe('application/octet-stream');
  });
});
