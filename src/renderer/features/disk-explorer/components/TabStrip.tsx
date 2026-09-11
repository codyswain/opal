import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { classifyFile } from '@/common/fileKind';
import { basenameFsPath, parentFsPath } from '@/common/fsPaths';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger,
  Menu, MenuContent, MenuItem, MenuTrigger,
} from '@/renderer/shared/ui';
import { useFilesNavigation } from '../navigation/FilesNavigationContext';
import { hasProblem, hasUnsavedChanges, useDocumentStatusStore } from '../store/documentStatusStore';
import { useTabsStore } from '../store/tabsStore';
import { FileKindIcon } from './fileKindIcon';

export const TAB_DRAG_TYPE = 'application/x-opal-tab';
/** Past this many tabs the strip offers a list of all of them, as browsers do. */
const OVERFLOW_MENU_AT = 8;

/**
 * The open-files strip above the focused file.
 *
 * Behaves like a browser or editor tab bar: hover reveals close, middle-click
 * closes, tabs drag to reorder, right-click offers bulk closing, an unsaved
 * file shows a dot instead of the close glyph, and the active tab is kept in
 * view. Selection and ordering live in the tabs store; bodies are rendered by
 * the focus surface, so this component never loads a file.
 */
export const TabStrip: React.FC = () => {
  const openPaths = useTabsStore((state) => state.openPaths);
  const activePath = useTabsStore((state) => state.activePath);
  const previewPath = useTabsStore((state) => state.previewPath);
  const statuses = useDocumentStatusStore((state) => state.statuses);
  const navigation = useFilesNavigation();
  const { openFile: activate, closeFile: close } = navigation;
  const strip = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  // Keep the active tab visible when it changes or a new one opens far right.
  useLayoutEffect(() => {
    if (!activePath || !strip.current) return;
    const element = strip.current.querySelector<HTMLElement>(`[data-tab-path="${CSS.escape(activePath)}"]`);
    element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activePath, openPaths.length]);

  useEffect(() => {
    const element = strip.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [openPaths.length]);

  /** After a bulk close the URL must follow the surviving active tab. */
  const syncAfterBulkClose = useCallback(() => {
    const next = useTabsStore.getState().activePath;
    if (!next) navigation.returnToFolder();
    else if (next !== activePath) activate(next);
  }, [activate, activePath, navigation]);

  const closeOthers = (path: string) => { useTabsStore.getState().closeOthers(path); syncAfterBulkClose(); };
  const closeToRight = (path: string) => { useTabsStore.getState().closeToRight(path); syncAfterBulkClose(); };
  const closeAll = () => { useTabsStore.getState().closeAll(); syncAfterBulkClose(); };

  const dropTarget = (event: React.DragEvent<HTMLElement>): number => {
    const tabs = strip.current ? [...strip.current.querySelectorAll<HTMLElement>('[data-tab-path]')] : [];
    for (const [index, tab] of tabs.entries()) {
      const box = tab.getBoundingClientRect();
      if (event.clientX < box.left + box.width / 2) return index;
    }
    return tabs.length;
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!dragging && !event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropIndex(dropTarget(event));
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const path = event.dataTransfer.getData(TAB_DRAG_TYPE) || dragging;
    const target = dropIndex ?? dropTarget(event);
    setDragging(null);
    setDropIndex(null);
    if (!path) return;
    event.preventDefault();
    const from = openPaths.indexOf(path);
    if (from === -1) return;
    const to = target > from ? target - 1 : target;
    if (to !== from) useTabsStore.getState().move(from, to);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, index: number, path: string) => {
    const focusTab = (at: number) => {
      const tabs = strip.current?.querySelectorAll<HTMLElement>('[role="tab"]');
      const target = tabs?.[(at + openPaths.length) % openPaths.length];
      target?.focus();
    };
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault(); activate(path); break;
      case 'ArrowRight':
        event.preventDefault(); focusTab(index + 1); break;
      case 'ArrowLeft':
        event.preventDefault(); focusTab(index - 1); break;
      case 'Home':
        event.preventDefault(); focusTab(0); break;
      case 'End':
        event.preventDefault(); focusTab(openPaths.length - 1); break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault(); close(path); break;
      default:
    }
  };

  if (openPaths.length === 0) return null;

  return (
    <div className="flex shrink-0 items-stretch border-b border-border-subtle bg-surface" data-testid="tab-strip-shell">
      <div
        ref={strip}
        role="tablist"
        aria-label="Open files"
        data-testid="tab-strip"
        className="relative flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(event) => {
          // A mouse wheel scrolls the strip sideways, as in browsers.
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && strip.current) strip.current.scrollLeft += event.deltaY;
        }}
        onDragOver={onDragOver}
        onDragLeave={(event) => { if (!strip.current?.contains(event.relatedTarget as Node | null)) setDropIndex(null); }}
        onDrop={onDrop}
      >
        {openPaths.map((path, index) => {
          const isActive = path === activePath;
          const isPreview = path === previewPath;
          const name = basenameFsPath(path);
          const kind = classifyFile(name);
          const status = statuses[path];
          const unsaved = hasUnsavedChanges(status);
          const problem = hasProblem(status);
          const folder = parentFsPath(path);
          return (
            <ContextMenu key={path}>
              <ContextMenuTrigger asChild>
                <div
                  role="tab"
                  tabIndex={isActive ? 0 : -1}
                  aria-selected={isActive}
                  title={path}
                  data-testid={`tab-${path}`}
                  data-tab-path={path}
                  data-preview={isPreview || undefined}
                  data-unsaved={unsaved || undefined}
                  draggable
                  onClick={() => activate(path)}
                  onDoubleClick={() => { if (isPreview) useTabsStore.getState().pin(path); }}
                  onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close(path); } }}
                  onKeyDown={(event) => onKeyDown(event, index, path)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(TAB_DRAG_TYPE, path);
                    event.dataTransfer.effectAllowed = 'move';
                    setDragging(path);
                  }}
                  onDragEnd={() => { setDragging(null); setDropIndex(null); }}
                  className={[
                    'group relative flex h-9 min-w-[7rem] max-w-[13.5rem] flex-[0_1_13.5rem] cursor-default select-none items-center gap-2 pl-3 pr-1.5 text-xs',
                    'transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    isActive
                      ? 'bg-background text-foreground shadow-[inset_0_2px_0_0_hsl(var(--focus))]'
                      : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                    !isActive && index < openPaths.length - 1 && openPaths[index + 1] !== activePath ? 'after:absolute after:right-0 after:top-2 after:bottom-2 after:w-px after:bg-border-subtle' : '',
                    dragging === path ? 'opacity-50' : '',
                    dropIndex === index ? 'before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-focus' : '',
                    dropIndex === openPaths.length && index === openPaths.length - 1 ? 'before:absolute before:inset-y-1 before:right-0 before:w-0.5 before:bg-focus' : '',
                  ].join(' ')}
                >
                  <FileKindIcon kind={kind} />
                  <span data-testid={`tab-label-${path}`} className={`min-w-0 flex-1 truncate ${isPreview ? 'italic' : ''}`}>
                    {name}
                  </span>
                  <button
                    type="button"
                    aria-label={unsaved ? `Close ${name} (unsaved changes)` : `Close ${name}`}
                    data-testid={`tab-close-${path}`}
                    data-disk-shortcuts-ignore="true"
                    tabIndex={-1}
                    onClick={(event) => { event.stopPropagation(); close(path); }}
                    onDoubleClick={(event) => event.stopPropagation()}
                    className={[
                      'relative flex h-5 w-5 shrink-0 items-center justify-center rounded transition-opacity duration-100 hover:bg-surface-active',
                      isActive || unsaved || problem ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                    ].join(' ')}
                  >
                    {/* The dot yields to the close glyph on hover, as editors do. */}
                    {unsaved || problem ? (
                      <span
                        data-testid={`tab-dot-${path}`}
                        title={problem ? 'This file needs attention' : 'Unsaved changes'}
                        className={`h-2 w-2 rounded-full group-hover:hidden ${problem ? 'bg-amber-500' : 'bg-foreground'}`}
                      />
                    ) : null}
                    <X className={`h-3.5 w-3.5 ${unsaved || problem ? 'hidden group-hover:block' : ''}`} />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent data-testid={`tab-menu-${path}`}>
                <ContextMenuItem onSelect={() => close(path)}>Close<ContextMenuShortcut>⌘W</ContextMenuShortcut></ContextMenuItem>
                <ContextMenuItem disabled={openPaths.length < 2} onSelect={() => closeOthers(path)}>Close others</ContextMenuItem>
                <ContextMenuItem disabled={index === openPaths.length - 1} onSelect={() => closeToRight(path)}>Close to the right</ContextMenuItem>
                <ContextMenuItem onSelect={closeAll}>Close all</ContextMenuItem>
                <ContextMenuSeparator />
                {isPreview ? <ContextMenuItem onSelect={() => useTabsStore.getState().pin(path)}>Keep open</ContextMenuItem> : null}
                {folder ? <ContextMenuItem onSelect={() => navigation.navigateDirectory(folder)}>Show in folder</ContextMenuItem> : null}
                <ContextMenuItem onSelect={() => void window.diskAPI.reveal(path)}>Reveal in Finder</ContextMenuItem>
                <ContextMenuItem onSelect={() => void navigator.clipboard?.writeText(path)}>Copy path</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      {overflowing || openPaths.length >= OVERFLOW_MENU_AT ? (
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label={`All open files (${openPaths.length})`}
              data-testid="tab-overflow"
              className="flex w-8 shrink-0 items-center justify-center border-l border-border-subtle text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              <ChevronDown aria-hidden className="h-3.5 w-3.5" />
            </button>
          </MenuTrigger>
          <MenuContent align="end" className="max-h-80 overflow-auto">
            {openPaths.map((path) => {
              const name = basenameFsPath(path);
              return (
                <MenuItem key={path} onSelect={() => activate(path)} className={path === activePath ? 'font-medium text-foreground' : ''}>
                  <FileKindIcon kind={classifyFile(name)} />
                  <span className="ml-2 truncate">{name}</span>
                  {hasUnsavedChanges(statuses[path]) ? <span aria-label="Unsaved changes" className="ml-2 h-1.5 w-1.5 rounded-full bg-foreground" /> : null}
                </MenuItem>
              );
            })}
          </MenuContent>
        </Menu>
      ) : null}
    </div>
  );
};
