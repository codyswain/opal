import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, List as ListIcon, Image as ImageIcon, Folder, FileText, Film, Music, File } from 'lucide-react';
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

type ViewMode = 'gallery' | 'list';

const ICONS: Record<FileKind, React.ComponentType<{ className?: string }>> = {
  directory: Folder, image: ImageIcon, markdown: FileText, text: FileText,
  pdf: File, video: Film, audio: Music, other: File,
};

interface DiskFolderViewProps {
  dirPath: string;
}

const TILE_WIDTH = 172;
const TILE_HEIGHT = 208;
const ROW_HEIGHT = 36;

export const DiskFolderView: React.FC<DiskFolderViewProps> = ({ dirPath }) => {
  const entries = useDiskStore((state) => state.listings[dirPath]);
  const loadDirectory = useDiskStore((state) => state.loadDirectory);
  const select = useDiskStore((state) => state.select);
  const selectedPath = useDiskStore((state) => state.selectedPath);
  const sort = useDiskStore((state) => state.sort);
  const filter = useDiskStore((state) => state.filter);
  const setFilter = useDiskStore((state) => state.setFilter);

  const [mode, setMode] = useState<ViewMode | null>(null);
  const [viewportRef, viewport] = useElementSize<HTMLDivElement>();
  const gridRef = useRef<FixedSizeGrid>(null);
  const listRef = useRef<FixedSizeList>(null);

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
  const columns = activeMode === 'gallery'
    ? Math.max(1, Math.floor(viewport.width / TILE_WIDTH))
    : 1;
  const { onKeyDown } = useGridNavigation({ entries: visibleEntries, columns });

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
            columnWidth={TILE_WIDTH}
            rowHeight={TILE_HEIGHT}
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
                <div style={style} className="p-1.5">
                  <GalleryTile
                    entry={item}
                    isSelected={selectedPath === item.path}
                    onSelect={() => select(item.path)}
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
                    isSelected={selectedPath === item.path}
                    onSelect={() => select(item.path)}
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
      className={`w-full h-full flex flex-col gap-1.5 text-left rounded-lg p-1.5 min-w-0 ${
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
      <span className="text-xs leading-snug px-0.5 line-clamp-2 break-words min-h-[2rem]">
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
      className={`w-full flex items-center gap-2 px-4 py-1.5 text-sm text-left ${
        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
      } ${isDropTarget ? 'ring-1 ring-primary bg-primary/10' : ''}`}
      {...dragProps}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-60" />
      <span className="flex-1 truncate">{entry.name}</span>
      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
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
