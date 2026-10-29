import { describe, expect, it } from 'vitest';
import { cn } from '@/renderer/shared/utils';

describe('cn', () => {
  it('keeps a token font size next to a text color', () => {
    expect(cn('text-ui text-foreground-secondary')).toBe('text-ui text-foreground-secondary');
    expect(cn('text-label', 'text-foreground-tertiary')).toBe('text-label text-foreground-tertiary');
  });

  it('lets a later token font size replace an earlier one', () => {
    expect(cn('text-control font-medium', 'text-ui')).toBe('font-medium text-ui');
  });
});
