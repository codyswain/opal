import React, { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, FilePlus, FolderPlus, Rows3, Rows4, Search, SlidersHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import type { SortField } from '@/common/sortEntries';
import { folderScope } from '@/common/collectionQuery';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/renderer/shared/ui';
import { useDiskStore } from '../store/diskStore';
import { useViewDraftsStore } from '../store/viewDraftsStore';
import { useFilesNavigation } from '../navigation/FilesNavigationContext';
import { queryCollection } from '../navigation/filesLocation';

const SORT_FIELDS: { field: SortField; label: string }[] = [
  { field: 'name', label: 'Name' },
  { field: 'modified', label: 'Modified' },
  { field: 'size', label: 'Size' },
  { field: 'kind', label: 'Kind' },
];

const iconButton = 'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-surface-hover hover:text-foreground';

/**
 * Folder actions and ordering. Sort lives in one menu so the bar stays calm;
 * the direction arrow next to it flips without opening anything.
 */
export const Toolbar: React.FC<{ dirPath: string }> = ({ dirPath }) => {
  const sort = useDiskStore((state) => state.sort);
  const setSort = useDiskStore((state) => state.setSort);
  const filter = useDiskStore((state) => state.filter);
  const setFilter = useDiskStore((state) => state.setFilter);
  const density = useDiskStore((state) => state.density);
  const setDensity = useDiskStore((state) => state.setDensity);
  const createDraft = useViewDraftsStore((state) => state.create);
  const navigation = useFilesNavigation();
  const filterRef = useRef<HTMLInputElement>(null);

  const newNote = async () => {
    const result = await window.markdownAPI.create(dirPath);
    if (!result.success) { toast.error(result.error); return; }
    await useDiskStore.getState().loadDirectory(dirPath, { force: true });
    navigation.openFile(result.data.path);
  };

  // A view made from a folder starts recursive; the scope control shows that.
  const filterThisFolder = () => {
    const id = createDraft({ scope: folderScope(dirPath), origin: dirPath });
    navigation.navigateCollection(queryCollection(id));
  };

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

  const activeSort = SORT_FIELDS.find(({ field }) => field === sort.field) ?? SORT_FIELDS[0];
  const Arrow = sort.direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <div className="flex min-w-0 items-center gap-1 px-2 py-1.5">
      <button type="button" onClick={() => useDiskStore.getState().beginNewFolder(dirPath)} aria-label="New folder" title="New folder" data-testid="toolbar-new-folder" data-disk-shortcuts-ignore="true" className={iconButton}>
        <FolderPlus className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => void newNote()} aria-label="New note" title="New Markdown note in this folder" data-testid="toolbar-new-note" data-disk-shortcuts-ignore="true" className={iconButton}>
        <FilePlus className="h-4 w-4" />
      </button>
      <button type="button" onClick={filterThisFolder} aria-label="Filter this folder" title="Filter this folder and its subfolders" data-testid="toolbar-filter-folder" data-disk-shortcuts-ignore="true" className={iconButton}>
        <SlidersHorizontal className="h-4 w-4" />
      </button>

      <div className="mx-1 h-4 w-px shrink-0 bg-border-subtle" />

      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={filterRef}
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') setFilter(''); }}
          placeholder="Filter"
          aria-label="Filter files in this folder"
          data-testid="filter-input"
          className="h-7 w-44 rounded-md border border-transparent bg-surface-hover pl-8 pr-6 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:bg-background"
        />
        {filter && (
          <button type="button" onClick={() => setFilter('')} aria-label="Clear filter" data-testid="filter-clear" data-disk-shortcuts-ignore="true" className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors duration-100 hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="mx-1 h-4 w-px shrink-0 bg-border-subtle" />

      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={`Sort by ${activeSort.label}`}
            data-testid="sort-menu"
            data-disk-shortcuts-ignore="true"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors duration-100 hover:bg-surface-hover hover:text-foreground"
          >
            <span className="text-foreground-tertiary">Sort</span>
            <span className="text-foreground">{activeSort.label}</span>
            <ChevronDown aria-hidden className="h-3 w-3" />
          </button>
        </MenuTrigger>
        <MenuContent align="end" className="min-w-36">
          {SORT_FIELDS.map(({ field, label }) => {
            const isActive = sort.field === field;
            return (
              <MenuItem
                key={field}
                role="menuitemradio"
                aria-checked={isActive}
                data-testid={`sort-${field}`}
                onSelect={() => setSort(field)}
              >
                <span className="flex h-3.5 w-3.5 items-center justify-center">{isActive ? <Check aria-hidden className="h-3.5 w-3.5" /> : null}</span>
                <span className="ml-1.5">{label}</span>
                {isActive ? <Arrow aria-hidden className="ml-auto h-3 w-3 text-muted-foreground" /> : null}
              </MenuItem>
            );
          })}
        </MenuContent>
      </Menu>
      <button
        type="button"
        onClick={() => setSort(sort.field)}
        aria-label={sort.direction === 'asc' ? 'Sorted ascending; switch to descending' : 'Sorted descending; switch to ascending'}
        title={sort.direction === 'asc' ? 'Ascending' : 'Descending'}
        data-testid="sort-direction"
        data-disk-shortcuts-ignore="true"
        className={iconButton}
      >
        <Arrow className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}
        aria-label="Toggle density"
        aria-pressed={density === 'compact'}
        title={density === 'comfortable' ? 'Comfortable rows; switch to compact' : 'Compact rows; switch to comfortable'}
        data-testid="toolbar-density"
        data-disk-shortcuts-ignore="true"
        className={`${iconButton} ${density === 'compact' ? 'bg-surface-active text-foreground' : ''}`}
      >
        {density === 'comfortable' ? <Rows3 className="h-4 w-4" /> : <Rows4 className="h-4 w-4" />}
      </button>
    </div>
  );
};
