import { describe, expect, it } from 'vitest';
import {
  chipFromFilter,
  filterFromChip,
  newChip,
} from '@/renderer/features/disk-explorer/components/query/editableFilters';

describe('editableFilters', () => {
  it('round-trips a duration that is not a preset without rounding it', () => {
    const chip = chipFromFilter({ field: 'touched', op: 'within', durationMs: 10_800_000 });
    expect(chip.preset).toBe('custom:10800000');
    expect(filterFromChip(chip)).toEqual({ field: 'touched', op: 'within', durationMs: 10_800_000 });
    const preset = chipFromFilter({ field: 'modified', op: 'within', durationMs: 7 * 24 * 3_600_000 });
    expect(preset.preset).toBe('7d');
  });

  it('treats values over the validator limits as incomplete instead of invalid', () => {
    const name = { ...newChip('name'), text: 'x'.repeat(257) };
    expect(filterFromChip(name)).toBeNull();
    expect(filterFromChip({ ...name, text: 'x'.repeat(256) })).toMatchObject({ value: 'x'.repeat(256) });
    const tooManyTags = { ...newChip('tags'), text: Array.from({ length: 33 }, (_, i) => `t${i}`).join(', ') };
    expect(filterFromChip(tooManyTags)).toBeNull();
    const longTag = { ...newChip('tags'), text: `ok, ${'y'.repeat(65)}` };
    expect(filterFromChip(longTag)).toBeNull();
    const unknownPreset = { ...newChip('opened'), op: 'within', preset: 'custom:nope' };
    expect(filterFromChip(unknownPreset)).toBeNull();
  });
});
