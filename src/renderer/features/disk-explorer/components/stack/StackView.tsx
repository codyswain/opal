import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isFsPathAtOrBelow } from '@/common/fsPaths';
import { dailyDetail, dailyHeadDate, readOnlyRule } from '@/common/stackModel';
import { localDate } from '@/common/vaultModel';
import type { StackSection } from '@/types/stack';
import { recordOpened } from '../../activity/recordActivity';
import { aloneLocation, fileLocation, type FilesStackLocation } from '../../navigation/filesLocation';
import { useDiskStore } from '../../store/diskStore';
import { hasProblem, hasUnsavedChanges, useDocumentStatusStore } from '../../store/documentStatusStore';
import { usePagePropertiesStore } from '../../store/pagePropertiesStore';
import { sectionOpen, useStackFoldsStore, useStackStore, type StackMove } from '../../store/stackStore';
import { useTabsStore, type StackViewState, type TabEntry } from '../../store/tabsStore';
import { placeCaret, sectionKeys, type SectionEdge } from './stackKeys';
import { StackSectionView, type SectionActions } from './StackSectionView';
import { STACK_WINDOW, planStackWindow, sectionHeights, type SectionGeometry } from './stackWindow';
import './stack.css';

interface StackViewProps {
  tabId: string;
  /** The history entry the stack shows, where its place is saved. */
  index: number;
  location: FilesStackLocation;
}

/** The line, below the top of the view, whose section the right sidebar follows. */
export const PROBE_PX = 80;
/** How long the section at the probe line must hold before the sidebar follows it. */
const VIEWED_HOLD_MS = 150;
/** The list is read again this long after a change in one of its folders. */
const RELIST_AFTER_MS = 300;
/** A restored place is set again each frame until it holds for this many frames... */
const RESTORE_SETTLE_FRAMES = 3;
/** ...or this long has passed. */
const RESTORE_TIMEOUT_MS = 1500;
/** The place is saved on the tab this long after scrolling stops, so a relaunch finds it. */
const SAVE_AFTER_MS = 400;

const noteName = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');

/** The head as a section before the main process has answered, so it can render at once. */
function provisionalHead(location: FilesStackLocation): StackSection {
  const date = location.kind === 'daily' ? dailyHeadDate(location.file) : null;
  return {
    path: location.file,
    label: noteName(location.file),
    detail: date ? dailyDetail(date, localDate()) : null,
    role: 'head',
    defaultOpen: true,
    readOnly: readOnlyRule(location.file),
    textHeading: null,
    size: 0,
    mtimeMs: 0,
  };
}

const sameHeading = (a: StackSection['textHeading'], b: StackSection['textHeading']) =>
  a === b || (!!a && !!b && a.level === b.level && a.line === b.line);

const sameSection = (a: StackSection, b: StackSection) =>
  a.path === b.path && a.label === b.label && a.detail === b.detail && a.role === b.role &&
  a.defaultOpen === b.defaultOpen && a.readOnly === b.readOnly && sameHeading(a.textHeading, b.textHeading) &&
  a.size === b.size && a.mtimeMs === b.mtimeMs;

/** The new list, keeping each unchanged section's object so its row stays memoized. */
export function mergeSections(previous: readonly StackSection[], next: readonly StackSection[]): StackSection[] {
  const known = new Map(previous.map((section) => [section.path, section]));
  return next.map((section) => {
    const old = known.get(section.path);
    return old && sameSection(old, section) ? old : section;
  });
}

const wantsNewTab = (event: React.MouseEvent) => event.metaKey || event.ctrlKey || event.button === 1;

interface Restore {
  view: StackViewState;
  started: number;
  settled: number;
  /** The anchor's editor was asked to put the saved line at the top; the restore waits for it. */
  refined: boolean;
}

interface PendingCaret {
  path: string;
  edge: SectionEdge;
  column: number;
}

/**
 * Several Markdown files one after another in one scroll. Each section is
 * the file's own editor, which loads, saves and merges on its own; the stack
 * owns only the scroll. Sections near the view have a live editor and the
 * rest are placeholders of the height they last had, so a stream of a
 * hundred daily pages keeps at most twelve editors.
 */
export const StackView: React.FC<StackViewProps> = ({ tabId, index, location }) => {
  const head = location.file;
  const kind = location.kind;
  const roots = useDiskStore((state) => state.roots);
  const root = useMemo(
    () => [...roots].sort((a, b) => b.length - a.length).find((candidate) => isFsPathAtOrBelow(candidate, head)) ?? null,
    [roots, head],
  );
  const [sections, setSections] = useState<StackSection[]>(() => [provisionalHead(location)]);
  const [listed, setListed] = useState(false);
  const [loadedCount, setLoadedCount] = useState<number>(STACK_WINDOW.firstLoad);
  const [live, setLive] = useState<ReadonlySet<string>>(() => new Set([head]));
  const [propertiesPath, setPropertiesPath] = useState<string | null>(null);
  const folds = useStackFoldsStore((state) => state.folds);
  const statuses = useDocumentStatusStore((state) => state.statuses);
  const propertiesOpen = usePagePropertiesStore((state) => state.open);

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const articles = useRef(new Map<string, HTMLElement>());
  const views = useRef(new Map<string, EditorView>());
  const focused = useRef<string | null>(null);
  const reading = useRef(new Set<string>([head]));
  const farSince = useRef(new Map<string, number>());
  const anchor = useRef<(StackViewState & { top: number }) | null>(null);
  const restore = useRef<Restore | null>(null);
  const pendingCaret = useRef<PendingCaret | null>(null);
  const pendingProperties = useRef<string | null>(null);
  const fast = useRef(false);
  const lastScroll = useRef<{ top: number; at: number } | null>(null);
  const frame = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const entry = useRef<TabEntry | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const planRef = useRef<() => void>(() => undefined);
  // An empty head takes the caret when the stack first opens, unless the stack returns to a saved place.
  const autoFocusHead = useRef<boolean | null>(null);
  if (autoFocusHead.current === null) {
    const saved = useTabsStore.getState().tabs.find((tab) => tab.id === tabId)?.history[index]?.stack;
    autoFocusHead.current = !saved || (saved.anchor === head && saved.offset === 0);
  }
  const viewedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewedPending = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const farTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shown = useMemo(
    () => (kind === 'daily' ? sections.slice(0, loadedCount) : sections),
    [kind, sections, loadedCount],
  );
  // A recording not split yet, or a card that is not a thread, is the stack's only file and reads as a page.
  const lone = kind !== 'daily' && sections.length === 1;
  // Event handlers and the planner read the latest render through refs, so they never go stale.
  const latest = useRef({ sections, shown, live, folds, statuses, propertiesPath, propertiesOpen, listed, lone });
  latest.current = { sections, shown, live, folds, statuses, propertiesPath, propertiesOpen, listed, lone };

  const isOpen = useCallback(
    (section: StackSection) => latest.current.lone || sectionOpen(latest.current.folds, section.path, section.defaultOpen),
    [],
  );

  // --- Geometry -----------------------------------------------------------

  const topOf = (path: string): number | null => articles.current.get(path)?.offsetTop ?? null;

  /** The section at a line `y` px below the top of the content: the last one starting at or above it. */
  const sectionAt = useCallback((y: number): string | null => {
    let found: string | null = null;
    for (const section of latest.current.shown) {
      const top = topOf(section.path);
      if (top === null) continue;
      if (top > y) break;
      found = section.path;
    }
    return found ?? latest.current.shown[0]?.path ?? null;
  }, []);

  const currentView = useCallback((): StackViewState | null => {
    const element = scroller.current;
    if (!element) return null;
    const path = sectionAt(element.scrollTop);
    const top = path ? topOf(path) : null;
    if (!path || top === null) return null;
    return { anchor: path, offset: Math.max(0, element.scrollTop - top) };
  }, [sectionAt]);

  const isPinned = useCallback((path: string): boolean => {
    const { statuses: known, propertiesPath: target, propertiesOpen: open } = latest.current;
    const status = known[path];
    if (focused.current === path || hasUnsavedChanges(status) || hasProblem(status)) return true;
    if (open && target === path) return true;
    return !!articles.current.get(path)?.querySelector('.cm-search');
  }, []);

  // --- Planner --------------------------------------------------------------

  const later = useCallback((wait: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, wait);
    timers.current.add(timer);
    return timer;
  }, []);

  const plan = useCallback(() => {
    frame.current = 0;
    const element = scroller.current;
    if (!element) return;
    const state = latest.current;
    const geometry: SectionGeometry[] = state.shown.map((section) => {
      const article = articles.current.get(section.path);
      return {
        path: section.path,
        top: article?.offsetTop ?? 0,
        height: article?.offsetHeight ?? 0,
        folded: !isOpen(section),
        live: state.live.has(section.path),
        pinned: isPinned(section.path),
      };
    });
    const result = planStackWindow(
      {
        scrollTop: element.scrollTop,
        viewport: element.clientHeight,
        sections: geometry,
        total: kind === 'daily' && state.listed ? state.sections.length : state.shown.length,
      },
      { now: performance.now(), farSince: farSince.current, fast: fast.current, reading: reading.current.size },
    );
    farSince.current = result.farSince;
    let next: Set<string> | null = null;
    if (result.unmount.length > 0) {
      next = new Set(state.live);
      for (const path of result.unmount) {
        next.delete(path);
        reading.current.delete(path);
      }
    }
    // One new CodeMirror view per frame, nearest the view first.
    const mount = result.mount[0];
    if (mount) {
      next ??= new Set(state.live);
      next.add(mount);
      reading.current.add(mount);
    }
    if (next) setLive(next);
    if (result.loadMore && kind === 'daily') {
      setLoadedCount((count) => Math.min(state.sections.length, Math.max(count, state.shown.length) + STACK_WINDOW.loadStep));
    }
    if (result.farSince.size > 0 && !farTimer.current) {
      farTimer.current = later(STACK_WINDOW.unmountAfterMs + 50, () => {
        farTimer.current = null;
        schedule();
      });
    }
  }, [isOpen, isPinned, kind, later]);
  planRef.current = plan;

  /** Runs the planner in the next frame, once however often it is asked. */
  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = window.requestAnimationFrame(() => planRef.current());
  }, []);

  // --- Anchoring and restore -----------------------------------------------

  /**
   * The place to come back to: the section at the top of the view and the
   * offset into it, and, when the view starts inside the section's text, the
   * line there. A section's height is only known once CodeMirror has drawn
   * all of it, so the line is what makes a return exact.
   */
  const rememberAnchor = useCallback(() => {
    const view = currentView();
    const element = scroller.current;
    if (!view || !element) return;
    const held: StackViewState & { top: number } = { ...view, top: topOf(view.anchor) ?? 0 };
    const editor = views.current.get(view.anchor);
    if (editor && !reading.current.has(view.anchor)) {
      const into = element.getBoundingClientRect().top - editor.documentTop;
      if (into >= 0 && into < editor.contentHeight) {
        const block = editor.lineBlockAtHeight(into);
        held.line = { pos: block.from, into: into - block.top };
      }
    }
    anchor.current = held;
  }, [currentView]);

  /**
   * Sections above the anchor changed height, so its top moved: the scroll
   * moves by the same amount, before paint. Changes inside or below the
   * anchor leave the view where it is; CodeMirror anchors inside a section.
   */
  const keepAnchor = useCallback(() => {
    const element = scroller.current;
    const held = anchor.current;
    if (!element || !held || restore.current) return;
    const top = topOf(held.anchor);
    if (top === null) {
      rememberAnchor();
      return;
    }
    if (Math.abs(top - held.top) < 1) return;
    held.top = top;
    const want = top + held.offset;
    if (Math.abs(element.scrollTop - want) >= 1) element.scrollTop = want;
  }, [rememberAnchor]);

  const stopRestore = useCallback(() => {
    if (!restore.current) return;
    restore.current = null;
    rememberAnchor();
  }, [rememberAnchor]);

  const runRestore = useCallback(() => {
    const pending = restore.current;
    const element = scroller.current;
    if (!pending || !element) return;
    const state = latest.current;
    const waited = performance.now() - pending.started > RESTORE_TIMEOUT_MS;
    const at = state.sections.findIndex((section) => section.path === pending.view.anchor);
    if (state.listed && at === -1) {
      // The anchor's file is gone; the stack opens at the top.
      element.scrollTop = 0;
      stopRestore();
      return;
    }
    if (at !== -1 && kind === 'daily' && at + 3 >= state.shown.length) {
      setLoadedCount((count) => Math.max(count, at + 4));
    }
    const top = topOf(pending.view.anchor);
    const editor = views.current.get(pending.view.anchor);
    const line = pending.view.line;
    if (line && editor && !reading.current.has(pending.view.anchor)) {
      // The anchor's text is drawn: its editor puts the saved line at the top,
      // measured exactly, and again each frame while sections above it settle.
      const pos = Math.min(line.pos, editor.state.doc.length);
      const want = element.getBoundingClientRect().top - line.into;
      const drawn = editor.documentTop + editor.lineBlockAt(pos).top;
      if (!pending.refined || Math.abs(drawn - want) > 1) {
        editor.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: -line.into }) });
        pending.refined = true;
        pending.settled = 0;
      } else {
        pending.settled += 1;
      }
    } else if (top !== null) {
      const want = top + pending.view.offset;
      if (Math.abs(element.scrollTop - want) > 1) {
        element.scrollTop = want;
        pending.settled = 0;
      } else if (!line) {
        pending.settled += 1;
      }
    }
    if (waited || pending.settled >= RESTORE_SETTLE_FRAMES) {
      stopRestore();
      schedule();
      return;
    }
    window.requestAnimationFrame(runRestore);
  }, [kind, schedule, stopRestore]);

  // --- Saving the place on the tab -----------------------------------------

  // Reads the place remembered on each scroll, not the DOM, which may already be gone when the stack unmounts.
  const saveView = useCallback(() => {
    const held = anchor.current;
    const view = restore.current?.view ?? (held ? { anchor: held.anchor, offset: held.offset, ...(held.line ? { line: held.line } : {}) } : null);
    const known = entry.current;
    if (!view || !known) return;
    const tabs = useTabsStore.getState();
    const history = tabs.tabs.find((tab) => tab.id === tabId)?.history;
    if (!history) return;
    // Pruning an earlier entry moves this one left; a rename swaps it for a copy. Find it by identity, then by position.
    const found = history.indexOf(known);
    const at = found === -1 ? index : found;
    if (history[at]?.location.mode !== 'stack') return;
    tabs.saveView(tabId, at, { stack: view });
    entry.current = useTabsStore.getState().tabs.find((tab) => tab.id === tabId)?.history[at] ?? known;
  }, [index, tabId]);

  // --- The section the sidebar follows ---------------------------------------

  const publishViewed = useCallback(
    (immediately = false) => {
      const element = scroller.current;
      if (!element) return;
      const path = kind === 'daily' ? sectionAt(element.scrollTop + PROBE_PX) : head;
      if (!path) return;
      if (immediately) {
        viewedPending.current = path;
        useStackStore.getState().setViewed(tabId, path);
        return;
      }
      if (path === viewedPending.current) return;
      viewedPending.current = path;
      if (viewedTimer.current) clearTimeout(viewedTimer.current);
      // Held for a moment, so a fast fling does not ask for every day it passes.
      viewedTimer.current = setTimeout(() => {
        viewedTimer.current = null;
        useStackStore.getState().setViewed(tabId, path);
      }, VIEWED_HOLD_MS);
    },
    [head, kind, sectionAt, tabId],
  );

  // --- Mount and unmount ----------------------------------------------------

  useEffect(() => {
    const known = useTabsStore.getState().tabs.find((tab) => tab.id === tabId)?.history[index] ?? null;
    entry.current = known;
    if (known?.stack && !(known.stack.anchor === head && known.stack.offset === 0)) {
      restore.current = { view: known.stack, started: performance.now(), settled: 0, refined: false };
      window.requestAnimationFrame(runRestore);
    }
    publishViewed(true);
    const ownTimers = timers.current;
    return () => {
      window.cancelAnimationFrame(frame.current);
      frame.current = 0;
      for (const timer of ownTimers) clearTimeout(timer);
      ownTimers.clear();
      if (viewedTimer.current) clearTimeout(viewedTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (fastTimer.current) clearTimeout(fastTimer.current);
      saveView();
      useStackStore.getState().setViewed(tabId, null);
      useStackStore.getState().setLive(tabId, []);
    };
    // Once per stack: the component is keyed by tab, entry and location.
  }, []);

  // The list of sections comes from the main process, and again after its folders change.
  useEffect(() => {
    if (!root) {
      setListed(true);
      return;
    }
    let cancelled = false;
    let folders: string[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ask = async () => {
      let result: Awaited<ReturnType<typeof window.vaultAPI.stack>> | null = null;
      try {
        result = await window.vaultAPI.stack(root, kind, head);
      } catch {
        result = null;
      }
      if (cancelled) return;
      // Without an answer the head shows alone, as it would opened on its own.
      if (result?.success) {
        folders = result.data.folders;
        const next = result.data.sections;
        setSections((previous) => mergeSections(previous, next.length > 0 ? next : previous));
      }
      setListed(true);
    };
    void ask();
    const off = window.diskAPI.onChanged(({ directories }) => {
      if (!directories.some((directory) => folders.includes(directory))) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void ask(), RELIST_AFTER_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      off();
    };
  }, [root, kind, head]);

  useEffect(() => {
    useStackStore.getState().setLive(tabId, [...live]);
  }, [live, tabId]);

  // Every change that can move the window asks the planner again.
  useEffect(() => {
    schedule();
  }, [schedule, live, shown, folds, statuses, propertiesPath, propertiesOpen]);

  // Pressing Today on a stream already shown scrolls back to its top.
  useEffect(() => {
    let seen = useStackStore.getState().reveal?.seq ?? 0;
    return useStackStore.subscribe((state) => {
      const reveal = state.reveal;
      if (!reveal || reveal.seq === seen) return;
      seen = reveal.seq;
      if (reveal.head !== head || !scroller.current) return;
      restore.current = null;
      scroller.current.scrollTop = 0;
      rememberAnchor();
    });
  }, [head, rememberAnchor]);

  // The properties block shows on one section: the one whose footer was clicked, else the focused one, else the head.
  useEffect(() => {
    let wasOpen = usePagePropertiesStore.getState().open;
    if (wasOpen) setPropertiesPath(head);
    return usePagePropertiesStore.subscribe((state) => {
      if (state.open && !wasOpen) {
        const target = pendingProperties.current ?? focused.current ?? head;
        pendingProperties.current = null;
        setPropertiesPath(target);
        const element = scroller.current;
        const top = topOf(target);
        if (element && top !== null && (top < element.scrollTop || top > element.scrollTop + element.clientHeight - 120)) {
          element.scrollTop = top;
        }
      }
      wasOpen = state.open;
    });
  }, [head]);

  // --- Scroll, resize and input -------------------------------------------------

  useEffect(() => {
    const element = scroller.current;
    const inner = content.current;
    if (!element || !inner) return;
    const onScroll = () => {
      const now = performance.now();
      const previous = lastScroll.current;
      lastScroll.current = { top: element.scrollTop, at: now };
      if (previous && now > previous.at) {
        const speed = (Math.abs(element.scrollTop - previous.top) / (now - previous.at)) * 1000;
        if (speed > element.clientHeight * STACK_WINDOW.fastViewportsPerSecond) {
          fast.current = true;
          if (fastTimer.current) clearTimeout(fastTimer.current);
          fastTimer.current = setTimeout(() => {
            fastTimer.current = null;
            fast.current = false;
            schedule();
          }, STACK_WINDOW.settleAfterFastMs);
        }
      }
      if (!restore.current) rememberAnchor();
      publishViewed();
      schedule();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        saveView();
      }, SAVE_AFTER_MS);
    };
    // Reading or typing takes over from a restore still in progress.
    const stop = () => stopRestore();
    const resize = new ResizeObserver((entries) => {
      const width = element.clientWidth;
      const { live: mounted, sections: all } = latest.current;
      for (const observed of entries) {
        const path = (observed.target as HTMLElement).dataset.stackSection;
        if (!path || !mounted.has(path) || reading.current.has(path)) continue;
        const body = (observed.target as HTMLElement).querySelector<HTMLElement>(':scope > .opal-stack-body');
        const section = all.find((candidate) => candidate.path === path);
        if (body && section) sectionHeights.set(path, { height: body.offsetHeight, width, mtimeMs: section.mtimeMs, size: section.size });
      }
      keepAnchor();
      schedule();
    });
    resize.observe(element);
    resize.observe(inner);
    for (const article of articles.current.values()) resize.observe(article);
    observer.current = resize;
    element.addEventListener('scroll', onScroll, { passive: true });
    element.addEventListener('wheel', stop, { passive: true });
    element.addEventListener('pointerdown', stop);
    element.addEventListener('keydown', stop);
    return () => {
      observer.current = null;
      resize.disconnect();
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('wheel', stop);
      element.removeEventListener('pointerdown', stop);
      element.removeEventListener('keydown', stop);
    };
  }, [keepAnchor, publishViewed, rememberAnchor, saveView, schedule, stopRestore]);

  // --- Moving between sections ------------------------------------------------

  const focusSection = useCallback((path: string, edge: SectionEdge, column: number) => {
    const view = views.current.get(path);
    if (view) {
      placeCaret(view, edge, column);
      return;
    }
    // A placeholder mounts first and then takes the caret.
    pendingCaret.current = { path, edge, column };
    setLive((current) => (current.has(path) ? current : new Set(current).add(path)));
  }, []);

  const neighbour = useCallback(
    (path: string, direction: StackMove, unfoldedOnly: boolean): StackSection | null => {
      const list = latest.current.shown;
      const at = list.findIndex((section) => section.path === path);
      if (at === -1) return null;
      const step = direction === 'next' ? 1 : -1;
      for (let index = at + step; index >= 0 && index < list.length; index += step) {
        if (!unfoldedOnly || isOpen(list[index])) return list[index];
      }
      return null;
    },
    [isOpen],
  );

  /** Scrolls a section's header to the top of the view and unfolds it. */
  const revealSection = useCallback((path: string) => {
    const state = latest.current;
    const at = state.sections.findIndex((section) => section.path === path);
    if (at === -1) return;
    if (kind === 'daily' && at >= state.shown.length) setLoadedCount((count) => Math.max(count, at + 4));
    const section = state.sections[at];
    if (!sectionOpen(state.folds, path, section.defaultOpen)) useStackFoldsStore.getState().setOpen([path], true);
    // The section may only now be in the page, and the page may not yet be
    // tall enough to bring it to the top until its text is drawn. The restore
    // loop places it each frame until it holds, as on a return to a saved place.
    const running = restore.current !== null;
    restore.current = { view: { anchor: path, offset: 0 }, started: performance.now(), settled: 0, refined: false };
    if (!running) window.requestAnimationFrame(runRestore);
  }, [kind, runRestore]);

  // View > Next Section and Previous Section, which work while an editor has focus.
  useEffect(() => {
    const move = (direction: StackMove): boolean => {
      const element = scroller.current;
      if (!element) return false;
      const from = focused.current ?? sectionAt(element.scrollTop + PROBE_PX);
      const target = from ? neighbour(from, direction, false) : null;
      if (!target) return false;
      const top = topOf(target.path);
      if (top !== null) element.scrollTop = top;
      rememberAnchor();
      if (isOpen(target)) focusSection(target.path, 'first', 0);
      else articles.current.get(target.path)?.querySelector<HTMLButtonElement>('.opal-stack-label')?.focus();
      return true;
    };
    useStackStore.getState().setMove(move);
    return () => {
      if (useStackStore.getState().move === move) useStackStore.getState().setMove(null);
    };
  }, [focusSection, isOpen, neighbour, rememberAnchor, sectionAt]);

  // --- What sections ask of the stack ---------------------------------------------

  const cache = useRef({
    extensions: new Map<string, Extension>(),
    loaded: new Map<string, () => void>(),
    view: new Map<string, (view: EditorView | null) => void>(),
    properties: new Map<string, () => void>(),
    refs: new Map<string, (element: HTMLElement | null) => void>(),
  });

  const actions = useMemo<SectionActions>(() => {
    const memo = <T,>(map: Map<string, T>, path: string, make: () => T): T => {
      let value = map.get(path);
      if (!value) {
        value = make();
        map.set(path, value);
      }
      return value;
    };
    const toggleFold = (path: string, event: React.MouseEvent) => {
      const state = latest.current;
      const section = state.sections.find((candidate) => candidate.path === path);
      if (!section) return;
      const open = !sectionOpen(state.folds, path, section.defaultOpen);
      // Option-click folds or unfolds every section, as in Obsidian.
      const paths = event.altKey ? state.shown.map((candidate) => candidate.path) : [path];
      useStackFoldsStore.getState().setOpen(paths, open);
    };
    const openNote = (path: string) => {
      if (latest.current.sections.some((section) => section.path === path)) {
        revealSection(path);
        return;
      }
      recordOpened(path);
      useTabsStore.getState().open(fileLocation(path));
    };
    return {
      refFor: (path) =>
        memo(cache.current.refs, path, () => (element: HTMLElement | null) => {
          const known = articles.current.get(path);
          if (known === element) return;
          if (known) observer.current?.unobserve(known);
          if (element) {
            articles.current.set(path, element);
            observer.current?.observe(element);
          } else {
            articles.current.delete(path);
          }
        }),
      toggleFold,
      openAlone: (path, event) => {
        event.preventDefault();
        saveView();
        recordOpened(path);
        // `alone` stays only on a stack's head; any other section opens alone anyway.
        useTabsStore.getState().open(aloneLocation(path), { newTab: wantsNewTab(event) });
      },
      openNote,
      extensions: (path) =>
        memo(cache.current.extensions, path, () => [
          sectionKeys((direction, column) => {
            const target = neighbour(path, direction, true);
            if (!target) return false;
            focusSection(target.path, direction === 'next' ? 'first' : 'last', column);
            return true;
          }),
        ]),
      onLoadedFor: (path) =>
        memo(cache.current.loaded, path, () => () => {
          reading.current.delete(path);
          schedule();
        }),
      onViewFor: (path) =>
        memo(cache.current.view, path, () => (view: EditorView | null) => {
          if (!view) {
            views.current.delete(path);
            reading.current.delete(path);
            if (focused.current === path) focused.current = null;
            return;
          }
          views.current.set(path, view);
          if (latest.current.sections[0]?.path === path) autoFocusHead.current = false;
          const caret = pendingCaret.current;
          if (caret?.path === path) {
            pendingCaret.current = null;
            placeCaret(view, caret.edge, caret.column);
          }
        }),
      togglePropertiesFor: (path) =>
        memo(cache.current.properties, path, () => () => {
          const store = usePagePropertiesStore.getState();
          if (store.open && latest.current.propertiesPath === path) {
            store.setOpen(false);
            return;
          }
          if (store.open) {
            setPropertiesPath(path);
            return;
          }
          pendingProperties.current = path;
          store.setOpen(true);
        }),
    };
  }, [focusSection, neighbour, revealSection, saveView, schedule]);

  // Focus moves between sections without React; the planner reads it from a ref.
  const onFocus = (event: React.FocusEvent) => {
    const article = (event.target as HTMLElement).closest<HTMLElement>('[data-stack-section]');
    focused.current = article?.dataset.stackSection ?? null;
  };
  const onBlur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as HTMLElement | null;
    if (!next || !scroller.current?.contains(next)) focused.current = null;
    schedule();
  };

  const total = kind === 'daily' && !listed ? -1 : sections.length;
  const ended = listed && shown.length >= sections.length;
  const loadingMore = !listed || shown.length < sections.length;

  return (
    <div
      ref={scroller}
      data-testid="files-stack"
      data-stack-kind={kind}
      data-lone={lone ? '' : undefined}
      className="opal-stack h-full min-h-0 overflow-y-auto"
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div ref={content} role="feed" aria-busy={loadingMore} aria-label={kind === 'daily' ? 'Daily pages' : noteName(head)} className="opal-stack-content">
        {shown.map((section, position) => {
          const open = lone || sectionOpen(folds, section.path, section.defaultOpen);
          const isLive = open && live.has(section.path);
          return (
            <StackSectionView
              key={section.path}
              section={section}
              first={position === 0}
              large={kind === 'daily' || section.role === 'head'}
              lone={lone}
              open={open}
              live={isLive}
              height={sectionHeights.get(section.path, section.size)}
              status={isLive ? statuses[section.path] : undefined}
              autoFocusEmpty={section.role === 'head' && !!autoFocusHead.current}
              propertiesShown={propertiesOpen && propertiesPath === section.path}
              position={position + 1}
              setSize={total}
              actions={actions}
            />
          );
        })}
        {kind === 'daily' && ended ? <p className="opal-stack-end">No earlier pages</p> : null}
      </div>
    </div>
  );
};
