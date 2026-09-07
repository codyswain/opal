import { pathMutationCoordinator } from '../navigation/pathMutationCoordinator';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, List as ListIcon, Image as ImageIcon, Folder, FileText, Film, Music, File, SearchX } from 'lucide-react';
import { FixedSizeGrid, FixedSizeList, type GridChildComponentProps, type ListChildComponentProps } from 'react-window';
import { formatBytes } from '@/common/formatBytes';
import type { DiskEntry, FileKind } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';
import { toOpalThumbUrl } from '@/common/opalThumbUrl';
import { clearActiveDragSourcePath, getActiveDragSourcePath, setActiveDragSourcePath } from './dragMoveState';
import { useGridNavigation } from '../hooks/useGridNavigation';
import { useElementSize } from '../hooks/useElementSize';
import { useFilesNavigation } from '../navigation/FilesNavigationContext';
import type { FilesBrowseLocation } from '../navigation/filesLocation';
import { filesLocationSnapshots } from '../navigation/filesLocationSnapshots';
import { EmptyState } from './EmptyState';

export type CollectionViewMode = 'gallery' | 'list';

/** Extra per-row text, such as an activity reason and the item's folder. */
export interface CollectionRowDecoration {
  detail: string;
  secondary?: string;
  /** Shown as small pills after the name; at most three are rendered. */
  tags?: string[];
}

export interface CollectionViewProps {
  /** Snapshot key; scroll and layout restore per collection. */
  location: FilesBrowseLocation;
  /** Visible rows, already filtered and ordered by the owner. */
  entries: DiskEntry[];
  suggestedMode: CollectionViewMode;
  filter: string;
  onClearFilter: () => void;
  /** Rendered when there are no rows and no active filter. */
  emptyState: React.ReactNode;
  decorate?: (entry: DiskEntry) => CollectionRowDecoration | null;
  countLabel?: string;
  /** Controlled layout, for collections whose layout is part of their definition. */
  mode?: CollectionViewMode;
  onModeChange?: (mode: CollectionViewMode) => void;
}

const ICONS: Record<FileKind, React.ComponentType<{ className?: string }>> = {
  directory: Folder, image: ImageIcon, markdown: FileText, text: FileText,
  pdf: File, video: Film, audio: Music, other: File,
};

const ROW_HEIGHT = 40;
const TILE = {
  comfortable: { width: 172, height: 208, min: 160 },
  compact: { width: 116, height: 144, min: 104 },
} as const;

/**
 * The virtualized list/gallery shared by every collection. Rows are keyed by
 * entry path so a reorder never remounts a row under the pointer or moves
 * keyboard focus to a different item.
 */
export const CollectionView: React.FC<CollectionViewProps> = ({
  location, entries, suggestedMode, filter, onClearFilter, emptyState, decorate, countLabel,
  mode: controlledMode, onModeChange,
}) => {
  const navigation = useFilesNavigation();
  const [snapshot] = useState(() => filesLocationSnapshots.read(location));
  const selectedPath = useDiskStore((state) => state.selectedPath);
  const selectedPaths = useDiskStore((state) => state.selectedPaths);
  const density = useDiskStore((state) => state.density);

  const [localMode, setLocalMode] = useState<CollectionViewMode | null>(snapshot?.scroll ? snapshot.scroll.view === 'details' ? 'list' : 'gallery' : null);
  const mode = controlledMode ?? localMode;
  const setMode = (next: CollectionViewMode) => {
    if (onModeChange) onModeChange(next);
    if (controlledMode === undefined) setLocalMode(next);
  };
  const [viewportRef, viewport] = useElementSize<HTMLDivElement>();
  const gridRef = useRef<FixedSizeGrid>(null);
  const listRef = useRef<FixedSizeList>(null);

  const hasActiveFilter = filter.trim().length > 0;
  const tile = TILE[density];

  const activeMode = mode ?? suggestedMode;
  const columns = activeMode === 'gallery'
    ? Math.max(1, Math.floor(viewport.width / tile.width))
    : 1;
  const { onKeyDown } = useGridNavigation({ entries, columns });

  const handleClick = useCallback((event: React.MouseEvent, target: DiskEntry) => {
    const store = useDiskStore.getState();
    if (event.shiftKey) store.selectRange(entries, target.path);
    else if (event.metaKey || event.ctrlKey) store.toggleSelected(target.path);
    else store.select(target.path);
  }, [entries]);

  const lastSelection = useRef(selectedPath);
  useEffect(() => {
    // Restoration and mounting must not move a viewport to the saved selection.
    if (lastSelection.current === selectedPath) return;
    lastSelection.current = selectedPath;
    const index = entries.findIndex(candidate => candidate.path === selectedPath);
    if (index === -1) return;
    if (activeMode === 'gallery') gridRef.current?.scrollToItem({rowIndex: Math.floor(index / columns), columnIndex: index % columns});
    else listRef.current?.scrollToItem(index);
  }, [selectedPath, entries, activeMode, columns]);
  const saveScroll = (offset: number) => filesLocationSnapshots.patch(location, {scroll: {view: activeMode === 'list' ? 'details' : 'gallery', offset}});
  const activate = useCallback(
    (entry: DiskEntry) => entry.isDirectory ? navigation.navigateDirectory(entry.path) : navigation.openFile(entry.path),
    [navigation]
  );

  const itemData: CollectionItemData = useMemo(
    () => ({ entries, selectedPaths, columns, select: handleClick, activate, decorate }),
    [entries, selectedPaths, columns, handleClick, activate, decorate]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 shrink-0">
        <span className="truncate text-2xs text-muted-foreground">
          {countLabel ?? `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`}
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

      {entries.length === 0 ? (
        <div
          data-testid={hasActiveFilter ? 'disk-folder-no-matches' : 'disk-folder-empty'}
          className="flex min-h-0 flex-1"
        >
          {hasActiveFilter ? (
            <EmptyState
              Icon={SearchX}
              title={`No files matching “${filter}”`}
              description="Try a different filter or clear it to see everything here."
              action={(
                <button
                  type="button"
                  onClick={onClearFilter}
                  data-testid="disk-folder-clear-filter"
                  data-disk-shortcuts-ignore="true"
                  className="rounded-md bg-accent px-3 py-2 text-xs text-accent-foreground transition-colors duration-100 hover:opacity-90"
                >
                  Clear filter
                </button>
              )}
            />
          ) : (
            emptyState
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
            itemData={itemData}
            initialScrollTop={snapshot?.scroll?.view === 'gallery' ? snapshot.scroll.offset : 0}
            onScroll={({scrollTop}) => saveScroll(scrollTop)}
            columnCount={columns}
            rowCount={Math.ceil(entries.length / columns)}
            columnWidth={tile.width}
            rowHeight={tile.height}
            width={viewport.width}
            height={viewport.height}
            itemKey={({ columnIndex, rowIndex }) => {
              const item = entries[rowIndex * columns + columnIndex];
              return item?.path ?? `empty-${rowIndex}-${columnIndex}`;
            }}
          >
            {VirtualGalleryItem}
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
            itemData={itemData}
            initialScrollOffset={snapshot?.scroll?.view === 'details' ? snapshot.scroll.offset : 0}
            onScroll={({scrollOffset}) => saveScroll(scrollOffset)}
            itemCount={entries.length}
            itemSize={ROW_HEIGHT}
            width={viewport.width}
            height={viewport.height}
            itemKey={(index) => entries[index].path}
          >
            {VirtualListItem}
          </FixedSizeList>
        </div>
      )}
    </div>
  );
};

interface CollectionItemData {
  entries: DiskEntry[];
  selectedPaths: string[];
  columns: number;
  select: (event: React.MouseEvent<HTMLButtonElement>, entry: DiskEntry) => void;
  activate: (entry: DiskEntry) => void;
  decorate?: (entry: DiskEntry) => CollectionRowDecoration | null;
}

// react-window renders its child as a component type. These definitions must
// stay stable across selection updates so the browser retains the same pointer
// target between clicks, along with keyboard focus and in-progress drag state.
function VirtualGalleryItem({ columnIndex, rowIndex, style, data }: GridChildComponentProps<CollectionItemData>) {
  const entry = data.entries[rowIndex * data.columns + columnIndex];
  if (!entry) return null;
  return (
    <div style={style} className="p-2">
      <GalleryTile entry={entry} isSelected={data.selectedPaths.includes(entry.path)}
        decoration={data.decorate?.(entry) ?? null}
        onSelect={event => data.select(event, entry)} onOpen={() => data.activate(entry)} />
    </div>
  );
}

function VirtualListItem({ index, style, data }: ListChildComponentProps<CollectionItemData>) {
  const entry = data.entries[index];
  return (
    <div style={style}>
      <ListRow entry={entry} isSelected={data.selectedPaths.includes(entry.path)}
        decoration={data.decorate?.(entry) ?? null}
        onSelect={event => data.select(event, entry)} onOpen={() => data.activate(entry)} />
    </div>
  );
}

interface ModeButtonProps {
  mode: CollectionViewMode;
  active: boolean;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  onSelect: (mode: CollectionViewMode) => void;
}

const ModeButton: React.FC<ModeButtonProps> = ({ mode, active, label, Icon, onSelect }) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={active}
    data-testid={`disk-folder-view-${mode}`}
    data-disk-shortcuts-ignore="true"
    onClick={() => onSelect(mode)}
    className={`rounded-md p-2 transition-colors duration-100 ${active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-muted-foreground'}`}
  >
    <Icon className="h-4 w-4" />
  </button>
);

interface EntryProps {
  entry: DiskEntry;
  isSelected: boolean;
  decoration: CollectionRowDecoration | null;
  onOpen: () => void;
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

const GalleryTile: React.FC<EntryProps> = ({ entry, isSelected, decoration, onSelect, onOpen }) => {
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
      onDoubleClick={onOpen}
      data-disk-collection-item="true"
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
      {decoration ? (
        <span className="truncate px-1 text-2xs text-muted-foreground">{decoration.detail}</span>
      ) : null}
    </button>
  );
};

const ListRow: React.FC<EntryProps> = ({ entry, isSelected, decoration, onSelect, onOpen }) => {
  const Icon = ICONS[entry.kind];
  const { dragProps, isDropTarget } = useDropTarget(entry);

  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onOpen}
      data-disk-collection-item="true"
      aria-pressed={isSelected}
      data-testid={`disk-folder-entry-${entry.path}`}
      className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors duration-100 ${
        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
      } ${isDropTarget ? 'ring-1 ring-primary bg-primary/10' : ''}`}
      {...dragProps}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-60" />
      {decoration?.secondary || decoration?.tags?.length ? (
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate">{entry.name}</span>
          {decoration.tags?.slice(0, 3).map((tag) => (
            <span key={tag} data-testid="row-tag" className="shrink-0 rounded-full bg-surface-hover px-1.5 text-2xs text-foreground-secondary">{tag}</span>
          ))}
          {decoration.tags && decoration.tags.length > 3 ? <span className="shrink-0 text-2xs text-muted-foreground">+{decoration.tags.length - 3}</span> : null}
          {decoration.secondary ? <span className="truncate text-2xs text-muted-foreground">{decoration.secondary}</span> : null}
        </span>
      ) : (
        <span className="flex-1 truncate">{entry.name}</span>
      )}
      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
        {decoration ? decoration.detail : entry.isDirectory ? '—' : formatBytes(entry.size)}
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
      } else {
        pathMutationCoordinator.applyAppMutation({kind: 'move', oldPath: source, newPath: result.data.path});
      }
    },
  };

  return { dragProps, isDropTarget };
}
