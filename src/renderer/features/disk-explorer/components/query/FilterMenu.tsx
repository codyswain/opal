import React from 'react';
import { ListFilter } from 'lucide-react';
import { FIELD_LABELS, MAX_FILTERS } from '@/common/collectionQuery';
import type { CollectionFilterField } from '@/types/collectionQuery';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/renderer/shared/ui';
import { newChip, type EditableChip } from './editableFilters';

const FIELD_ORDER: CollectionFilterField[] = ['name', 'kind', 'tags', 'description', 'modified', 'opened', 'touched'];

interface FilterMenuProps {
  chips: EditableChip[];
  onChange: (chips: EditableChip[]) => void;
}

/** The Filter button: pick an axis to add a chip, or clear them all. Linear's grammar. */
export const FilterMenu: React.FC<FilterMenuProps> = ({ chips, onChange }) => {
  const full = chips.length >= MAX_FILTERS;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          data-testid="filter-menu"
          data-disk-shortcuts-ignore="true"
          aria-label={chips.length > 0 ? `Filter (${chips.length} active)` : 'Filter'}
          className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors duration-100 hover:bg-surface-hover hover:text-foreground ${
            chips.length > 0 ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          <ListFilter aria-hidden className="h-3.5 w-3.5" />
          Filter
          {chips.length > 0 ? <span className="rounded-full bg-focus/15 px-1.5 text-2xs font-medium text-focus">{chips.length}</span> : null}
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="min-w-40">
        {FIELD_ORDER.map((field) => (
          <MenuItem key={field} data-testid={`add-filter-${field}`} disabled={full} onSelect={() => { if (!full) onChange([...chips, newChip(field)]); }}>
            {FIELD_LABELS[field]}
          </MenuItem>
        ))}
        {chips.length > 0 ? (
          <>
            <MenuSeparator />
            <MenuItem onSelect={() => onChange([])}>Clear filters</MenuItem>
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
};
