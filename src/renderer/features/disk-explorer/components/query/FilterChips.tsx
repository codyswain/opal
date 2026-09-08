import React, { useId } from 'react';
import { X } from 'lucide-react';
import { DURATION_PRESETS, FIELD_LABELS, FILE_KINDS, KIND_LABELS } from '@/common/collectionQuery';
import type { FileKind } from '@/common/fileKind';
import type { TagCount } from '@/types/collectionQuery';
import { Chip } from '@/renderer/shared/ui';
import { CUSTOM_PRESET_PREFIX, OPERATORS, presetDuration, type EditableChip } from './editableFilters';

interface FilterChipsProps {
  chips: EditableChip[];
  onChange: (chips: EditableChip[]) => void;
  tagSuggestions?: TagCount[];
}

export const CHIP_TEXT_INPUT = 'data-chip-text';

const inputStyles = 'rounded-md border border-border bg-background px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** The applied filters, each editable in place. Adding and clearing live in FilterMenu. */
export const FilterChips: React.FC<FilterChipsProps> = ({ chips, onChange, tagSuggestions = [] }) => {
  const listId = useId();
  const replace = (key: string, patch: Partial<EditableChip>) =>
    onChange(chips.map((chip) => (chip.key === key ? { ...chip, ...patch } : chip)));
  const remove = (key: string) => onChange(chips.filter((chip) => chip.key !== key));
  if (chips.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="query-filters">
      {tagSuggestions.length > 0 ? (
        <datalist id={listId}>
          {tagSuggestions.map((suggestion) => (
            <option key={suggestion.tag} value={suggestion.tag}>{`${suggestion.tag} (${suggestion.count})`}</option>
          ))}
        </datalist>
      ) : null}
      {chips.map((chip) => (
        <ChipEditor key={chip.key} chip={chip} tagListId={tagSuggestions.length > 0 ? listId : undefined} onChange={(patch) => replace(chip.key, patch)} onRemove={() => remove(chip.key)} />
      ))}
    </div>
  );
};

interface ChipEditorProps {
  chip: EditableChip;
  tagListId?: string;
  onChange: (patch: Partial<EditableChip>) => void;
  onRemove: () => void;
}

const ChipEditor: React.FC<ChipEditorProps> = ({ chip, tagListId, onChange, onRemove }) => {
  const label = FIELD_LABELS[chip.field];
  const needsValue = (chip.field === 'name') || (chip.field === 'tags' && chip.op !== 'is-empty');
  const isDate = ['touched', 'opened', 'modified'].includes(chip.field) && (chip.op === 'before' || chip.op === 'after');
  const isDuration = ['touched', 'opened', 'modified'].includes(chip.field) && chip.op === 'within';

  return (
    <div
      role="group"
      aria-label={`${label} filter`}
      data-testid={`query-chip-${chip.field}`}
      className="flex h-7 items-center gap-1 rounded-md border border-border-subtle bg-surface pl-2 pr-1"
    >
      <span className="text-xs font-medium">{label}</span>
      <select
        aria-label={`${label} operation`}
        value={chip.op}
        onChange={(event) => onChange({ op: event.target.value })}
        className={inputStyles}
      >
        {OPERATORS[chip.field].map((operator) => (
          <option key={operator.op} value={operator.op}>{operator.label}</option>
        ))}
      </select>
      {chip.field === 'kind' ? (
        <span className="flex flex-wrap items-center gap-1" aria-label={`${label} values`}>
          {FILE_KINDS.map((kind: FileKind) => (
            <Chip
              key={kind}
              selected={chip.kinds.includes(kind)}
              onClick={() => onChange({
                kinds: chip.kinds.includes(kind) ? chip.kinds.filter((candidate) => candidate !== kind) : [...chip.kinds, kind],
              })}
            >
              {KIND_LABELS[kind]}
            </Chip>
          ))}
        </span>
      ) : null}
      {needsValue ? (
        <input
          type="text"
          aria-label={`${label} value`}
          value={chip.text}
          placeholder={chip.field === 'tags' ? 'tag, another tag' : 'text'}
          list={chip.field === 'tags' ? tagListId : undefined}
          {...{ [CHIP_TEXT_INPUT]: 'true' }}
          onChange={(event) => onChange({ text: event.target.value })}
          className={`${inputStyles} w-40`}
        />
      ) : null}
      {isDuration ? (
        <select aria-label={`${label} duration`} value={chip.preset} onChange={(event) => onChange({ preset: event.target.value })} className={inputStyles}>
          {chip.preset.startsWith(CUSTOM_PRESET_PREFIX) ? (
            <option value={chip.preset}>{`past ${Math.round((presetDuration(chip.preset) ?? 0) / 3_600_000)} hours`}</option>
          ) : null}
          {DURATION_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
      ) : null}
      {isDate ? (
        <input type="date" aria-label={`${label} date`} value={chip.day} onChange={(event) => onChange({ day: event.target.value })} className={inputStyles} />
      ) : null}
      <button type="button" aria-label={`Remove ${label} filter`} onClick={onRemove} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
};
