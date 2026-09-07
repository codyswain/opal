import React from 'react';
import { X } from 'lucide-react';
import { DURATION_PRESETS, FIELD_LABELS, FILE_KINDS, KIND_LABELS } from '@/common/collectionQuery';
import type { FileKind } from '@/common/fileKind';
import type { CollectionFilterField } from '@/types/collectionQuery';
import { Button, Chip } from '@/renderer/shared/ui';
import { OPERATORS, newChip, type EditableChip } from './editableFilters';

interface FilterChipsProps {
  chips: EditableChip[];
  onChange: (chips: EditableChip[]) => void;
}

const FIELD_ORDER: CollectionFilterField[] = ['name', 'kind', 'tags', 'description', 'touched', 'opened', 'modified'];

const inputStyles = 'rounded-md border border-border bg-background px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring';

export const FilterChips: React.FC<FilterChipsProps> = ({ chips, onChange }) => {
  const replace = (key: string, patch: Partial<EditableChip>) =>
    onChange(chips.map((chip) => (chip.key === key ? { ...chip, ...patch } : chip)));
  const remove = (key: string) => onChange(chips.filter((chip) => chip.key !== key));

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="query-filters">
      <span className="text-2xs uppercase tracking-wide text-muted-foreground">Match all filters</span>
      {chips.map((chip) => (
        <ChipEditor key={chip.key} chip={chip} onChange={(patch) => replace(chip.key, patch)} onRemove={() => remove(chip.key)} />
      ))}
      <select
        aria-label="Add filter"
        value=""
        onChange={(event) => {
          const field = event.target.value as CollectionFilterField;
          if (field) onChange([...chips, newChip(field)]);
        }}
        className={inputStyles}
      >
        <option value="">Add filter…</option>
        {FIELD_ORDER.map((field) => (
          <option key={field} value={field}>{FIELD_LABELS[field]}</option>
        ))}
      </select>
      {chips.length > 0 ? (
        <Button size="compact" variant="ghost" onClick={() => onChange([])}>Clear filters</Button>
      ) : null}
    </div>
  );
};

interface ChipEditorProps {
  chip: EditableChip;
  onChange: (patch: Partial<EditableChip>) => void;
  onRemove: () => void;
}

const ChipEditor: React.FC<ChipEditorProps> = ({ chip, onChange, onRemove }) => {
  const label = FIELD_LABELS[chip.field];
  const needsValue = (chip.field === 'name') || (chip.field === 'tags' && chip.op !== 'is-empty');
  const isDate = ['touched', 'opened', 'modified'].includes(chip.field) && (chip.op === 'before' || chip.op === 'after');
  const isDuration = ['touched', 'opened', 'modified'].includes(chip.field) && chip.op === 'within';

  return (
    <div
      role="group"
      aria-label={`${label} filter`}
      data-testid={`query-chip-${chip.field}`}
      className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-1"
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
          onChange={(event) => onChange({ text: event.target.value })}
          className={`${inputStyles} w-40`}
        />
      ) : null}
      {isDuration ? (
        <select aria-label={`${label} duration`} value={chip.preset} onChange={(event) => onChange({ preset: event.target.value })} className={inputStyles}>
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
