import type { FileKind } from '@/common/fileKind';
import { DURATION_PRESETS, dayBoundary, localDayOf, meaningfulTags } from '@/common/collectionQuery';
import type { CollectionFilter, CollectionFilterField } from '@/types/collectionQuery';

/**
 * A chip under construction. Chips can be temporarily incomplete (a name chip
 * with no text yet); only complete chips become filters in the query.
 */
export interface EditableChip {
  key: string;
  field: CollectionFilterField;
  op: string;
  text: string;
  kinds: FileKind[];
  preset: string;
  day: string;
}

export const OPERATORS: Record<CollectionFilterField, ReadonlyArray<{ op: string; label: string }>> = {
  name: [{ op: 'contains', label: 'contains' }, { op: 'not-contains', label: 'does not contain' }],
  kind: [{ op: 'in', label: 'is one of' }, { op: 'not-in', label: 'is not one of' }],
  tags: [
    { op: 'has-any', label: 'has any of' }, { op: 'has-all', label: 'has all of' },
    { op: 'has-none', label: 'has none of' }, { op: 'is-empty', label: 'is empty' },
  ],
  description: [{ op: 'is-empty', label: 'is empty' }, { op: 'is-not-empty', label: 'is not empty' }],
  touched: [
    { op: 'within', label: 'within' }, { op: 'before', label: 'before' },
    { op: 'after', label: 'after' }, { op: 'never', label: 'never' },
  ],
  opened: [
    { op: 'within', label: 'within' }, { op: 'before', label: 'before' },
    { op: 'after', label: 'after' }, { op: 'never', label: 'never' },
  ],
  modified: [{ op: 'within', label: 'within' }, { op: 'before', label: 'before' }, { op: 'after', label: 'after' }],
};

let counter = 0;
export function chipKey(): string {
  counter += 1;
  return `chip-${counter}`;
}

export function newChip(field: CollectionFilterField): EditableChip {
  return {
    key: chipKey(),
    field,
    op: OPERATORS[field][0].op,
    text: '',
    kinds: [],
    preset: DURATION_PRESETS[2].id,
    day: localDayOf(Date.now()),
  };
}

export function chipFromFilter(filter: CollectionFilter): EditableChip {
  const chip = newChip(filter.field);
  chip.op = filter.op;
  switch (filter.field) {
    case 'name':
      chip.text = filter.value;
      break;
    case 'kind':
      chip.kinds = [...filter.values];
      break;
    case 'tags':
      if (filter.op !== 'is-empty') chip.text = filter.values.join(', ');
      break;
    case 'touched':
    case 'opened':
    case 'modified':
      if (filter.op === 'within') {
        chip.preset = DURATION_PRESETS.find((preset) => preset.ms === filter.durationMs)?.id ?? DURATION_PRESETS[2].id;
      } else if (filter.op === 'before') {
        chip.day = localDayOf(filter.at);
      } else if (filter.op === 'after') {
        // `after day` was stored as the following midnight; show the chosen day.
        chip.day = localDayOf(filter.at - 1);
      }
      break;
    default:
      break;
  }
  return chip;
}

/** Null while the chip is incomplete; such chips are shown but not queried. */
export function filterFromChip(chip: EditableChip): CollectionFilter | null {
  switch (chip.field) {
    case 'name': {
      const value = chip.text.trim();
      if (!value) return null;
      return { field: 'name', op: chip.op === 'not-contains' ? 'not-contains' : 'contains', value };
    }
    case 'kind':
      if (chip.kinds.length === 0) return null;
      return { field: 'kind', op: chip.op === 'not-in' ? 'not-in' : 'in', values: [...chip.kinds] };
    case 'tags': {
      if (chip.op === 'is-empty') return { field: 'tags', op: 'is-empty' };
      const values = [...new Set(meaningfulTags(chip.text.split(',').map((tag) => tag.trim())))];
      if (values.length === 0) return null;
      const op = chip.op === 'has-all' ? 'has-all' : chip.op === 'has-none' ? 'has-none' : 'has-any';
      return { field: 'tags', op, values };
    }
    case 'description':
      return { field: 'description', op: chip.op === 'is-not-empty' ? 'is-not-empty' : 'is-empty' };
    case 'touched':
    case 'opened':
    case 'modified': {
      if (chip.op === 'never') return chip.field === 'modified' ? null : { field: chip.field, op: 'never' };
      if (chip.op === 'within') {
        const preset = DURATION_PRESETS.find((candidate) => candidate.id === chip.preset) ?? DURATION_PRESETS[2];
        return { field: chip.field, op: 'within', durationMs: preset.ms };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(chip.day)) return null;
      try {
        return { field: chip.field, op: chip.op === 'before' ? 'before' : 'after', at: dayBoundary(chip.op === 'before' ? 'before' : 'after', chip.day) };
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

export function filtersFromChips(chips: readonly EditableChip[]): CollectionFilter[] {
  return chips.map(filterFromChip).filter((filter): filter is CollectionFilter => filter !== null);
}
