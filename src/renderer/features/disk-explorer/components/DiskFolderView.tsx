import React, { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List as ListIcon, Image as ImageIcon, Folder, FileText, Film, Music, File } from 'lucide-react';
import { filterEntries } from '@/common/filterEntries';
import { formatBytes } from '@/common/formatBytes';
import { sortEntries } from '@/common/sortEntries';
import type { DiskEntry, FileKind } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import { useGridNavigation } from '../hooks/useGridNavigation';

type ViewMode = 'gallery' | 'list';

const ICONS: Record<FileKind, React.ComponentType<{ className?: string }>> = {
  directory: Folder, image: ImageIcon, markdown: FileText, text: FileText,
  pdf: File, video: Film, audio: Music, other: File,
};

interface DiskFolderViewProps {
  dirPath: string;
}

export const DiskFolderView: React.FC<DiskFolderViewProps> = ({ dirPath }) => {
  const entries = useDiskStore((state) => state.listings[dirPath]);
  const loadDirectory = useDiskStore((state) => state.loadDirectory);
  const select = useDiskStore((state) => state.select);
  const selectedPath = useDiskStore((state) => state.selectedPath);
  const sort = useDiskStore((state) => state.sort);
  const filter = useDiskStore((state) => state.filter);
  const setFilter = useDiskStore((state) => state.setFilter);

  const [mode, setMode] = useState<ViewMode | null>(null);

  useEffect(() => { void loadDirectory(dirPath); }, [dirPath, loadDirectory]);
  // A filter carried into a new folder makes it look empty for no visible
  // reason. Clear it whenever the folder changes.
  useEffect(() => { setFilter(''); }, [dirPath, setFilter]);

  // A folder that is mostly pictures wants to be looked at, not listed. The
  // user's explicit choice always wins once they make one.
  const suggestedMode: ViewMode = useMemo(() => {
    if (!entries || entries.length === 0) return 'list';
    const images = entries.filter((entry) => entry.kind === 'image').length;
    return images > 0 && images >= entries.length / 2 ? 'gallery' : 'list';
  }, [entries]);

  const visibleEntries = useMemo(() => {
    if (!entries) return [];
    return sortEntries(filterEntries(entries, filter), sort.field, sort.direction);
  }, [entries, filter, sort.field, sort.direction]);
  const hasActiveFilter = filter.trim().length > 0;

  const activeMode = mode ?? suggestedMode;
  // Gallery tracks are `minmax(160px,1fr)` with 12px gaps; list mode is a
  // single column. Task 12 replaces the constant with a measured value.
  const columns = activeMode === 'gallery' ? 4 : 1;
  const { onKeyDown } = useGridNavigation({ entries: visibleEntries, columns });

  if (!entries) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 shrink-0">
        <span className="text-xs text-muted-foreground truncate">
          {visibleEntries.length} {visibleEntries.length === 1 ? 'item' : 'items'}
        </span>
        <div className="flex items-center gap-1">
          <ModeButton
            mode="gallery" active={activeMode === 'gallery'} onSelect={setMode}
            label="Gallery view" Icon={LayoutGrid}
          />
          <ModeButton
            mode="list" active={activeMode === 'list'} onSelect={setMode}
            label="List view" Icon={ListIcon}
          />
        </div>
      </div>

      {visibleEntries.length === 0 ? (
        <div
          data-testid={hasActiveFilter ? 'disk-folder-no-matches' : 'disk-folder-empty'}
          className="flex-1 grid place-items-center text-sm text-muted-foreground"
        >
          {hasActiveFilter ? `No files matching “${filter}”` : 'This folder is empty'}
        </div>
      ) : activeMode === 'gallery' ? (
        <div
          tabIndex={0}
          onKeyDown={onKeyDown}
          data-testid="disk-folder-gallery"
          className="flex-1 overflow-auto p-4 grid gap-3 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] outline-none"
        >
          {visibleEntries.map((entry) => (
            <GalleryTile
              key={entry.path} entry={entry}
              isSelected={selectedPath === entry.path}
              onSelect={() => select(entry.path)}
            />
          ))}
        </div>
      ) : (
        <div
          tabIndex={0}
          onKeyDown={onKeyDown}
          data-testid="disk-folder-list"
          className="flex-1 overflow-auto outline-none"
        >
          {visibleEntries.map((entry) => (
            <ListRow
              key={entry.path} entry={entry}
              isSelected={selectedPath === entry.path}
              onSelect={() => select(entry.path)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface ModeButtonProps {
  mode: ViewMode;
  active: boolean;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  onSelect: (mode: ViewMode) => void;
}

const ModeButton: React.FC<ModeButtonProps> = ({ mode, active, label, Icon, onSelect }) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={active}
    data-testid={`disk-folder-view-${mode}`}
    onClick={() => onSelect(mode)}
    className={`p-1.5 rounded-md ${active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-muted-foreground'}`}
  >
    <Icon className="h-4 w-4" />
  </button>
);

interface EntryProps {
  entry: DiskEntry;
  isSelected: boolean;
  onSelect: () => void;
}

const GalleryTile: React.FC<EntryProps> = ({ entry, isSelected, onSelect }) => {
  const Icon = ICONS[entry.kind];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      title={entry.name}
      data-testid={`disk-folder-entry-${entry.path}`}
      // min-w-0 is load-bearing: a grid item defaults to min-width:auto, so it
      // refuses to shrink below its content's intrinsic width. A long filename
      // would push the tile past its track and overlap its neighbours.
      className={`flex flex-col gap-1.5 text-left rounded-lg p-1.5 min-w-0 ${isSelected ? 'bg-accent/60 ring-1 ring-accent' : 'hover:bg-muted/50'}`}
    >
      <div className="aspect-square rounded-md overflow-hidden bg-muted/40 grid place-items-center">
        {entry.kind === 'image' ? (
          <img
            src={toOpalFileUrl(entry.path)}
            alt={entry.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <Icon className="h-8 w-8 opacity-40" />
        )}
      </div>
      {/* Two lines then ellipsis, with a reserved height so tiles stay on a
          consistent baseline regardless of how long each name is. */}
      <span className="text-xs leading-snug px-0.5 line-clamp-2 break-words min-h-[2rem]">
        {entry.name}
      </span>
    </button>
  );
};

const ListRow: React.FC<EntryProps> = ({ entry, isSelected, onSelect }) => {
  const Icon = ICONS[entry.kind];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      data-testid={`disk-folder-entry-${entry.path}`}
      className={`w-full flex items-center gap-2 px-4 py-1.5 text-sm text-left ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'}`}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-60" />
      <span className="flex-1 truncate">{entry.name}</span>
      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
        {entry.isDirectory ? '—' : formatBytes(entry.size)}
      </span>
    </button>
  );
};
