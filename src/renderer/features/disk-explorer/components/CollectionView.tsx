import { pathMutationCoordinator } from '../navigation/pathMutationCoordinator';
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, List as ListIcon, Image as ImageIcon, Folder, FileText, Film, Music, File, SearchX } from 'lucide-react';
import { toast } from 'sonner';
import { basenameFsPath } from '@/common/fsPaths';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger,
} from '@/renderer/shared/ui';
import { collectionDirectory } from '../navigation/filesLocation';
import { FolderPickerDialog } from './query/FolderPickerDialog';
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
  /** Whether the status bar carries layout toggles; off when a toolbar above already does. */
  layoutControls?: boolean;
}

const ICONS: Record<FileKind, React.ComponentType<{ className?: string; strokeWidth?: string | number }>> = {
  directory: Folder, image: ImageIcon, markdown: FileText, text: FileText,
  pdf: File, video: Film, audio: Music, other: File,
};

const ROW_HEIGHT = 40;
const TILE = {
  comfortable: { width: 176, height: 196, min: 160 },
  compact: { width: 124, height: 152, min: 104 },
} as const;

/**
 * The virtualized list/gallery shared by every collection. Rows are keyed by
 * entry path so a reorder never remounts a row under the pointer or moves
 * keyboard focus to a different item.
 */
export const CollectionView: React.FC<CollectionViewProps> = ({
  location, entries, suggestedMode, filter, onClearFilter, emptyState, decorate, countLabel,
  mode: controlledMode, onModeChange, layoutControls = true,
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

  const roots = useDiskStore((state) => state.roots);
  const [moving, setMoving] = useState<string[] | null>(null);
  const directory = collectionDirectory(location.collection);

  // A plain click selects and opens (files take the preview slot, folders open
  // in place); a modified click only changes the selection, as in Finder.
  const handleClick = useCallback((event: React.MouseEvent, target: DiskEntry) => {
    const store = useDiskStore.getState();
    if (event.shiftKey) { store.selectRange(entries, target.path); return; }
    if (event.metaKey || event.ctrlKey) { store.toggleSelected(target.path); return; }
    store.select(target.path);
    if (target.isDirectory) navigation.navigateDirectory(target.path);
    else navigation.previewFile(target.path);
  }, [entries, navigation]);

  /** Right-clicking a row outside the selection moves the selection onto it. */
  const handleContextMenu = useCallback((target: DiskEntry) => {
    const store = useDiskStore.getState();
    if (!store.selectedPaths.includes(target.path)) store.select(target.path);
  }, []);

  const targetsFor = useCallback((entry: DiskEntry): string[] => {
    const { selectedPaths } = useDiskStore.getState();
    return selectedPaths.includes(entry.path) && selectedPaths.length > 1 ? [...selectedPaths] : [entry.path];
  }, []);

  const moveTo = async (destination: string) => {
    const sources = moving ?? [];
    setMoving(null);
    for (const source of sources) {
      const parent = source.slice(0, source.lastIndexOf('/'));
      if (parent === destination || source === destination || destination.startsWith(`${source}/`)) continue;
      const result = await window.diskAPI.move(source, destination);
      if (!result.success) { toast.error(result.error); return; }
      pathMutationCoordinator.applyAppMutation({ kind: 'move', oldPath: source, newPath: result.data.path });
    }
    if (sources.length > 0) toast(`Moved ${sources.length === 1 ? basenameFsPath(sources[0]) : `${sources.length} items`} to ${basenameFsPath(destination)}`);
  };

  const rowActions = useMemo((): RowActions => ({
    open: (entry) => (entry.isDirectory ? navigation.navigateDirectory(entry.path) : navigation.openFile(entry.path)),
    // Dialogs open after the menu has closed; opening one while the menu still
    // holds focus makes the two fight over it.
    quickLook: (entry) => { const store = useDiskStore.getState(); store.select(entry.path); store.setQuickPreviewPath(entry.path); setTimeout(() => store.openQuickLook(), 0); },
    rename: (entry) => useDiskStore.getState().beginRename(entry.path),
    move: (entry) => { const targets = targetsFor(entry); setTimeout(() => setMoving(targets), 0); },
    reveal: (entry) => { void window.diskAPI.reveal(entry.path).then((result) => { if (!result.success) toast.error(result.error); }); },
    openExternal: (entry) => { void window.diskAPI.openExternal(entry.path).then((result) => { if (!result.success) toast.error(result.error); }); },
    copyPath: (entry) => { void navigator.clipboard?.writeText(targetsFor(entry).join('\n')); },
    trash: (entry) => { const store = useDiskStore.getState(); if (!store.selectedPaths.includes(entry.path)) store.select(entry.path); store.beginDelete(entry.path); },
    countFor: (entry) => targetsFor(entry).length,
  }), [navigation, targetsFor]);

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
  // Double-click pins: a previewed file stays open, a folder simply opens.
  const activate = useCallback(
    (entry: DiskEntry) => entry.isDirectory ? navigation.navigateDirectory(entry.path) : navigation.openFile(entry.path),
    [navigation]
  );

  const itemData: CollectionItemData = useMemo(
    () => ({ entries, selectedPaths, columns, select: handleClick, activate, decorate, contextMenu: handleContextMenu, actions: rowActions }),
    [entries, selectedPaths, columns, handleClick, activate, decorate, handleContextMenu, rowActions]
  );

  const surfaceMenu = directory ? (
    <ContextMenuContent data-testid="collection-surface-menu">
      <ContextMenuItem onSelect={() => useDiskStore.getState().beginNewFolder(directory)}>New folder</ContextMenuItem>
      <ContextMenuItem onSelect={() => { void window.markdownAPI.create(directory).then((result) => {
        if (!result.success) { toast.error(result.error); return; }
        void useDiskStore.getState().loadDirectory(directory, { force: true });
        navigation.openFile(result.data.path);
      }); }}>New note</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => { void window.diskAPI.reveal(directory); }}>Reveal folder in Finder</ContextMenuItem>
    </ContextMenuContent>
  ) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
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
        <ContextMenu>
        <ContextMenuTrigger asChild disabled={!surfaceMenu}>
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
        </ContextMenuTrigger>
        {surfaceMenu}
        </ContextMenu>
      ) : (
        <ContextMenu>
        <ContextMenuTrigger asChild disabled={!surfaceMenu}>
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
        </ContextMenuTrigger>
        {surfaceMenu}
        </ContextMenu>
      )}

      <FolderPickerDialog open={moving !== null} roots={roots} onOpenChange={(open) => { if (!open) setMoving(null); }} onChoose={(folder) => void moveTo(folder)} />

      {/* A Finder-style status bar: counts on the left, layout on the right. */}
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-border-subtle bg-surface px-3" data-testid="collection-status">
        <span className="truncate text-2xs text-muted-foreground">
          {countLabel ?? `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`}
          {selectedPaths.length > 1 ? ` · ${selectedPaths.length} selected` : ''}
        </span>
        {layoutControls ? (
          <div className="flex items-center gap-0.5" role="group" aria-label="Layout">
            <ModeButton mode="list" active={activeMode === 'list'} onSelect={setMode} label="List view" Icon={ListIcon} />
            <ModeButton mode="gallery" active={activeMode === 'gallery'} onSelect={setMode} label="Gallery view" Icon={LayoutGrid} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

interface RowActions {
  open: (entry: DiskEntry) => void;
  quickLook: (entry: DiskEntry) => void;
  rename: (entry: DiskEntry) => void;
  move: (entry: DiskEntry) => void;
  reveal: (entry: DiskEntry) => void;
  openExternal: (entry: DiskEntry) => void;
  copyPath: (entry: DiskEntry) => void;
  trash: (entry: DiskEntry) => void;
  /** How many items an action on this row would touch (the selection, when it includes the row). */
  countFor: (entry: DiskEntry) => number;
}

interface CollectionItemData {
  entries: DiskEntry[];
  selectedPaths: string[];
  columns: number;
  select: (event: React.MouseEvent<HTMLButtonElement>, entry: DiskEntry) => void;
  activate: (entry: DiskEntry) => void;
  decorate?: (entry: DiskEntry) => CollectionRowDecoration | null;
  contextMenu: (entry: DiskEntry) => void;
  actions: RowActions;
}

/** The row menu: the same verbs the keyboard has, plus Move to… and Copy path. */
const RowMenu: React.FC<{ entry: DiskEntry; actions: RowActions }> = ({ entry, actions }) => {
  const count = actions.countFor(entry);
  const plural = count > 1 ? `${count} items` : null;
  return (
    <ContextMenuContent data-testid={`row-menu-${entry.path}`}>
      <ContextMenuItem onSelect={() => actions.open(entry)}>{entry.isDirectory ? 'Open folder' : 'Open'}<ContextMenuShortcut>⌘↓</ContextMenuShortcut></ContextMenuItem>
      {!entry.isDirectory ? <ContextMenuItem onSelect={() => actions.quickLook(entry)}>Quick Look<ContextMenuShortcut>Space</ContextMenuShortcut></ContextMenuItem> : null}
      <ContextMenuSeparator />
      <ContextMenuItem disabled={count > 1} onSelect={() => actions.rename(entry)}>Rename…<ContextMenuShortcut>↩</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.move(entry)}>{plural ? `Move ${plural} to…` : 'Move to…'}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => actions.reveal(entry)}>Reveal in Finder</ContextMenuItem>
      {!entry.isDirectory ? <ContextMenuItem onSelect={() => actions.openExternal(entry)}>Open in default app</ContextMenuItem> : null}
      <ContextMenuItem onSelect={() => actions.copyPath(entry)}>{plural ? 'Copy paths' : 'Copy path'}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem tone="destructive" onSelect={() => actions.trash(entry)}>{plural ? `Move ${plural} to Trash` : 'Move to Trash'}<ContextMenuShortcut>⌘⌫</ContextMenuShortcut></ContextMenuItem>
    </ContextMenuContent>
  );
};

// react-window renders its child as a component type. These definitions must
// stay stable across selection updates so the browser retains the same pointer
// target between clicks, along with keyboard focus and in-progress drag state.
function VirtualGalleryItem({ columnIndex, rowIndex, style, data }: GridChildComponentProps<CollectionItemData>) {
  const entry = data.entries[rowIndex * data.columns + columnIndex];
  if (!entry) return null;
  return (
    <div style={style} className="p-2">
      <ContextMenu>
        <ContextMenuTrigger asChild onContextMenu={(event) => { event.stopPropagation(); data.contextMenu(entry); }}>
          <GalleryTile entry={entry} isSelected={data.selectedPaths.includes(entry.path)}
            decoration={data.decorate?.(entry) ?? null}
            onSelect={event => data.select(event, entry)} onOpen={() => data.activate(entry)} />
        </ContextMenuTrigger>
        <RowMenu entry={entry} actions={data.actions} />
      </ContextMenu>
    </div>
  );
}

function VirtualListItem({ index, style, data }: ListChildComponentProps<CollectionItemData>) {
  const entry = data.entries[index];
  return (
    <div style={style}>
      <ContextMenu>
        <ContextMenuTrigger asChild onContextMenu={(event) => { event.stopPropagation(); data.contextMenu(entry); }}>
          <ListRow entry={entry} isSelected={data.selectedPaths.includes(entry.path)}
            decoration={data.decorate?.(entry) ?? null}
            onSelect={event => data.select(event, entry)} onOpen={() => data.activate(entry)} />
        </ContextMenuTrigger>
        <RowMenu entry={entry} actions={data.actions} />
      </ContextMenu>
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
    className={`flex h-6 w-6 items-center justify-center rounded transition-colors duration-100 ${active ? 'bg-surface-active text-foreground' : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'}`}
  >
    <Icon className="h-3.5 w-3.5" />
  </button>
);

interface EntryProps {
  entry: DiskEntry;
  isSelected: boolean;
  decoration: CollectionRowDecoration | null;
  onOpen: () => void;
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

const TILE_TINTS: Record<FileKind, string> = {
  directory: 'text-amber-500', image: 'text-violet-500', markdown: 'text-sky-500', text: 'text-slate-400',
  pdf: 'text-rose-500', video: 'text-fuchsia-500', audio: 'text-emerald-500', other: 'text-slate-400',
};

const GalleryTile = forwardRef<HTMLButtonElement, EntryProps & Omit<React.HTMLAttributes<HTMLButtonElement>, "onSelect">>(function GalleryTile({ entry, isSelected, decoration, onSelect, onOpen, ...rest }, ref) {
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
  const meta = decoration ? decoration.detail : entry.isDirectory ? 'Folder' : formatBytes(entry.size);

  return (
    <button
      ref={ref}
      {...rest}
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
      className={`group flex h-full min-w-0 w-full flex-col gap-1.5 rounded-lg p-1.5 text-left transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isSelected ? 'bg-surface-selected' : 'hover:bg-surface-hover'
      } ${isDropTarget ? 'ring-2 ring-focus bg-focus/10' : ''}`}
      {...dragProps}
    >
      <div className={`grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-md border transition-colors ${
        isSelected ? 'border-focus/60 bg-background' : 'border-border-subtle bg-surface group-hover:border-border'
      }`}>
        {canThumbnail ? (
          <img
            src={toOpalThumbUrl(entry.path)}
            alt={entry.name}
            loading="lazy"
            decoding="async"
            onError={() => setThumbFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <Icon className={`h-9 w-9 ${TILE_TINTS[entry.kind]} opacity-80`} strokeWidth={1.5} />
        )}
      </div>
      {/* Two lines then ellipsis, with a reserved height so tiles stay on a
          consistent baseline regardless of how long each name is. */}
      <span className="min-h-8 break-words px-1 text-xs font-medium leading-snug line-clamp-2 text-foreground">
        {entry.name}
      </span>
      <span className="truncate px-1 text-2xs text-muted-foreground">{meta}</span>
    </button>
  );
});

const ListRow = forwardRef<HTMLButtonElement, EntryProps & Omit<React.HTMLAttributes<HTMLButtonElement>, "onSelect">>(function ListRow({ entry, isSelected, decoration, onSelect, onOpen, ...rest }, ref) {
  const Icon = ICONS[entry.kind];
  const { dragProps, isDropTarget } = useDropTarget(entry);

  return (
    <button
      ref={ref}
      {...rest}
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
});

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
