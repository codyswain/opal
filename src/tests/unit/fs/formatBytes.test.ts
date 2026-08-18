import { describe, it, expect } from 'vitest';
import { formatBytes } from '@/common/formatBytes';

describe('formatBytes', () => {
  it('renders an em dash for zero', () => {
    expect(formatBytes(0)).toBe('—');
  });

  it('renders whole bytes without a decimal', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('drops a trailing .0', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
  });

  it('keeps one decimal when it carries information', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('scales through the unit table and clamps at TB', () => {
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
    expect(formatBytes(1024 ** 5)).toBe('1024 TB');
  });
});
