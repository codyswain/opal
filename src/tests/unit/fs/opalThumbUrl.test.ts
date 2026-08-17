import { describe, it, expect } from 'vitest';
import { toOpalThumbUrl, opalThumbUrlToPath, OPAL_THUMB_SCHEME } from '@/common/opalThumbUrl';

describe('opal-thumb URLs', () => {
  it('uses its own scheme, distinct from opal-file', () => {
    expect(OPAL_THUMB_SCHEME).toBe('opal-thumb');
    expect(toOpalThumbUrl('/V/a.jpg')).toMatch(/^opal-thumb:\/\//);
  });

  it('round-trips a path', () => {
    const p = '/Users/cody/Photos/a.jpg';
    expect(opalThumbUrlToPath(toOpalThumbUrl(p))).toBe(p);
  });

  it('round-trips spaces and reserved characters', () => {
    const p = '/V/My Photos/a#b?c&d=e.jpg';
    expect(toOpalThumbUrl(p)).not.toContain(' ');
    expect(opalThumbUrlToPath(toOpalThumbUrl(p))).toBe(p);
  });

  it('round-trips non-ASCII', () => {
    const p = '/V/café — 2024 (½).jpg';
    expect(opalThumbUrlToPath(toOpalThumbUrl(p))).toBe(p);
  });

  it('rejects a URL from another scheme', () => {
    expect(() => opalThumbUrlToPath('opal-file:///V/a.jpg')).toThrow(/scheme/i);
  });
});
