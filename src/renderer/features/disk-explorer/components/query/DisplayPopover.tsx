import React from 'react';
import { ArrowDown, ArrowUp, Settings2 } from 'lucide-react';
import { SORT_LABELS } from '@/common/collectionQuery';
import type { CollectionSort, CollectionSortField } from '@/types/collectionQuery';
import { Popover, PopoverContent, PopoverTrigger, SegmentedControl, Switch } from '@/renderer/shared/ui';

export type Density = 'comfortable' | 'compact';

interface DisplayPopoverProps {
  sort: CollectionSort;
  onSort: (sort: CollectionSort) => void;
  /** Fields this list can order by; defaults to all. */
  sortFields?: readonly CollectionSortField[];
  density: Density;
  onDensity: (density: Density) => void;
  /** Folder scope only: whether subfolders are searched too. */
  includeDescendants?: boolean;
  onIncludeDescendants?: (value: boolean) => void;
  /** Extra sections a surface owns, such as a view's scope. */
  children?: React.ReactNode;
}

const ALL_FIELDS: readonly CollectionSortField[] = ['name', 'modified', 'size', 'kind', 'touched', 'opened'];

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4 py-1.5">
    <span className="text-xs text-foreground-secondary">{label}</span>
    <div className="flex items-center gap-1">{children}</div>
  </div>
);

/** Layout's one home: how the rows are ordered and drawn, never which rows show. */
export const DisplayPopover: React.FC<DisplayPopoverProps> = ({
  sort, onSort, sortFields = ALL_FIELDS, density, onDensity, includeDescendants, onIncludeDescendants, children,
}) => {
  const Arrow = sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="display-menu"
          data-disk-shortcuts-ignore="true"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors duration-100 hover:bg-surface-hover hover:text-foreground"
        >
          <Settings2 aria-hidden className="h-3.5 w-3.5" />
          Display
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3" data-testid="display-popover">
        <Row label="Sort by">
          <select
            aria-label="Sort by"
            value={sort.field}
            onChange={(event) => onSort({ ...sort, field: event.target.value as CollectionSortField })}
            className="h-7 rounded-md border border-border-subtle bg-surface px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {sortFields.map((field) => <option key={field} value={field}>{SORT_LABELS[field]}</option>)}
          </select>
          <button
            type="button"
            aria-label={sort.direction === 'asc' ? 'Sort descending' : 'Sort ascending'}
            title={sort.direction === 'asc' ? 'Ascending' : 'Descending'}
            onClick={() => onSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <Arrow className="h-3.5 w-3.5" />
          </button>
        </Row>
        <Row label="Density">
          <SegmentedControl
            label="Density"
            value={density}
            onValueChange={(value) => onDensity(value as Density)}
            options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}
          />
        </Row>
        {onIncludeDescendants ? (
          <Row label="Include subfolders">
            <Switch label="Include subfolders" checked={!!includeDescendants} onCheckedChange={onIncludeDescendants} />
          </Row>
        ) : null}
        {children}
      </PopoverContent>
    </Popover>
  );
};
