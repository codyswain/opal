import React, { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, FolderPlus, Search, X } from 'lucide-react';
import type { SortField } from '@/common/sortEntries';
import { useDiskStore } from '../store/diskStore';

const SORT_FIELDS: { field: SortField; label: string }[] = [
  { field: 'name', label: 'Name' },
  { field: 'modified', label: 'Modified' },
  { field: 'size', label: 'Size' },
  { field: 'kind', label: 'Kind' },
];

export const Toolbar: React.FC<{ dirPath: string }> = ({ dirPath }) => {
  const sort = useDiskStore((state) => state.sort);
  const setSort = useDiskStore((state) => state.setSort);
  const filter = useDiskStore((state) => state.filter);
  const setFilter = useDiskStore((state) => state.setFilter);
  const density = useDiskStore((state) => state.density);
  const setDensity = useDiskStore((state) => state.setDensity);
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
    <div className="flex min-w-0 items-center gap-1 px-3 py-2">
      <button
        type="button"
        onClick={() => useDiskStore.getState().beginNewFolder(dirPath)}
        aria-label="New folder"
        title="New folder"
        data-testid="toolbar-new-folder"
        data-disk-shortcuts-ignore="true"
        className="rounded-md p-2 text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
      >
        <FolderPlus className="h-4 w-4" />
      </button>
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
            data-disk-shortcuts-ignore="true"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors duration-100 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}
        aria-label="Toggle density"
        aria-pressed={density === 'compact'}
        data-testid="toolbar-density"
        data-disk-shortcuts-ignore="true"
        className={`rounded-md px-2 py-1 text-xs transition-colors duration-100 ${
          density === 'compact'
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted'
        }`}
      >
        {density === 'comfortable' ? 'Comfortable' : 'Compact'}
      </button>
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
            data-disk-shortcuts-ignore="true"
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors duration-100 ${
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
