import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, List as ListIcon, Image as ImageIcon, Folder, FileText, Film, Music, File, FolderOpen, SearchX } from 'lucide-react';
import { FixedSizeGrid, FixedSizeList } from 'react-window';
import { filterEntries } from '@/common/filterEntries';
import { formatBytes } from '@/common/formatBytes';
import { sortEntries } from '@/common/sortEntries';
import type { DiskEntry, FileKind } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';
import { toOpalThumbUrl } from '@/common/opalThumbUrl';
import { clearActiveDragSourcePath, getActiveDragSourcePath, setActiveDragSourcePath } from './dragMoveState';
import { useGridNavigation } from '../hooks/useGridNavigation';
import { useElementSize } from '../hooks/useElementSize';
import { EmptyState } from './EmptyState';
import { GallerySkeleton } from './Skeleton';

type ViewMode = 'gallery' | 'list';

const ICONS: Record<FileKind, React.ComponentType<{ className?: string }>> = {
  directory: Folder, image: ImageIcon, markdown: FileText, text: FileText,
  pdf: File, video: Film, audio: Music, other: File,
};

interface DiskFolderViewProps {
  dirPath: string;
}

const ROW_HEIGHT = 40;
const TILE = {
  comfortable: { width: 172, height: 208, min: 160 },
  compact: { width: 116, height: 144, min: 104 },
} as const;

export const DiskFolderView: React.FC<DiskFolderViewProps> = ({ dirPath }) => {
  const entries = useDiskStore((state) => state.listings[dirPath]);
  const loadDirectory = useDiskStore((state) => state.loadDirectory);
  const selectedPath = useDiskStore((state) => state.selectedPath);
  const selectedPaths = useDiskStore((state) => state.selectedPaths);
  const sort = useDiskStore((state) => state.sort);
  const filter = useDiskStore((state) => state.filter);
  const setFilter = useDiskStore((state) => state.setFilter);
  const density = useDiskStore((state) => state.density);

  const [mode, setMode] = useState<ViewMode | null>(null);
  const [viewportRef, viewport] = useElementSize<HTMLDivElement>();
  const gridRef = useRef<FixedSizeGrid>(null);
  const listRef = useRef<FixedSizeList>(null);
  const hasMountedRef = useRef(false);

  useEffect(() => { void loadDirectory(dirPath); }, [dirPath, loadDirectory]);
  // A filter carried into a new folder makes it look empty for no visible
  // reason. Clear it whenever the folder changes.
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    setFilter('');
  }, [dirPath, setFilter]);

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
  const tile = TILE[density];

  const activeMode = mode ?? suggestedMode;
  const columns = activeMode === 'gallery'
    ? Math.max(1, Math.floor(viewport.width / tile.min))
    : 1;
  const { onKeyDown } = useGridNavigation({ entries: visibleEntries, columns });

  const handleClick = useCallback((event: React.MouseEvent, target: DiskEntry) => {
    const store = useDiskStore.getState();
    if (event.shiftKey) store.selectRange(visibleEntries, target.path);
    else if (event.metaKey || event.ctrlKey) store.toggleSelected(target.path);
    else store.select(target.path);
  }, [visibleEntries]);

  useEffect(() => {
    const index = visibleEntries.findIndex((candidate) => candidate.path === selectedPath);
    if (index === -1) return;

    if (activeMode === 'gallery') {
      gridRef.current?.scrollToItem({
        rowIndex: Math.floor(index / columns),
        columnIndex: index % columns,
      });
    } else {
      listRef.current?.scrollToItem(index);
    }
  }, [selectedPath, visibleEntries, activeMode, columns]);

  if (!entries) {
    return <GallerySkeleton />;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 shrink-0">
        <span className="truncate text-2xs text-muted-foreground">
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
          className="flex min-h-0 flex-1"
        >
          {hasActiveFilter ? (
            <EmptyState
              Icon={SearchX}
              title={`No files matching “${filter}”`}
              description="Try a different filter or clear it to see everything in this folder."
              action={(
                <button
                  type="button"
                  onClick={() => setFilter('')}
                  data-testid="disk-folder-clear-filter"
                  className="rounded-md bg-accent px-3 py-2 text-xs text-accent-foreground transition-colors duration-100 hover:opacity-90"
                >
                  Clear filter
                </button>
              )}
            />
          ) : (
            <EmptyState
              Icon={FolderOpen}
              title="This folder is empty"
              description="Add files here or open a different folder to keep browsing."
            />
          )}
        </div>
      ) : activeMode === 'gallery' ? (
        <div
          ref={viewportRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          data-testid="disk-folder-gallery"
          className="flex-1 min-h-0 outline-none"
        >
          <FixedSizeGrid
            ref={gridRef}
            columnCount={columns}
            rowCount={Math.ceil(visibleEntries.length / columns)}
            columnWidth={tile.width}
            rowHeight={tile.height}
            width={viewport.width}
            height={viewport.height}
            itemKey={({ columnIndex, rowIndex }) => {
              const item = visibleEntries[rowIndex * columns + columnIndex];
              return item?.path ?? `empty-${rowIndex}-${columnIndex}`;
            }}
          >
            {({ columnIndex, rowIndex, style }) => {
              const item = visibleEntries[rowIndex * columns + columnIndex];
              if (!item) return null;

              return (
                <div style={style} className="p-2">
                  <GalleryTile
                    entry={item}
                    isSelected={selectedPaths.includes(item.path)}
                    onSelect={(event) => handleClick(event, item)}
                  />
                </div>
              );
            }}
          </FixedSizeGrid>
        </div>
      ) : (
        <div
          ref={viewportRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          data-testid="disk-folder-list"
          className="flex-1 min-h-0 outline-none"
        >
          <FixedSizeList
            ref={listRef}
            itemCount={visibleEntries.length}
            itemSize={ROW_HEIGHT}
            width={viewport.width}
            height={viewport.height}
            itemKey={(index) => visibleEntries[index].path}
          >
            {({ index, style }) => {
              const item = visibleEntries[index];

              return (
                <div style={style}>
                  <ListRow
                    entry={item}
                    isSelected={selectedPaths.includes(item.path)}
                    onSelect={(event) => handleClick(event, item)}
                  />
                </div>
              );
            }}
          </FixedSizeList>
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
    className={`rounded-md p-2 transition-colors duration-100 ${active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-muted-foreground'}`}
  >
    <Icon className="h-4 w-4" />
  </button>
);

interface EntryProps {
  entry: DiskEntry;
  isSelected: boolean;
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

const GalleryTile: React.FC<EntryProps> = ({ entry, isSelected, onSelect }) => {
  const Icon = ICONS[entry.kind];
  const [thumbFailed, setThumbFailed] = useState(false);
  const { dragProps, isDropTarget } = useDropTarget(entry);

  useEffect(() => {
    setThumbFailed(false);
  }, [entry.mtimeMs, entry.size]);

  // Anything the OS can render a preview for gets a thumbnail, not just images
  // — on macOS that includes PDFs and video first-frames.
  const canThumbnail =
    !entry.isDirectory && ['image', 'pdf', 'video'].includes(entry.kind) && !thumbFailed;

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
      className={`flex h-full min-w-0 w-full flex-col gap-2 rounded-lg p-2 text-left transition-colors duration-100 ${
        isSelected ? 'bg-accent/60 ring-1 ring-accent' : 'hover:bg-muted/50'
      } ${isDropTarget ? 'ring-1 ring-primary bg-primary/10' : ''}`}
      {...dragProps}
    >
      <div className="aspect-square rounded-md overflow-hidden bg-muted/40 grid place-items-center">
        {canThumbnail ? (
          <img
            src={toOpalThumbUrl(entry.path)}
            alt={entry.name}
            loading="lazy"
            decoding="async"
            onError={() => setThumbFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <Icon className="h-8 w-8 opacity-40" />
        )}
      </div>
      {/* Two lines then ellipsis, with a reserved height so tiles stay on a
          consistent baseline regardless of how long each name is. */}
      <span className="min-h-8 break-words px-1 text-xs leading-snug line-clamp-2">
        {entry.name}
      </span>
    </button>
  );
};

const ListRow: React.FC<EntryProps> = ({ entry, isSelected, onSelect }) => {
  const Icon = ICONS[entry.kind];
  const { dragProps, isDropTarget } = useDropTarget(entry);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      data-testid={`disk-folder-entry-${entry.path}`}
      className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors duration-100 ${
        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
      } ${isDropTarget ? 'ring-1 ring-primary bg-primary/10' : ''}`}
      {...dragProps}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-60" />
      <span className="flex-1 truncate">{entry.name}</span>
      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
        {entry.isDirectory ? '—' : formatBytes(entry.size)}
      </span>
    </button>
  );
};

function useDropTarget(entry: DiskEntry) {
  const [isDropTarget, setIsDropTarget] = useState(false);

  const isNoopDropTarget = useMemo(
    () => (source: string) => {
      if (!source || source === entry.path) return true;
      const parent = source.slice(0, source.lastIndexOf('/'));
      return parent === entry.path;
    },
    [entry.path]
  );

  const dragProps = {
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      setActiveDragSourcePath(entry.path);
      event.dataTransfer.setData('text/plain', entry.path);
      event.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => {
      setIsDropTarget(false);
      clearActiveDragSourcePath();
    },
    onDragOver: (event: React.DragEvent) => {
      if (!entry.isDirectory) return;
      const source = getActiveDragSourcePath() ?? '';
      if (isNoopDropTarget(source)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setIsDropTarget(true);
    },
    onDragLeave: () => setIsDropTarget(false),
    onDrop: async (event: React.DragEvent) => {
      event.preventDefault();
      setIsDropTarget(false);
      if (!entry.isDirectory) return;

      const source = event.dataTransfer.getData('text/plain');
      clearActiveDragSourcePath();
      if (isNoopDropTarget(source)) return;

      const result = await window.diskAPI.move(source, entry.path);
      if (!result.success) {
        useDiskStore.setState({ loading: { isLoading: false, error: result.error } });
      }
    },
  };

  return { dragProps, isDropTarget };
}
