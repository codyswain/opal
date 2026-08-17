import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { SortField } from '@/common/sortEntries';
import { useDiskStore } from '../store/diskStore';

const SORT_FIELDS: { field: SortField; label: string }[] = [
  { field: 'name', label: 'Name' },
  { field: 'modified', label: 'Modified' },
  { field: 'size', label: 'Size' },
  { field: 'kind', label: 'Kind' },
];

export const Toolbar: React.FC = () => {
  const sort = useDiskStore((state) => state.sort);
  const setSort = useDiskStore((state) => state.setSort);

  return (
    <div className="flex min-w-0 items-center gap-1 px-3 py-1.5">
      <span className="mr-1 shrink-0 text-xs text-muted-foreground">Sort</span>
      {SORT_FIELDS.map(({ field, label }) => {
        const isActive = sort.field === field;
        const Arrow = sort.direction === 'asc' ? ArrowUp : ArrowDown;

        return (
          <button
            key={field}
            type="button"
            onClick={() => setSort(field)}
            aria-pressed={isActive}
            data-testid={`sort-${field}`}
            className={`flex items-center gap-0.5 rounded px-2 py-0.5 text-xs ${
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {label}
            {isActive && <Arrow className="h-3 w-3" />}
          </button>
        );
      })}
    </div>
  );
};
