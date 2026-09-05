import * as React from 'react';
import { ChevronRight, Folder, FolderOpen, FolderPlus } from 'lucide-react';
import {
  FixedSizeList,
  type ListChildComponentProps,
} from 'react-window';
import { browseFiles } from '@/renderer/features/disk-explorer/navigation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useElementSize } from '@/renderer/features/disk-explorer/hooks/useElementSize';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import { Button } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import {
  flattenDirectoryTree,
  type FlattenedDirectoryNode,
} from '../utils/flattenDirectoryTree';

const TREE_ROW_HEIGHT = 28;

interface DirectoryTreeProps {
  onNavigate?: () => void;
}

interface DirectoryRowData {
  activePath: string | null;
  keyboardPath: string | null;
  nodes: readonly FlattenedDirectoryNode[];
  onActivate: (path: string) => void;
  onFocusIndex: (index: number) => void;
  onKeyDown: (index: number, event: React.KeyboardEvent) => void;
  onToggle: (path: string) => void;
}

function DirectoryRow({
  data,
  index,
  style,
}: ListChildComponentProps<DirectoryRowData>) {
  const node = data.nodes[index];
  const isActive = data.activePath === node.path;
  const isKeyboardTarget =
    data.keyboardPath === node.path ||
    (data.keyboardPath === null && index === 0);
  const Icon = node.isExpanded ? FolderOpen : Folder;

  return (
    <div style={style}>
      <div
        role="treeitem"
        aria-expanded={node.isExpandable ? node.isExpanded : undefined}
        aria-level={node.depth + 1}
        aria-posinset={node.positionInSet}
        aria-setsize={node.setSize}
        aria-selected={isActive}
        tabIndex={isKeyboardTarget ? 0 : -1}
        data-directory-tree-index={index}
        data-testid={`disk-tree-item-${node.path}`}
        onClick={() => data.onActivate(node.path)}
        onFocus={() => data.onFocusIndex(index)}
        onKeyDown={(event) => data.onKeyDown(index, event)}
        style={{ paddingLeft: `${node.depth * 14 + 6}px` }}
        className={cn(
          'group mx-1 flex h-row-compact cursor-default select-none items-center gap-1 rounded-row pr-2 text-ui text-foreground-secondary outline-none',
          'transition-colors duration-hover ease-standard hover:bg-surface-hover hover:text-foreground',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
          isActive && 'bg-surface-selected text-foreground'
        )}
      >
        {node.isExpandable ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={
              node.isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`
            }
            data-testid={`disk-tree-toggle-${node.path}`}
            onClick={(event) => {
              event.stopPropagation();
              data.onToggle(node.path);
            }}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-row text-icon outline-none hover:bg-surface-active focus-visible:ring-2 focus-visible:ring-focus"
          >
            <ChevronRight
              aria-hidden
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-disclosure ease-standard',
                node.isExpanded && 'rotate-90'
              )}
            />
          </button>
        ) : (
          <span aria-hidden className="h-5 w-5 shrink-0" />
        )}
        <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-icon" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </div>
    </div>
  );
}

export function DirectoryTree({ onNavigate }: DirectoryTreeProps) {
  const roots = useDiskStore((state) => state.roots);
  const listings = useDiskStore((state) => state.listings);
  const expanded = useDiskStore((state) => state.expanded);
  const currentDirectory = useDiskStore((state) => state.currentDirectory);
  const isLoading = useDiskStore((state) => state.loading.isLoading);
  const loadRoots = useDiskStore((state) => state.loadRoots);
  const openFolder = useDiskStore((state) => state.openFolder);
  const toggleExpanded = useDiskStore((state) => state.toggleExpanded);
  const { navigateFiles } = useShell();
  const [viewportRef, viewport] = useElementSize<HTMLDivElement>();
  const listRef = React.useRef<FixedSizeList<DirectoryRowData>>(null);
  const [keyboardPath, setKeyboardPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    void loadRoots();
  }, [loadRoots]);

  const nodes = React.useMemo(
    () => flattenDirectoryTree({ expanded, listings, roots }),
    [expanded, listings, roots]
  );

  React.useEffect(() => {
    if (
      keyboardPath &&
      !nodes.some((candidate) => candidate.path === keyboardPath)
    ) {
      setKeyboardPath(null);
    }
  }, [keyboardPath, nodes]);

  const activate = React.useCallback(
    (path: string) => {
      navigateFiles(browseFiles(path));
      onNavigate?.();
    },
    [navigateFiles, onNavigate]
  );

  const focusIndex = React.useCallback(
    (index: number) => {
      const node = nodes[index];
      if (!node) return;
      setKeyboardPath(node.path);
      listRef.current?.scrollToItem(index, 'smart');
      window.requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(
          `[data-directory-tree-index="${index}"]`
        );
        row?.focus();
      });
    },
    [nodes]
  );

  const handleKeyDown = React.useCallback(
    (index: number, event: React.KeyboardEvent) => {
      const node = nodes[index];
      if (!node) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusIndex(Math.min(nodes.length - 1, index + 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusIndex(Math.max(0, index - 1));
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        focusIndex(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        focusIndex(nodes.length - 1);
        return;
      }
      if (event.key === 'ArrowRight' && node.isExpandable) {
        event.preventDefault();
        if (!node.isExpanded) {
          void toggleExpanded(node.path);
        } else if (nodes[index + 1]?.depth > node.depth) {
          focusIndex(index + 1);
        }
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (node.isExpanded) {
          void toggleExpanded(node.path);
          return;
        }
        if (node.parentPath) {
          focusIndex(
            nodes.findIndex(
              (candidate) => candidate.path === node.parentPath
            )
          );
        }
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        activate(node.path);
      }
    },
    [activate, focusIndex, nodes, toggleExpanded]
  );

  const itemData = React.useMemo<DirectoryRowData>(
    () => ({
      activePath: currentDirectory,
      keyboardPath,
      nodes,
      onActivate: activate,
      onFocusIndex: (index) => setKeyboardPath(nodes[index]?.path ?? null),
      onKeyDown: handleKeyDown,
      onToggle: (path) => void toggleExpanded(path),
    }),
    [
      activate,
      currentDirectory,
      handleKeyDown,
      keyboardPath,
      nodes,
      toggleExpanded,
    ]
  );

  const handleOpenFolder = async () => {
    await openFolder();
    const directory = useDiskStore.getState().currentDirectory;
    if (!directory) return;
    navigateFiles(browseFiles(directory));
    onNavigate?.();
  };

  return (
    <div ref={viewportRef} className="h-full min-h-0">
      {nodes.length > 0 ? (
        <div
          role="tree"
          aria-label="Open folders"
          aria-busy={isLoading}
          className="h-full min-h-0"
        >
          <FixedSizeList
            ref={listRef}
            height={Math.max(TREE_ROW_HEIGHT, viewport.height)}
            width="100%"
            itemCount={nodes.length}
            itemData={itemData}
            itemKey={(index) => nodes[index].path}
            itemSize={TREE_ROW_HEIGHT}
            overscanCount={6}
          >
            {DirectoryRow}
          </FixedSizeList>
        </div>
      ) : (
        <div
          data-testid="disk-tree-empty"
          className="flex h-full min-h-32 flex-col items-center justify-center gap-2 px-4 text-center"
        >
          <Folder aria-hidden className="h-5 w-5 text-icon" />
          <p className="text-control text-foreground-tertiary">
            No folders open
          </p>
          <Button
            variant="secondary"
            size="compact"
            onClick={() => void handleOpenFolder()}
            data-testid="disk-tree-open-folder"
          >
            <FolderPlus aria-hidden className="h-4 w-4" />
            Open folder
          </Button>
        </div>
      )}
    </div>
  );
}

export type { DirectoryTreeProps };
