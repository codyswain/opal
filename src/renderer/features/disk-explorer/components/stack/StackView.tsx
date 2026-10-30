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

const RING: unknown[][] = []; (window as unknown as { __ring: unknown[][] }).__ring = RING;
const rec = (...v: unknown[]) => { RING.push([Math.round(performance.now()), ...v]); if (RING.length > 4000) RING.splice(0, 1000); };
const tail = (p: string | undefined) => (p ?? '').slice(-13, -3);
const lastH = new Map<string, number>();
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

/**
 * The new list, keeping each unchanged section's object so its row stays
 * memoized. A section the new list leaves out stays, after the section it
 * followed, while `keep` says so: one with the caret or unsaved text, such as
 * a past daily page just emptied, which the list no longer shows.
 */
export function mergeSections(
  previous: readonly StackSection[],
  next: readonly StackSection[],
  keep: (path: string) => boolean = () => false,
): StackSection[] {
  const known = new Map(previous.map((section) => [section.path, section]));
  const merged = next.map((section) => {
    const old = known.get(section.path);
    return old && sameSection(old, section) ? old : section;
  });
  const listed = new Set(next.map((section) => section.path));
  previous.forEach((section, at) => {
    if (listed.has(section.path) || !keep(section.path)) return;
    let after = -1;
    for (let before = at - 1; before >= 0 && after === -1; before -= 1) {
      after = merged.findIndex((candidate) => candidate.path === previous[before].path);
    }
    merged.splice(after + 1, 0, section);
  });
  return merged;
}

/** What the stack keeps still while sections change height. Each y is in px from the top of its content. */
interface EdgeHold {
  kind: 'edge';
  path: string;
  /** A section at one side of the view, when no line in it can hold: its top, or its end. */
  edge: 'top' | 'bottom';
  y: number;
}

interface LineHold {
  kind: 'line';
  path: string;
  /** A line starting in the view... */
  pos: number;
  /**
   * ...placed by CodeMirror's height estimate rather than its element: the
   * line CodeMirror itself keeps still, which may not be drawn yet.
   */
  estimated: boolean;
  /** ...and the tops of the section, its text and the line. */
  section: number;
  text: number;
  line: number;
}

type Hold = EdgeHold | LineHold;

/** Whether CodeMirror has drawn the line at `pos`; outside what it drew, a line's place is only an estimate. */
function isDrawn(view: EditorView, pos: number): boolean {
  const block = view.lineBlockAt(pos);
  return block.from >= view.viewport.from && block.to <= view.viewport.to;
}

/**
 * How many of the editor's drawn lines and blocks start above `y` in the
 * window. They are read from the page, not from CodeMirror's heights, which
 * stay estimates until it measures the lines it drew.
 */
function linesAbove(view: EditorView, y: number): number {
  const lines = view.contentDOM.children;
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (lines[middle].getBoundingClientRect().top < y) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** A drawn line, not a gap, which stands for lines CodeMirror has not drawn. */
const isLine = (element: Element, rect: DOMRect) => rect.height > 0 && !element.classList.contains('cm-gap');

/**
 * The first or last drawn line that starts between `top` and `bottom` in
 * the window. Null when no line of the section starts there.
 */
function lineStartingIn(view: EditorView, top: number, bottom: number, which: 'first' | 'last'): number | null {
  const lines = view.contentDOM.children;
  const step = which === 'first' ? 1 : -1;
  for (let at = which === 'first' ? linesAbove(view, top) : linesAbove(view, bottom) - 1; at >= 0 && at < lines.length; at += step) {
    const rect = lines[at].getBoundingClientRect();
    if (rect.top >= bottom || rect.top < top) return null;
    if (isLine(lines[at], rect)) return view.posAtDOM(lines[at], 0);
  }
  return null;
}

/** The drawn line across `y` in the window, or null over a gap or outside the text. */
function lineAcross(view: EditorView, y: number): number | null {
  const at = linesAbove(view, y + 1) - 1;
  const line = at >= 0 ? view.contentDOM.children[at] : undefined;
  const rect = line?.getBoundingClientRect();
  return line && rect && rect.bottom > y && isLine(line, rect) ? view.posAtDOM(line, 0) : null;
}

/**
 * The line CodeMirror keeps still itself while its editor has focus: the
 * one 8 px below the top of the view, or the first drawn line when that one
 * is not drawn and the first is within 200 px.
 */
function editorAnchorAt(view: EditorView, into: number): number {
  const block = view.lineBlockAtHeight(into + 8);
  if (block.from >= view.viewport.from) return block.from;
  const first = view.lineBlockAt(view.viewport.from);
  return first.top - into > 200 ? block.from : first.from;
}

/** Where a drawn line or block starts in the window, read from its element when there is one. */
function lineTopAt(view: EditorView, pos: number): number {
  const { node, offset } = view.domAtPos(pos, 1);
  const at = node === view.contentDOM ? view.contentDOM.childNodes[offset] : node;
  let element: Element | null = at?.nodeType === Node.ELEMENT_NODE ? (at as Element) : (at?.parentElement ?? null);
  while (element && element.parentElement !== view.contentDOM) element = element.parentElement;
  if (element) return element.getBoundingClientRect().top;
  return view.documentTop + view.lineBlockAt(pos).top;
}

const wantsNewTab = (event: React.MouseEvent) => event.metaKey || event.ctrlKey || event.button === 1;

interface Restore {
  view: StackViewState;
  /** When the wait began, or began again because more of the list arrived or loaded. */
  started: number;
  settled: number;
  /** How long the list and the part of it in the page were when the wait began. */
  sections: number;
  shown: number;
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
  const rootsLoaded = useDiskStore((state) => state.rootsLoaded);
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
  // The place to come back to, saved on the tab, and what to keep still while heights change.
  const place = useRef<StackViewState | null>(null);
  const hold = useRef<Hold | null>(null);
  const restore = useRef<Restore | null>(null);
  const pendingCaret = useRef<PendingCaret | null>(null);
  const pendingProperties = useRef<string | null>(null);
  const fast = useRef(false);
  const direction = useRef<'up' | 'down'>('down');
  // The strip at the top of the view that the reader's last scroll up brought in, in px; they have not seen it yet.
  const revealed = useRef(0);
  const lastScroll = useRef<{ top: number; at: number } | null>(null);
  // The scroll the stack set itself, so its scroll event is not read as reading.
  const ownScroll = useRef<number | null>(null);
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
  // The scroll whose strip is still unseen; a later one takes over its frames.
  const seenScroll = useRef(0);

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
      { now: performance.now(), farSince: farSince.current, fast: fast.current, direction: direction.current, reading: reading.current.size },
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
    if (next) rec('P', tail(mount), result.unmount.map(tail).join(','), fast.current ? 'fast' : '');
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

  /** Sets the scroll and remembers it, so its scroll event is not read as reading. */
  const scrollTo = useCallback((top: number) => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = top;
    ownScroll.current = element.scrollTop;
  }, []);

  /**
   * The place to come back to: the section at the top of the view and the
   * offset into it, and, when the view starts inside a drawn line of the
   * section's text, that line and how far into it. A section's height is
   * only known once CodeMirror has drawn all of it, so the line is what makes
   * a return exact. It is read from the page, as the hold is.
   */
  const rememberPlace = useCallback(() => {
    const view = currentView();
    const element = scroller.current;
    if (!view || !element) return;
    const editor = views.current.get(view.anchor);
    if (editor && !reading.current.has(view.anchor)) {
      const top = element.getBoundingClientRect().top;
      const pos = lineAcross(editor, top);
      if (pos !== null) view.line = { pos, into: top - lineTopAt(editor, pos) };
    }
    place.current = view;
  }, [currentView]);

  /**
   * Whether CodeMirror moves the scroll itself for lines that change height
   * above the one at the top of the view: it does while its editor has focus.
   */
  const editorKeepsLine = useCallback((path: string): boolean => views.current.get(path)?.hasFocus ?? false, []);

  /** The hold measured now, or null once its section, its editor or its drawn line is gone. */
  const measureHold = useCallback((held: Hold): Hold | null => {
    const article = articles.current.get(held.path);
    if (!article) return null;
    if (held.kind === 'edge') return { ...held, y: article.offsetTop + (held.edge === 'bottom' ? article.offsetHeight : 0) };
    const editor = views.current.get(held.path);
    if (!editor || reading.current.has(held.path)) return null;
    const pos = Math.min(held.pos, editor.state.doc.length);
    if (!held.estimated && !isDrawn(editor, pos)) return null;
    // From the window to the content, through the article, whose top the layout knows exactly.
    const origin = article.offsetTop - article.getBoundingClientRect().top;
    const text = origin + editor.documentTop;
    const line = held.estimated ? text + editor.lineBlockAt(pos).top : origin + lineTopAt(editor, pos);
    return { ...held, pos, section: article.offsetTop, text, line };
  }, []);

  /**
   * What to keep still while sections change height: the first thing that
   * starts in the part of the view the reader has seen, a drawn line or a
   * section's top, so only what lies above it moves the view. A change in
   * the view below it moves what follows, as on a page. Scrolling up, the
   * strip the scroll just brought in at the top is not seen yet. With nothing
   * starting there, as over a placeholder that fills the view, an edge of the
   * section there holds: its end when the next section starts in the view,
   * else the side the reader came from, never the end of one whose top is in
   * view. At the top of the stack nothing is above the view, so nothing
   * holds and a page opens at its top however its sections load. A section
   * at the top whose editor has focus holds the line CodeMirror keeps still
   * itself, so the two never both move the scroll.
   */
  const pickHold = useCallback((): Hold | null => {
    const element = scroller.current;
    if (!element || element.scrollTop < 1) return null;
    const bounds = element.getBoundingClientRect();
    const line = { kind: 'line', section: 0, text: 0, line: 0, estimated: false } as const;
    const atTop = sectionAt(element.scrollTop);
    const focusedEditor = atTop && editorKeepsLine(atTop) && !reading.current.has(atTop) ? views.current.get(atTop) : undefined;
    const into = focusedEditor ? bounds.top - focusedEditor.documentTop : -1;
    if (atTop && focusedEditor && into >= 0) {
      return measureHold({ ...line, path: atTop, pos: editorAnchorAt(focusedEditor, into), estimated: true });
    }
    const unseen = revealed.current < element.clientHeight ? revealed.current : 0;
    const seen = element.scrollTop + unseen;
    const path = sectionAt(seen);
    const article = path ? articles.current.get(path) : undefined;
    if (!path || !article) return null;
    if (article.offsetTop >= seen) return measureHold({ kind: 'edge', path, edge: 'top', y: 0 });
    const editor = views.current.get(path);
    if (editor && !reading.current.has(path)) {
      const pos = lineStartingIn(editor, bounds.top + unseen, bounds.bottom, 'first');
      if (pos !== null) return measureHold({ ...line, path, pos });
    }
    const endShown = article.offsetTop + article.offsetHeight <= element.scrollTop + element.clientHeight;
    const edge = endShown || direction.current === 'up' ? 'bottom' : 'top';
    return measureHold({ kind: 'edge', path, edge, y: 0 });
  }, [editorKeepsLine, measureHold, sectionAt]);

  /** Holds the top of a section the stack has just shown, while its text or its properties block draws. */
  const holdTop = useCallback((path: string) => {
    revealed.current = 0;
    hold.current = measureHold({ kind: 'edge', path, edge: 'top', y: 0 });
    rememberPlace();
  }, [measureHold, rememberPlace]);

  /** After the view moved: what to keep still from here, and the place to come back to. */
  const settle = useCallback(() => {
    hold.current = pickHold();
    rememberPlace();
    rec('S', hold.current?.kind, tail(hold.current?.path), hold.current?.kind === 'line' ? hold.current.pos : hold.current?.edge, Math.round(scroller.current?.scrollTop ?? -1), revealed.current);
  }, [pickHold, rememberPlace]);

  /**
   * Something above the hold changed height, so the hold moved: the scroll
   * moves by the same amount, before paint. It runs after each layout, and
   * on each scroll event first, so a change not reported yet is never taken
   * for where the reader went. An editor with focus keeps its own line
   * still, from its own measuring, so when the hold is that line only what
   * moved the editor's text is made up here.
   */
  const keepHold = useCallback(() => {
    const element = scroller.current;
    const held = hold.current;
    if (!element || restore.current) return;
    const now = held ? measureHold(held) : null;
    if (!held || !now) {
      hold.current = pickHold();
      return;
    }
    hold.current = now;
    let shift = 0;
    if (now.kind === 'edge' && held.kind === 'edge') shift = now.y - held.y;
    if (now.kind === 'line' && held.kind === 'line') {
      shift = now.line - held.line;
      // CodeMirror has already made up for its own lines, while the hold is its line and the editor still has focus.
      if (now.estimated && editorKeepsLine(now.path)) shift -= (now.line - now.text) - (held.line - held.text);
    }
    if (Math.abs(shift) >= 1) rec('K', Math.round(shift), now.kind, tail(now.path), now.kind === 'line' ? now.pos : now.edge, Math.round(element.scrollTop));
    if (Math.abs(shift) >= 1) scrollTo(element.scrollTop + shift);
  }, [editorKeepsLine, measureHold, pickHold, scrollTo]);

  const stopRestore = useCallback(() => {
    if (!restore.current) return;
    restore.current = null;
    revealed.current = 0;
    settle();
  }, [settle]);

  /**
   * Puts the saved place back, each frame until it holds. With a saved line
   * that is once the anchor's editor has drawn it at the top. The wait starts
   * again each time more of the list arrives or loads, and before the list
   * has come the anchor is only missing, not gone.
   */
  const runRestore = useCallback(() => {
    const pending = restore.current;
    const element = scroller.current;
    if (!pending || !element) return;
    const state = latest.current;
    const now = performance.now();
    if (state.sections.length !== pending.sections || state.shown.length !== pending.shown) {
      pending.sections = state.sections.length;
      pending.shown = state.shown.length;
      pending.started = now;
    }
    const at = state.sections.findIndex((section) => section.path === pending.view.anchor);
    if (at === -1) {
      if (state.listed) {
        // The anchor's file is gone; the stack opens at the top.
        scrollTo(0);
        stopRestore();
        return;
      }
      window.requestAnimationFrame(runRestore);
      return;
    }
    if (kind === 'daily' && at + 3 >= state.shown.length) {
      setLoadedCount((count) => Math.max(count, at + 4));
    }
    const waited = now - pending.started > RESTORE_TIMEOUT_MS;
    const top = topOf(pending.view.anchor);
    const editor = views.current.get(pending.view.anchor);
    // A folded anchor has no text to put the line of.
    const line = isOpen(state.sections[at]) ? pending.view.line : undefined;
    if (line && editor && !reading.current.has(pending.view.anchor)) {
      // The anchor's editor is live. Once it has drawn the saved line, the
      // scroll puts that line where it was, measured on the page, and again
      // each frame while sections above it settle. Until then its editor
      // scrolls the line into view, so that it draws it.
      const pos = Math.min(line.pos, editor.state.doc.length);
      const want = element.getBoundingClientRect().top - line.into;
      if (isDrawn(editor, pos)) {
        const shift = lineTopAt(editor, pos) - want;
        if (Math.abs(shift) > 1) {
          scrollTo(element.scrollTop + shift);
          pending.settled = 0;
        } else {
          pending.settled += 1;
        }
      } else {
        editor.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: -line.into }) });
        pending.settled = 0;
      }
    } else if (top !== null) {
      const want = top + pending.view.offset;
      if (Math.abs(element.scrollTop - want) > 1) {
        scrollTo(want);
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
  }, [isOpen, kind, schedule, scrollTo, stopRestore]);

  // --- Saving the place on the tab -----------------------------------------

  // The place remembered on each scroll, measured again while the stack is
  // in the page, since CodeMirror may have measured the lines it drew since
  // the last scroll. When the stack unmounts its page may already be gone.
  const saveView = useCallback(() => {
    if (!restore.current && scroller.current?.isConnected) rememberPlace();
    const view = restore.current?.view ?? place.current;
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
  }, [index, rememberPlace, tabId]);

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
      restore.current = { view: known.stack, started: performance.now(), settled: 0, sections: 0, shown: 0 };
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
      seenScroll.current += 1;
      saveView();
      useStackStore.getState().setViewed(tabId, null);
      useStackStore.getState().setLive(tabId, []);
    };
    // Once per stack: the component is keyed by tab, entry and location.
  }, []);

  // The list of sections comes from the main process, and again after its folders change.
  useEffect(() => {
    if (!root) {
      // Until the opened folders load the stack waits for them; with none holding the head, it shows alone.
      if (rootsLoaded) setListed(true);
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
        // A live section the planner keeps, with the caret or unsaved text, stays even when the list leaves it out.
        const keep = (path: string) => latest.current.live.has(path) && isPinned(path);
        setSections((previous) => mergeSections(previous, next.length > 0 ? next : previous, keep));
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
  }, [root, rootsLoaded, kind, head, isPinned]);

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
      revealed.current = 0;
      scrollTo(0);
      settle();
    });
  }, [head, scrollTo, settle]);

  // The properties block shows on one section: the one whose footer was clicked, else the focused one, else the head.
  // It opens at the top of the section's text, so the section's top comes into view and holds still while it draws.
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
        if (element && top !== null) {
          // Asking for the block takes over from a restore still in progress, as reading does.
          restore.current = null;
          if (top < element.scrollTop || top > element.scrollTop + element.clientHeight - 120) scrollTo(top);
          holdTop(target);
        }
      }
      wasOpen = state.open;
    });
  }, [head, holdTop, scrollTo]);

  // --- Scroll, resize and input -------------------------------------------------

  useEffect(() => {
    const element = scroller.current;
    const inner = content.current;
    if (!element || !inner) return;
    const onScroll = () => {
      const now = performance.now();
      const top = element.scrollTop;
      const own = ownScroll.current !== null && Math.abs(top - ownScroll.current) < 1;
      ownScroll.current = null;
      const previous = lastScroll.current;
      if (previous && !own && top !== previous.top) {
        direction.current = top < previous.top ? 'up' : 'down';
        // A scroll up brings in a strip at the top the reader has not seen yet. A scroll down shows nothing
        // new above, and a jump of a viewport or more shows a view all new, read from its top as on opening.
        const up = previous.top - top;
        revealed.current = up > 0 && up < element.clientHeight ? up : 0;
      }
      if (previous && !own && now > previous.at) {
        const speed = (Math.abs(top - previous.top) / (now - previous.at)) * 1000;
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
      rec('O', Math.round(top), own ? 'own' : '', revealed.current);
      if (!restore.current) {
        keepHold();
        // The stack's own scroll keeps what it holds; the reader's picks it again from the view it reached.
        if (own) rememberPlace();
        else settle();
      }
      // After any correction just made, so the next scroll measures only the reader's own.
      lastScroll.current = { top: element.scrollTop, at: now };
      publishViewed();
      schedule();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        saveView();
      }, SAVE_AFTER_MS);
      // The strip is seen two frames on, once CodeMirror has drawn it, and the
      // hold is the first line in the view again. Until then a change in the
      // strip moves the strip, not what the reader saw below it.
      if (!own) {
        const scroll = (seenScroll.current += 1);
        if (revealed.current > 0) {
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            if (seenScroll.current !== scroll || !scroller.current) return;
            revealed.current = 0;
            if (!restore.current) hold.current = pickHold();
            rec('E', hold.current?.kind, tail(hold.current?.path), hold.current?.kind === 'line' ? hold.current.pos : hold.current?.edge, Math.round(scroller.current?.scrollTop ?? -1));
          }));
        }
      }
    };
    // Reading or typing takes over from a restore still in progress.
    const stop = () => stopRestore();
    // For 100 ms after a wheel event over its text, CodeMirror moves the
    // scroll itself to keep its own line still, and only that editor's. The
    // stack keeps the view still for every section, so the event stops here,
    // before it reaches the editor, and the two never both correct it.
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest('.cm-content')) event.stopPropagation();
      stopRestore();
    };
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
      for (const observed of entries) { const path = (observed.target as HTMLElement).dataset.stackSection; if (!path) continue; const h = Math.round((observed.target as HTMLElement).offsetHeight); const was = lastH.get(path); lastH.set(path, h); if (was !== undefined && was !== h) rec('R', tail(path), h - was, Math.round((observed.target as HTMLElement).offsetTop - element.scrollTop), mounted.has(path) ? (reading.current.has(path) ? 'reading' : 'live') : 'ph'); }
      keepHold();
      schedule();
    });
    resize.observe(element);
    resize.observe(inner);
    for (const article of articles.current.values()) resize.observe(article);
    observer.current = resize;
    element.addEventListener('scroll', onScroll, { passive: true });
    element.addEventListener('wheel', onWheel, { passive: true, capture: true });
    element.addEventListener('pointerdown', stop);
    element.addEventListener('keydown', stop);
    return () => {
      observer.current = null;
      resize.disconnect();
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('wheel', onWheel, { capture: true });
      element.removeEventListener('pointerdown', stop);
      element.removeEventListener('keydown', stop);
    };
  }, [keepHold, pickHold, publishViewed, rememberPlace, saveView, schedule, settle, stopRestore]);

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
    restore.current = {
      view: { anchor: path, offset: 0 }, started: performance.now(), settled: 0,
      sections: state.sections.length, shown: state.shown.length,
    };
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
      revealed.current = 0;
      if (top !== null) scrollTo(top);
      settle();
      if (isOpen(target)) focusSection(target.path, 'first', 0);
      else articles.current.get(target.path)?.querySelector<HTMLButtonElement>('.opal-stack-label')?.focus();
      return true;
    };
    useStackStore.getState().setMove(move);
    return () => {
      if (useStackStore.getState().move === move) useStackStore.getState().setMove(null);
    };
  }, [focusSection, isOpen, neighbour, scrollTo, sectionAt, settle]);

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
          sectionKeys(
            (direction, column) => {
              const target = neighbour(path, direction, true);
              if (!target) return false;
              focusSection(target.path, direction === 'next' ? 'first' : 'last', column);
              return true;
            },
            (direction) => {
              useStackStore.getState().move?.(direction);
            },
          ),
          // The held line follows edits, so text added above it on another Mac keeps it in view.
          EditorView.updateListener.of((update) => {
            const held = hold.current;
            if (update.docChanged && held?.kind === 'line' && held.path === path) held.pos = update.changes.mapPos(held.pos, 1);
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
