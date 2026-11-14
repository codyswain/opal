import * as React from 'react';
import { File } from 'lucide-react';
import { toast } from 'sonner';
import { dailyFileDate, dailyTreeLabel, isDailyFolder } from '@/common/dailyTree';
import { classifyFile, fileTreeLabel } from '@/common/fileKind';
import { basenameFsPath, parentFsPath } from '@/common/fsPaths';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import {
  clearActiveDragSourcePath,
  draggedTreeFile,
} from '@/renderer/features/disk-explorer/components/dragMoveState';
import { vaultRelativePath } from '@/renderer/features/disk-explorer/components/tabLabels';
import { focusFile } from '@/renderer/features/disk-explorer/navigation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { pinRoot, usePinsStore } from '@/renderer/features/disk-explorer/store/pinsStore';
import {
  selectOpenedPath,
  useTabsStore,
} from '@/renderer/features/disk-explorer/store/tabsStore';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { useShell } from '../context/ShellContext';

/** Carries a pinned row while it is dragged to a new place in the list. */
export const PIN_DRAG_TYPE = 'application/x-opal-pin';

interface PinnedSectionProps {
  onNavigate?: () => void;
}

/** The name the tree gives a file: "10-30 Fri" for a daily page, Markdown without `.md` or `.mdo`. */
export function pinLabel(path: string, roots: readonly string[]): string {
  const name = basenameFsPath(path);
  const folder = parentFsPath(path);
  const date = folder && isDailyFolder(folder, roots) ? dailyFileDate(name) : null;
  return date ? dailyTreeLabel(date) : fileTreeLabel(name, classifyFile(name));
}

/**
 * The pinned files, under Daily and Recent: each opened folder's
 * `.opal/pins.json`, folders in the tree's order. Nothing shows while
 * nothing is pinned. Rows drag to reorder, and a file dragged from the tree
 * is pinned where it drops.
 */
export function PinnedSection({ onNavigate }: PinnedSectionProps) {
  const roots = useDiskStore((state) => state.roots);
  const byRoot = usePinsStore((state) => state.byRoot);
  const missing = usePinsStore((state) => state.missing);
  const openedPath = useTabsStore(selectOpenedPath);
  const { navigateFiles } = useShell();
  const listRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [dropIndex, setDropIndex] = React.useState<number | null>(null);
  const labelId = React.useId();

  // Each pin once, under the first folder whose list holds it. With one
  // opened folder inside another, both lists can name the same file.
  const rows = React.useMemo(() => {
    const seen = new Set<string>();
    const listed: { root: string; path: string }[] = [];
    for (const root of roots) {
      for (const path of byRoot[root] ?? []) {
        if (!seen.has(path)) listed.push({ root, path });
        seen.add(path);
      }
    }
    return listed;
  }, [byRoot, roots]);
  if (rows.length === 0) return null;

  /** The folder whose pins a dragged file is placed among. */
  const rootOf = (path: string) => rows.find((row) => row.path === path)?.root ?? pinRoot(byRoot, path);

  const open = (path: string, newTab: boolean) => {
    if (missing.includes(path)) {
      toast.error(`"${pinLabel(path, roots)}" is not in the vault.`);
      return;
    }
    recordOpened(path);
    navigateFiles(focusFile(path), { newTab });
    onNavigate?.();
  };

  const reveal = (path: string) => {
    void window.diskAPI.reveal(path).then((result) => {
      if (!result.success) toast.error(result.error);
    });
  };

  // Pins are kept per folder, so the drop line stays among the rows of the
  // dragged file's own folder, where the pin will land.
  const dropTarget = (event: React.DragEvent<HTMLElement>, path: string): number => {
    const root = rootOf(path);
    const start = rows.findIndex((row) => roots.indexOf(row.root) >= roots.indexOf(root ?? ''));
    const first = start === -1 ? rows.length : start;
    const last = first + rows.filter((row) => row.root === root).length;
    const shown = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-pin-path]') ?? [])];
    let index = shown.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    if (index === -1) index = shown.length;
    return Math.max(first, Math.min(index, last));
  };

  const onDragOver = (event: React.DragEvent<HTMLElement>) => {
    const path = dragging ?? draggedTreeFile();
    if (!path) return;
    event.preventDefault();
    // The tree allows only a move; dropping here pins the file and leaves it where it is.
    event.dataTransfer.dropEffect = 'move';
    setDropIndex(dropTarget(event, path));
  };

  const onDrop = (event: React.DragEvent<HTMLElement>) => {
    const path = dragging ?? draggedTreeFile();
    setDragging(null);
    setDropIndex(null);
    if (!path) return;
    const target = dropIndex ?? dropTarget(event, path);
    event.preventDefault();
    clearActiveDragSourcePath();
    // Its place is after the pins of its own folder that are above the drop line.
    const root = rootOf(path);
    const above = rows.slice(0, target).filter((row) => row.path !== path && row.root === root).length;
    usePinsStore.getState().pin(path, above);
  };

  return (
    <section
      aria-labelledby={labelId}
      data-testid="pinned-section"
      className="flex max-h-[40%] min-h-0 shrink-0 flex-col pt-sidebar-group"
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null);
      }}
      onDrop={onDrop}
    >
      <div id={labelId} className="flex min-h-sidebar-group-label shrink-0 items-center pb-0.5 pl-sidebar-label pr-4 text-label font-sidebar-group-label text-foreground-tertiary">
        Pinned
      </div>
      <div ref={listRef} className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-sidebar-inset">
        {rows.map(({ path }, index) => {
          const gone = missing.includes(path);
          return (
            <ContextMenu key={path}>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  draggable
                  title={vaultRelativePath(path, roots)}
                  aria-pressed={openedPath === path || undefined}
                  aria-disabled={gone || undefined}
                  data-pin-path={path}
                  data-testid={`pinned-${path}`}
                  onClick={(event) => open(path, event.metaKey || event.ctrlKey)}
                  onAuxClick={(event) => {
                    if (event.button === 1) open(path, true);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(PIN_DRAG_TYPE, path);
                    event.dataTransfer.effectAllowed = 'move';
                    setDragging(path);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropIndex(null);
                  }}
                  className={cn(
                    // shrink-0 keeps the row height once the list is long enough to scroll.
                    'relative flex h-row-compact w-full min-w-0 shrink-0 items-center gap-sidebar-icon-gap rounded-sidebar-row px-2',
                    'text-left text-ui text-sidebar-label outline-none',
                    'transition-hover hover:bg-surface-hover hover:text-foreground',
                    'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
                    openedPath === path && 'bg-sidebar-selected font-sidebar-active text-foreground',
                    gone && 'text-foreground-tertiary hover:text-foreground-tertiary',
                    dragging === path && 'opacity-50',
                    dropIndex === index &&
                      'before:absolute before:inset-x-2 before:-top-px before:h-0.5 before:rounded-full before:bg-foreground/40',
                    dropIndex === rows.length &&
                      index === rows.length - 1 &&
                      'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground/40'
                  )}
                >
                  <File aria-hidden className={cn('stroke-sidebar-icon h-sidebar-icon w-sidebar-icon shrink-0 text-sidebar-icon', gone && 'opacity-50')} />
                  <span className="min-w-0 flex-1 truncate">{pinLabel(path, roots)}</span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent data-testid="pinned-menu">
                <ContextMenuItem disabled={gone} onSelect={() => open(path, true)}>
                  Open in new tab
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => usePinsStore.getState().unpin(path)}>
                  Unpin
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem disabled={gone} onSelect={() => reveal(path)}>
                  Reveal in Finder
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    </section>
  );
}

export type { PinnedSectionProps };
