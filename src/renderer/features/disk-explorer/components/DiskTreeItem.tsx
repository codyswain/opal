import React, { useCallback } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Image as ImageIcon, Film, Music, File } from 'lucide-react';
import type { DiskEntry, FileKind } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';

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

  const handleSelect = useCallback(() => select(entry.path), [select, entry.path]);

  const handleToggle = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      void toggleExpanded(entry.path);
    },
    [toggleExpanded, entry.path]
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
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        className={[
          'flex items-center gap-1 py-[3px] pr-2 text-sm cursor-default select-none rounded-sm',
          isSelected
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-muted/60 text-foreground/90',
        ].join(' ')}
      >
        {entry.isDirectory ? (
          <button
            type="button"
            onClick={handleToggle}
            aria-label={isExpanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
            data-testid={`disk-tree-toggle-${entry.path}`}
            className="p-0.5 rounded hover:bg-muted shrink-0"
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
