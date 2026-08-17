import React, { useCallback, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Image as ImageIcon, Film, Music, File } from 'lucide-react';
import type { DiskEntry, FileKind } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';
import { clearActiveDragSourcePath, getActiveDragSourcePath, setActiveDragSourcePath } from './dragMoveState';

const ICONS: Record<FileKind, React.ComponentType<{ className?: string }>> = {
  directory: Folder,
  image: ImageIcon,
  markdown: FileText,
  text: FileText,
  pdf: File,
  video: Film,
  audio: Music,
  other: File,
};

interface DiskTreeItemProps {
  entry: DiskEntry;
  depth: number;
}

export const DiskTreeItem: React.FC<DiskTreeItemProps> = ({ entry, depth }) => {
  const isExpanded = useDiskStore((state) => Boolean(state.expanded[entry.path]));
  const isSelected = useDiskStore((state) => state.selectedPath === entry.path);
  const children = useDiskStore((state) => state.listings[entry.path]);
  const toggleExpanded = useDiskStore((state) => state.toggleExpanded);
  const select = useDiskStore((state) => state.select);
  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleSelect = useCallback(() => select(entry.path), [select, entry.path]);

  const handleToggle = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      void toggleExpanded(entry.path);
    },
    [toggleExpanded, entry.path]
  );

  const moveInto = useCallback(async (source: string, destination: string) => {
    const result = await window.diskAPI.move(source, destination);
    if (!result.success) {
      useDiskStore.setState({ loading: { isLoading: false, error: result.error } });
    }
    // On success the watcher refreshes both listings, so there is nothing to
    // update here.
  }, []);

  const isNoopDropTarget = useCallback(
    (source: string) => {
      if (!source || source === entry.path) return true;
      const parent = source.slice(0, source.lastIndexOf('/'));
      return parent === entry.path;
    },
    [entry.path]
  );

  const Icon = entry.isDirectory && isExpanded ? FolderOpen : ICONS[entry.kind];
  const Chevron = isExpanded ? ChevronDown : ChevronRight;

  return (
    <>
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={entry.isDirectory ? isExpanded : undefined}
        data-testid={`disk-tree-item-${entry.path}`}
        onClick={handleSelect}
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          setActiveDragSourcePath(entry.path);
          event.dataTransfer.setData('text/plain', entry.path);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => {
          setIsDropTarget(false);
          clearActiveDragSourcePath();
        }}
        onDragOver={(event) => {
          if (!entry.isDirectory) return;
          const source = getActiveDragSourcePath() ?? '';
          if (isNoopDropTarget(source)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setIsDropTarget(true);
        }}
        onDragLeave={() => setIsDropTarget(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsDropTarget(false);
          if (!entry.isDirectory) return;

          const source = event.dataTransfer.getData('text/plain');
          clearActiveDragSourcePath();
          if (isNoopDropTarget(source)) return;
          void moveInto(source, entry.path);
        }}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={[
          'flex cursor-default select-none items-center gap-1 rounded-sm py-1 pr-2 text-sm transition-colors duration-100',
          isSelected
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-muted/60 text-foreground/90',
          isDropTarget ? 'ring-1 ring-primary bg-primary/10' : '',
        ].join(' ')}
      >
        {entry.isDirectory ? (
          <button
            type="button"
            onClick={handleToggle}
            aria-label={isExpanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
            data-testid={`disk-tree-toggle-${entry.path}`}
            className="shrink-0 rounded p-1 transition-colors duration-100 hover:bg-muted"
          >
            <Chevron className="h-3 w-3" />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="truncate">{entry.name}</span>
      </div>

      {entry.isDirectory && isExpanded && children?.map((child) => (
        <DiskTreeItem key={child.path} entry={child} depth={depth + 1} />
      ))}
    </>
  );
};
