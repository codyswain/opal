import React, { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
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
  const filter = useDiskStore((state) => state.filter);
  const setFilter = useDiskStore((state) => state.setFilter);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex min-w-0 items-center gap-1 px-3 py-1.5">
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={filterRef}
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setFilter('');
          }}
          placeholder="Filter"
          aria-label="Filter files in this folder"
          data-testid="filter-input"
          className="w-40 rounded-md border border-transparent bg-muted/50 py-1 pl-7 pr-6 text-xs focus:border-ring focus:outline-none"
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter('')}
            aria-label="Clear filter"
            data-testid="filter-clear"
            className="absolute right-1 top-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground -translate-y-1/2"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
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
