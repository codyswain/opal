import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, Plus, X } from 'lucide-react';
import { usePaletteStore } from '@/renderer/features/commands/store/paletteStore';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger,
  IconButton, Menu, MenuContent, MenuItem, MenuTrigger,
} from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { hasProblem, hasUnsavedChanges, useDocumentStatusStore } from '../store/documentStatusStore';
import { useDiskStore } from '../store/diskStore';
import { tabFile, tabLocation, useTabsStore, type Tab } from '../store/tabsStore';
import { locationPath } from '../navigation/filesLocation';
import { tabLabels } from './tabLabels';

export const TAB_DRAG_TYPE = 'application/x-opal-tab';
/** Past this many tabs the row offers a list of all of them, as browsers do. */
const OVERFLOW_MENU_AT = 8;

/** The file or folder a tab shows, which names it for tests; Recent is `recent`. */
function tabKey(tab: Tab): string {
  return locationPath(tabLocation(tab)) ?? 'recent';
}

const openNewTab = () => usePaletteStore.getState().show('', { newTab: true });

/**
 * The open tabs as compact pills in the top row, then New Tab.
 *
 * Behaves like Safari's and Obsidian's tab bar: a click switches tabs, hover
 * reveals close, middle-click closes, tabs drag to reorder, right-click offers
 * bulk closing, and an unsaved file shows a dot that yields to the close
 * glyph on hover. The active tab is kept in view. Pills are no-drag so the
 * space around them still moves the window.
 */
export const TabStrip: React.FC = () => {
  const tabs = useTabsStore((state) => state.tabs);
  const activeId = useTabsStore((state) => state.activeId);
  const roots = useDiskStore((state) => state.roots);
  const statuses = useDocumentStatusStore((state) => state.statuses);
  const strip = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const labels = useMemo(() => tabLabels(tabs.map(tabLocation), roots), [tabs, roots]);
  const { activate, close, closeAll, closeOthers, closeToRight, move } = useTabsStore.getState();

  const revealActive = useCallback(() => {
    if (!activeId || !strip.current) return;
    strip.current
      .querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  // Keep the active tab visible when it changes, a tab opens far right, or
  // the window narrows.
  useLayoutEffect(revealActive, [revealActive, tabs.length]);
  useEffect(() => {
    const element = strip.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      setOverflowing(element.scrollWidth > element.clientWidth + 1);
      revealActive();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tabs.length, revealActive]);

  const dropTarget = (event: React.DragEvent<HTMLElement>): number => {
    const pills = strip.current ? [...strip.current.querySelectorAll<HTMLElement>('[data-tab-id]')] : [];
    for (const [index, pill] of pills.entries()) {
      const box = pill.getBoundingClientRect();
      if (event.clientX < box.left + box.width / 2) return index;
    }
    return pills.length;
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!dragging && !event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropIndex(dropTarget(event));
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const id = event.dataTransfer.getData(TAB_DRAG_TYPE) || dragging;
    const target = dropIndex ?? dropTarget(event);
    setDragging(null);
    setDropIndex(null);
    if (!id) return;
    event.preventDefault();
    const from = tabs.findIndex((tab) => tab.id === id);
    if (from === -1) return;
    move(from, target > from ? target - 1 : target);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, index: number, tab: Tab) => {
    const focusTab = (at: number) => {
      const pills = strip.current?.querySelectorAll<HTMLElement>('[role="tab"]');
      pills?.[(at + tabs.length) % tabs.length]?.focus();
    };
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault(); activate(tab.id); break;
      case 'ArrowRight':
        event.preventDefault(); focusTab(index + 1); break;
      case 'ArrowLeft':
        event.preventDefault(); focusTab(index - 1); break;
      case 'Home':
        event.preventDefault(); focusTab(0); break;
      case 'End':
        event.preventDefault(); focusTab(tabs.length - 1); break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault(); close(tab.id); break;
      default:
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-1" data-testid="tab-strip-shell">
      {tabs.length > 0 ? (
        <div
          ref={strip}
          role="tablist"
          aria-label="Open tabs"
          data-testid="tab-strip"
          className="flex min-w-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onWheel={(event) => {
            // A mouse wheel scrolls the row sideways, as in browsers.
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && strip.current) strip.current.scrollLeft += event.deltaY;
          }}
          onDragOver={onDragOver}
          onDragLeave={(event) => { if (!strip.current?.contains(event.relatedTarget as Node | null)) setDropIndex(null); }}
          onDrop={onDrop}
        >
          {tabs.map((tab, index) => {
            const isActive = tab.id === activeId;
            const label = labels[index];
            const file = tabFile(tab);
            const status = file ? statuses[file] : undefined;
            const unsaved = hasUnsavedChanges(status);
            const problem = hasProblem(status);
            const key = tabKey(tab);
            return (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>
                  <div
                    role="tab"
                    tabIndex={isActive ? 0 : -1}
                    aria-selected={isActive}
                    title={label.title}
                    data-testid={`tab-${key}`}
                    data-tab-id={tab.id}
                    data-unsaved={unsaved || undefined}
                    draggable
                    onClick={() => activate(tab.id)}
                    onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close(tab.id); } }}
                    onKeyDown={(event) => onKeyDown(event, index, tab)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(TAB_DRAG_TYPE, tab.id);
                      event.dataTransfer.effectAllowed = 'move';
                      setDragging(tab.id);
                    }}
                    onDragEnd={() => { setDragging(null); setDropIndex(null); }}
                    className={cn(
                      'no-drag group relative flex h-control-compact min-w-24 max-w-[12.5rem] flex-[0_1_auto] cursor-default select-none items-center gap-1 rounded-control pl-2.5 pr-1 text-ui',
                      'outline-none transition-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/25',
                      isActive
                        ? 'bg-surface-lift font-medium text-foreground shadow-control'
                        : 'text-foreground-secondary hover:bg-surface-hover hover:text-foreground',
                      dragging === tab.id && 'opacity-50',
                      dropIndex === index && 'before:absolute before:inset-y-1 before:-left-0.5 before:w-0.5 before:rounded-full before:bg-foreground/40',
                      dropIndex === tabs.length && index === tabs.length - 1 && 'after:absolute after:inset-y-1 after:-right-0.5 after:w-0.5 after:rounded-full after:bg-foreground/40'
                    )}
                  >
                    <span data-testid={`tab-label-${key}`} className="min-w-0 flex-1 truncate">
                      {label.name}
                      {label.hint ? <span className="ml-1.5 font-normal text-foreground-tertiary">{label.hint}</span> : null}
                    </span>
                    <button
                      type="button"
                      aria-label={unsaved ? `Close ${label.name} (unsaved changes)` : `Close ${label.name}`}
                      data-testid={`tab-close-${key}`}
                      tabIndex={-1}
                      onClick={(event) => { event.stopPropagation(); close(tab.id); }}
                      className={cn(
                        'relative flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-icon transition-hover group-hover:duration-0 hover:bg-surface-active hover:text-foreground',
                        unsaved || problem ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
                      )}
                    >
                      {/* The mark yields to the close glyph on hover, as editors do. */}
                      {problem ? (
                        <AlertCircle
                          data-testid={`tab-dot-${key}`}
                          aria-label="This file needs attention"
                          className="h-3 w-3 text-foreground group-hover:hidden"
                        />
                      ) : unsaved ? (
                        <span
                          data-testid={`tab-dot-${key}`}
                          title="Unsaved changes"
                          className="h-1.5 w-1.5 rounded-full bg-foreground group-hover:hidden"
                        />
                      ) : null}
                      <X aria-hidden className={cn('h-3.5 w-3.5', (unsaved || problem) && 'hidden group-hover:block')} />
                    </button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent data-testid={`tab-menu-${key}`}>
                  <ContextMenuItem onSelect={() => close(tab.id)}>Close tab<ContextMenuShortcut>⌘W</ContextMenuShortcut></ContextMenuItem>
                  <ContextMenuItem disabled={tabs.length < 2} onSelect={() => closeOthers(tab.id)}>Close other tabs</ContextMenuItem>
                  <ContextMenuItem disabled={index === tabs.length - 1} onSelect={() => closeToRight(tab.id)}>Close tabs to the right</ContextMenuItem>
                  <ContextMenuItem onSelect={closeAll}>Close all tabs</ContextMenuItem>
                  {file ? (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => void window.diskAPI.reveal(file)}>Reveal in Finder</ContextMenuItem>
                      <ContextMenuItem onSelect={() => void navigator.clipboard?.writeText(file)}>Copy path</ContextMenuItem>
                    </>
                  ) : null}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      ) : null}
      <IconButton label="New tab" shortcut="⌘T" onClick={openNewTab}>
        <Plus aria-hidden className="h-4 w-4" />
      </IconButton>
      {overflowing || tabs.length >= OVERFLOW_MENU_AT ? (
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={`All tabs (${tabs.length})`} data-testid="tab-overflow">
              <ChevronDown aria-hidden className="h-3.5 w-3.5" />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="start" className="max-h-80 overflow-auto">
            {tabs.map((tab, index) => {
              const file = tabFile(tab);
              return (
                <MenuItem key={tab.id} onSelect={() => activate(tab.id)} className={tab.id === activeId ? 'font-medium text-foreground' : ''}>
                  <span className="truncate">{labels[index].name}</span>
                  {labels[index].hint ? <span className="ml-1.5 truncate text-foreground-tertiary">{labels[index].hint}</span> : null}
                  {file && hasUnsavedChanges(statuses[file]) ? <span aria-label="Unsaved changes" className="ml-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" /> : null}
                </MenuItem>
              );
            })}
          </MenuContent>
        </Menu>
      ) : null}
    </div>
  );
};
