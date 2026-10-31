import * as React from 'react';
import { ChevronRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  FixedSizeList,
  type ListChildComponentProps,
} from 'react-window';
import { fileTreeLabel } from '@/common/fileKind';
import { isFsPathAtOrBelow, parentFsPath } from '@/common/fsPaths';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { isValidName } from '@/renderer/features/disk-explorer/components/dialogs/NameDialog';
import {
  clearActiveDragSourcePath,
  getActiveDragSourcePath,
  setActiveDragSourcePath,
} from '@/renderer/features/disk-explorer/components/dragMoveState';
import { FolderPickerDialog } from '@/renderer/features/disk-explorer/components/dialogs/FolderPickerDialog';
import { useElementSize } from '@/renderer/features/disk-explorer/hooks/useElementSize';
import {
  focusFile,
  pathMutationCoordinator,
} from '@/renderer/features/disk-explorer/navigation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { isPinned, usePinsStore } from '@/renderer/features/disk-explorer/store/pinsStore';
import { isTreeExpanded } from '@/renderer/features/disk-explorer/store/treeExpansion';
import {
  selectOpenedPath,
  useTabsStore,
} from '@/renderer/features/disk-explorer/store/tabsStore';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import {
  flattenFileTree,
  type FileTreeNode,
} from '../utils/flattenFileTree';

/** A 28px row plus the 2px gap below it. */
const TREE_ROW_HEIGHT = 30;
const TREE_INDENT = 16;
/** Keys typed within this window extend the type-ahead prefix. */
const TYPE_AHEAD_MS = 500;

interface FileTreeProps {
  onNavigate?: () => void;
}

interface FileTreeRowData {
  activePath: string | null;
  tabStopPath: string | null;
  renamingPath: string | null;
  /** The drop target during a drag, or the row a context menu is open on. */
  outlinedPath: string | null;
  nodes: readonly FileTreeNode[];
  onActivate: (node: FileTreeNode, event: React.MouseEvent) => void;
  onFocusIndex: (index: number) => void;
  onKeyDown: (index: number, event: React.KeyboardEvent) => void;
  /** Ends a rename; a path hands keyboard focus back to that row. */
  onRenameDone: (focusPath: string | null) => void;
  dragProps: (node: FileTreeNode) => React.HTMLAttributes<HTMLDivElement>;
}

function findRow(tree: HTMLElement | null, path: string): HTMLElement | undefined {
  return [...(tree?.querySelectorAll<HTMLElement>('[data-tree-path]') ?? [])].find(
    (row) => row.dataset.treePath === path
  );
}

/** Moving onto the current parent, onto itself or into its own subtree does nothing. */
function isNoopMove(source: string, destination: string): boolean {
  return (
    !source ||
    parentFsPath(source) === destination ||
    isFsPathAtOrBelow(source, destination)
  );
}

async function moveInto(source: string, destination: string): Promise<void> {
  if (isNoopMove(source, destination)) return;
  const result = await window.diskAPI.move(source, destination);
  if (!result.success) {
    toast.error(result.error);
    return;
  }
  pathMutationCoordinator.applyAppMutation({
    kind: 'move',
    oldPath: source,
    newPath: result.data.path,
  });
}

/**
 * Renames in place. Markdown rows edit the label and keep the hidden `.md`;
 * other files preselect the name before the extension, as Finder does.
 */
function RenameField({
  node,
  onDone,
}: {
  node: FileTreeNode;
  onDone: (focusPath: string | null) => void;
}) {
  // The file's own name, not a daily page's "10-30 Fri".
  const editable = fileTreeLabel(node.name, node.kind);
  const [value, setValue] = React.useState(editable);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const settled = React.useRef(false);
  const suffix = node.name.slice(editable.length);

  React.useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const dot = node.isDirectory || suffix ? -1 : editable.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : editable.length);
  }, [editable, node.isDirectory, suffix]);

  // A blur means focus already went somewhere else; only Enter and Escape
  // return it to the row.
  const finish = (focusPath: string | null) => {
    settled.current = true;
    onDone(focusPath);
  };

  const commit = async (fromBlur: boolean) => {
    if (settled.current) return;
    const name = `${value.trim()}${suffix}`;
    if (name === node.name) {
      finish(fromBlur ? null : node.path);
      return;
    }
    if (!isValidName(value)) {
      if (fromBlur) finish(null);
      else toast.error('A name cannot be empty or contain a slash.');
      return;
    }
    settled.current = true;
    const result = await window.diskAPI.rename(node.path, name);
    if (!result.success) {
      onDone(fromBlur ? null : node.path);
      toast.error(result.error);
      return;
    }
    onDone(fromBlur ? null : result.data.path);
    pathMutationCoordinator.applyAppMutation({
      kind: 'rename',
      oldPath: node.path,
      newPath: result.data.path,
    });
  };

  return (
    <input
      ref={inputRef}
      aria-label={`Rename ${node.label}`}
      data-testid="file-tree-rename"
      value={value}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => void commit(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          void commit(false);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(node.path);
        }
      }}
      className="h-6 min-w-0 flex-1 rounded-control bg-canvas px-1.5 text-ui text-foreground outline-none ring-1 ring-inset ring-foreground-tertiary"
    />
  );
}

function FileTreeRow({
  data,
  index,
  style,
}: ListChildComponentProps<FileTreeRowData>) {
  const node = data.nodes[index];
  const isActive = data.activePath === node.path;
  const isRenaming = data.renamingPath === node.path;

  return (
    <div style={style}>
      <div
        role="treeitem"
        aria-expanded={node.isDirectory ? node.isExpanded : undefined}
        aria-level={node.depth + 1}
        aria-posinset={node.positionInSet}
        aria-setsize={node.setSize}
        aria-selected={isActive}
        tabIndex={data.tabStopPath === node.path ? 0 : -1}
        title={node.label}
        data-tree-index={index}
        data-tree-path={node.path}
        data-testid={`disk-tree-item-${node.path}`}
        onClick={(event) => data.onActivate(node, event)}
        onAuxClick={(event) => {
          if (event.button === 1) data.onActivate(node, event);
        }}
        onFocus={() => data.onFocusIndex(index)}
        onKeyDown={(event) => data.onKeyDown(index, event)}
        {...(isRenaming ? {} : data.dragProps(node))}
        style={{ paddingLeft: `${node.depth * TREE_INDENT + 8}px` }}
        className={cn(
          'mx-2 flex h-row-compact cursor-default select-none items-center gap-2 rounded-row pr-2 text-ui text-foreground-secondary outline-none',
          'transition-hover hover:bg-surface-hover hover:text-foreground',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
          isActive && 'bg-surface-selected font-medium text-foreground',
          data.outlinedPath === node.path && 'ring-1 ring-inset ring-foreground-tertiary'
        )}
      >
        {node.isDirectory ? (
          <ChevronRight
            aria-hidden
            className={cn(
              'h-4 w-4 shrink-0 p-px text-icon transition-transform duration-quick ease-standard',
              node.isExpanded && 'rotate-90'
            )}
          />
        ) : (
          <span aria-hidden className="w-4 shrink-0" />
        )}
        {isRenaming ? (
          <RenameField node={node} onDone={data.onRenameDone} />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.label}</span>
        )}
      </div>
    </div>
  );
}

/** The menu target: a row, or the blank space below the rows (the lone root). */
type MenuTarget = { node: FileTreeNode | null; folder: string };

export function FileTree({ onNavigate }: FileTreeProps) {
  const roots = useDiskStore((state) => state.roots);
  const listings = useDiskStore((state) => state.listings);
  const expanded = useDiskStore((state) => state.expanded);
  const isLoading = useDiskStore((state) => state.loading.isLoading);
  const toggleExpanded = useDiskStore((state) => state.toggleExpanded);
  const revealPath = useDiskStore((state) => state.revealPath);
  const openedPath = useTabsStore(selectOpenedPath);
  const { navigateFiles } = useShell();
  const [viewportRef, viewport] = useElementSize<HTMLDivElement>();
  const treeRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<FixedSizeList<FileTreeRowData>>(null);
  const [keyboardPath, setKeyboardPath] = React.useState<string | null>(null);
  const [renamingPath, setRenamingPath] = React.useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = React.useState<string | null>(null);
  const [revealTarget, setRevealTarget] = React.useState<string | null>(null);
  const [menuTarget, setMenuTarget] = React.useState<MenuTarget | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [moving, setMoving] = React.useState<string | null>(null);
  const openedFromTree = React.useRef<string | null>(null);
  const typeAhead = React.useRef({ prefix: '', at: 0 });

  const nodes = React.useMemo(
    () => flattenFileTree({ expanded, listings, roots }),
    [expanded, listings, roots]
  );
  const loneRoot = roots.length === 1 ? roots[0] : null;
  const tabStopPath = React.useMemo(() => {
    const has = (path: string | null) =>
      path !== null && nodes.some((node) => node.path === path);
    if (has(keyboardPath)) return keyboardPath;
    if (has(openedPath)) return openedPath;
    return nodes[0]?.path ?? null;
  }, [keyboardPath, nodes, openedPath]);

  // A file opened anywhere but the tree (Daily, Recent, the palette, a tab)
  // gets its folders expanded and scrolls into view.
  React.useEffect(() => {
    const fromTree = openedFromTree.current === openedPath;
    openedFromTree.current = null;
    if (!openedPath || fromTree) return;
    setRevealTarget(openedPath);
    void revealPath(openedPath);
  }, [openedPath, revealPath, roots]);

  React.useEffect(() => {
    if (!revealTarget) return;
    const index = nodes.findIndex((node) => node.path === revealTarget);
    if (index === -1) return;
    listRef.current?.scrollToItem(index, 'smart');
    setRevealTarget(null);
  }, [nodes, revealTarget]);

  const openFile = React.useCallback(
    (path: string, inNewTab: boolean) => {
      openedFromTree.current = path;
      recordOpened(path);
      navigateFiles(focusFile(path), { newTab: inNewTab });
      onNavigate?.();
    },
    [navigateFiles, onNavigate]
  );

  const activate = React.useCallback(
    (node: FileTreeNode, event: React.MouseEvent | React.KeyboardEvent) => {
      if (node.isDirectory) {
        void toggleExpanded(node.path);
        return;
      }
      const middleClick = 'button' in event && event.button === 1;
      openFile(node.path, event.metaKey || event.ctrlKey || middleClick);
    },
    [openFile, toggleExpanded]
  );

  const focusPath = React.useCallback((path: string) => {
    setKeyboardPath(path);
    window.requestAnimationFrame(() => findRow(treeRef.current, path)?.focus());
  }, []);

  const focusIndex = React.useCallback(
    (index: number) => {
      const node = nodes[index];
      if (!node) return;
      setKeyboardPath(node.path);
      listRef.current?.scrollToItem(index, 'smart');
      window.requestAnimationFrame(() => {
        treeRef.current
          ?.querySelector<HTMLElement>(`[data-tree-index="${index}"]`)
          ?.focus();
      });
    },
    [nodes]
  );

  const handleKeyDown = React.useCallback(
    (index: number, event: React.KeyboardEvent) => {
      const node = nodes[index];
      if (!node || event.target !== event.currentTarget) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          focusIndex(Math.min(nodes.length - 1, index + 1));
          return;
        case 'ArrowUp':
          event.preventDefault();
          focusIndex(Math.max(0, index - 1));
          return;
        case 'Home':
          event.preventDefault();
          focusIndex(0);
          return;
        case 'End':
          event.preventDefault();
          focusIndex(nodes.length - 1);
          return;
        case 'ArrowRight':
          if (!node.isDirectory) return;
          event.preventDefault();
          if (!node.isExpanded) void toggleExpanded(node.path);
          else if (nodes[index + 1]?.depth > node.depth) focusIndex(index + 1);
          return;
        case 'ArrowLeft': {
          event.preventDefault();
          if (node.isDirectory && node.isExpanded) {
            void toggleExpanded(node.path);
            return;
          }
          const parent = nodes.findIndex(
            (candidate) => candidate.path === node.parentPath
          );
          if (parent !== -1) focusIndex(parent);
          return;
        }
        case 'Enter':
          event.preventDefault();
          activate(node, event);
          return;
      }

      // Type-ahead: jump to the next row whose label starts with what was typed.
      if (
        event.key.length !== 1 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key === ' '
      )
        return;
      const now = Date.now();
      const state = typeAhead.current;
      state.prefix =
        now - state.at < TYPE_AHEAD_MS
          ? state.prefix + event.key.toLowerCase()
          : event.key.toLowerCase();
      state.at = now;
      const start = state.prefix.length === 1 ? index + 1 : index;
      for (let step = 0; step < nodes.length; step += 1) {
        const candidate = (start + step) % nodes.length;
        if (nodes[candidate].label.toLowerCase().startsWith(state.prefix)) {
          event.preventDefault();
          focusIndex(candidate);
          return;
        }
      }
    },
    [activate, focusIndex, nodes, toggleExpanded]
  );

  // Root rows (with several roots) take drops but do not move. Year rows
  // in the daily folder are not folders on disk, so they do neither.
  const dragProps = React.useCallback(
    (node: FileTreeNode): React.HTMLAttributes<HTMLDivElement> => {
      if (node.isYearGroup) return {};
      const drop: React.HTMLAttributes<HTMLDivElement> = {
        onDragOver: (event) => {
          if (!node.isDirectory) return;
          const source = getActiveDragSourcePath() ?? '';
          if (isNoopMove(source, node.path)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          setDropTargetPath(node.path);
        },
        onDragLeave: (event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null))
            return;
          setDropTargetPath((current) =>
            current === node.path ? null : current
          );
        },
        onDrop: (event) => {
          if (!node.isDirectory) return;
          event.preventDefault();
          event.stopPropagation();
          setDropTargetPath(null);
          const source = event.dataTransfer.getData('text/plain');
          clearActiveDragSourcePath();
          void moveInto(source, node.path);
        },
      };
      if (node.isRoot) return drop;
      return {
        ...drop,
        draggable: true,
        onDragStart: (event) => {
          setActiveDragSourcePath(node.path);
          event.dataTransfer.setData('text/plain', node.path);
          event.dataTransfer.effectAllowed = 'move';
        },
        onDragEnd: () => {
          setDropTargetPath(null);
          clearActiveDragSourcePath();
        },
      };
    },
    []
  );

  const itemData = React.useMemo<FileTreeRowData>(
    () => ({
      activePath: openedPath,
      tabStopPath,
      renamingPath,
      outlinedPath:
        dropTargetPath ?? (menuOpen ? menuTarget?.node?.path ?? null : null),
      nodes,
      onActivate: activate,
      onFocusIndex: (index) => setKeyboardPath(nodes[index]?.path ?? null),
      onKeyDown: handleKeyDown,
      onRenameDone: (path) => {
        setRenamingPath(null);
        if (path) focusPath(path);
      },
      dragProps,
    }),
    [
      activate,
      dragProps,
      dropTargetPath,
      focusPath,
      handleKeyDown,
      menuOpen,
      menuTarget,
      nodes,
      openedPath,
      renamingPath,
      tabStopPath,
    ]
  );

  // The blank space below the rows stands for the lone root: it takes drops
  // and offers the root's menu.
  const isOverRow = (event: React.SyntheticEvent) =>
    !!(event.target as HTMLElement).closest('[role="treeitem"]');
  const blankDragProps: React.HTMLAttributes<HTMLDivElement> = loneRoot
    ? {
        onDragOver: (event) => {
          if (isOverRow(event)) return;
          if (isNoopMove(getActiveDragSourcePath() ?? '', loneRoot)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        },
        onDrop: (event) => {
          if (isOverRow(event)) return;
          event.preventDefault();
          const source = event.dataTransfer.getData('text/plain');
          clearActiveDragSourcePath();
          void moveInto(source, loneRoot);
        },
      }
    : {};

  const handleContextMenu = (event: React.MouseEvent) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-tree-path]'
    );
    const node = nodes.find(
      (candidate) => candidate.path === row?.dataset.treePath
    );
    if (node?.isYearGroup) {
      // A year row offers its daily folder's menu, as blank space does a root's.
      setMenuTarget({ node: null, folder: parentFsPath(node.path) ?? node.path });
    } else if (node) {
      setMenuTarget({
        node,
        folder: node.isDirectory ? node.path : parentFsPath(node.path) ?? node.path,
      });
    } else if (loneRoot) {
      setMenuTarget({ node: null, folder: loneRoot });
    } else {
      // Several roots leave no folder for blank space to stand for.
      event.preventDefault();
    }
  };

  const createNote = async (folder: string) => {
    const result = await window.markdownAPI.create(folder);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    await useDiskStore.getState().loadDirectory(folder, { force: true });
    setRevealTarget(result.data.path);
    void revealPath(result.data.path);
    openFile(result.data.path, false);
  };

  const createFolder = (folder: string) => {
    const store = useDiskStore.getState();
    if (!isTreeExpanded(store.roots, store.expanded, folder))
      void store.toggleExpanded(folder);
    store.beginNewFolder(folder);
  };

  const reportFailure = (result: { success: boolean; error?: string }) => {
    if (!result.success) toast.error(result.error ?? 'Something went wrong.');
  };

  const menuNode = menuTarget?.node ?? null;
  const canMutate = menuNode !== null && !menuNode.isRoot;
  const menuPinned = usePinsStore((state) => isPinned(state.byRoot, menuNode?.path ?? null));
  // Radix runs onSelect while the menu still traps focus, so anything that
  // takes focus (the rename field, a dialog) starts once the menu has closed.
  const afterMenu = (action: () => void) => () => window.setTimeout(action, 0);

  return (
    <div ref={viewportRef} className="h-full min-h-0">
      <ContextMenu onOpenChange={setMenuOpen}>
        <ContextMenuTrigger asChild onContextMenu={handleContextMenu}>
          <div
            ref={treeRef}
            role="tree"
            aria-label="Files"
            aria-busy={isLoading}
            className="h-full min-h-0"
            {...blankDragProps}
          >
            {nodes.length > 0 ? (
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
                {FileTreeRow}
              </FixedSizeList>
            ) : null}
          </div>
        </ContextMenuTrigger>
        {menuTarget ? (
          <ContextMenuContent
            data-testid="file-tree-menu"
            // Rename and the dialogs take focus themselves; returning it to the
            // row afterwards would blur them.
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {menuNode && !menuNode.isDirectory ? (
              <>
                <ContextMenuItem onSelect={() => openFile(menuNode.path, true)}>
                  Open in new tab
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => usePinsStore.getState().toggle(menuNode.path)}>
                  {menuPinned ? 'Unpin' : 'Pin'}
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            ) : null}
            <ContextMenuItem onSelect={() => void createNote(menuTarget.folder)}>
              New note
            </ContextMenuItem>
            <ContextMenuItem onSelect={afterMenu(() => createFolder(menuTarget.folder))}>
              New folder
            </ContextMenuItem>
            {canMutate ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={afterMenu(() => setRenamingPath(menuNode.path))}>
                  Rename
                </ContextMenuItem>
                <ContextMenuItem onSelect={afterMenu(() => setMoving(menuNode.path))}>
                  Move to…
                </ContextMenuItem>
              </>
            ) : null}
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                void window.diskAPI
                  .reveal(menuNode?.path ?? menuTarget.folder)
                  .then(reportFailure);
              }}
            >
              Reveal in Finder
            </ContextMenuItem>
            {menuNode ? (
              <ContextMenuItem
                onSelect={() => {
                  void navigator.clipboard?.writeText(menuNode.path);
                }}
              >
                Copy path
              </ContextMenuItem>
            ) : null}
            {canMutate ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  tone="destructive"
                  onSelect={afterMenu(() => {
                    // The confirmation hands focus back to this row when it closes.
                    findRow(treeRef.current, menuNode.path)?.focus();
                    useDiskStore.getState().beginDelete(menuNode.path);
                  })}
                >
                  Move to Trash
                  <Trash2 aria-hidden className="ml-auto h-3.5 w-3.5 text-icon" />
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuContent>
        ) : null}
      </ContextMenu>
      <FolderPickerDialog
        open={moving !== null}
        roots={roots}
        onOpenChange={(open) => {
          if (!open) setMoving(null);
        }}
        onChoose={(folder) => {
          if (moving) void moveInto(moving, folder);
        }}
      />
    </div>
  );
}

export type { FileTreeProps };
