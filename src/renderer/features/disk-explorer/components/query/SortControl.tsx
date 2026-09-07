import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { CollectionSort, CollectionSortField } from '@/types/collectionQuery';

interface SortControlProps {
  sort: CollectionSort;
  onChange: (sort: CollectionSort) => void;
}

const SORT_LABELS: Record<CollectionSortField, string> = {
  touched: 'Last touched',
  opened: 'Last opened',
  modified: 'Modified',
  name: 'Name',
};

export const SortControl: React.FC<SortControlProps> = ({ sort, onChange }) => {
  const Arrow = sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <div className="flex items-center gap-1" data-testid="query-sort">
      <span className="text-2xs uppercase tracking-wide text-muted-foreground">Sort</span>
      <select
        aria-label="Sort by"
        value={sort.field}
        onChange={(event) => onChange({ ...sort, field: event.target.value as CollectionSortField })}
        className="rounded-md border border-border bg-background px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {(Object.keys(SORT_LABELS) as CollectionSortField[]).map((field) => (
          <option key={field} value={field}>{SORT_LABELS[field]}</option>
        ))}
      </select>
      <button
        type="button"
        aria-label={sort.direction === 'asc' ? 'Sort descending' : 'Sort ascending'}
        onClick={() => onChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Arrow className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
