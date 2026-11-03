import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type Command, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { docMode } from './livePreview';

/*
 * Callouts: a grey line icon per Obsidian type family, the type's own word
 * rewritten from a menu, and folding. "> [!tip]-" starts folded and
 * "> [!tip]+" open, with a chevron after the title that folds and opens it
 * without writing anything; a selection that lands in a folded callout,
 * such as a search match, opens it.
 */

/** Lucide's line icons (ISC), as SVG markup, so a widget draws them without React. */
const ICONS: Record<string, string> = {
  'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'clipboard-list': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'flame': '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'circle-help': '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'zap': '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  'bug': '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  'list': '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  'quote': '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  'bot': '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
};

/** The families of Obsidian's callout types, in the type menu's order, with the icon of each. */
export const CALLOUT_FAMILIES: readonly { type: string; label: string; icon: string; aliases: readonly string[] }[] = [
  { type: 'note', label: 'Note', icon: 'pencil', aliases: [] },
  { type: 'abstract', label: 'Abstract', icon: 'clipboard-list', aliases: ['summary', 'tldr'] },
  { type: 'info', label: 'Info', icon: 'info', aliases: [] },
  { type: 'todo', label: 'To do', icon: 'circle-check', aliases: [] },
  { type: 'tip', label: 'Tip', icon: 'flame', aliases: ['hint', 'important'] },
  { type: 'success', label: 'Success', icon: 'check', aliases: ['check', 'done'] },
  { type: 'question', label: 'Question', icon: 'circle-help', aliases: ['help', 'faq'] },
  { type: 'warning', label: 'Warning', icon: 'triangle-alert', aliases: ['caution', 'attention'] },
  { type: 'failure', label: 'Failure', icon: 'x', aliases: ['fail', 'missing'] },
  { type: 'danger', label: 'Danger', icon: 'zap', aliases: ['error'] },
  { type: 'bug', label: 'Bug', icon: 'bug', aliases: [] },
  { type: 'example', label: 'Example', icon: 'list', aliases: [] },
  { type: 'quote', label: 'Quote', icon: 'quote', aliases: ['cite'] },
  { type: 'ai', label: 'AI', icon: 'bot', aliases: [] },
];

/** The family a type word belongs to, in any case; an unknown word reads as a note, as in Obsidian. */
export function calloutFamily(type: string): (typeof CALLOUT_FAMILIES)[number] {
  const word = type.toLowerCase();
  return CALLOUT_FAMILIES.find((family) => family.type === word || family.aliases.includes(word)) ?? CALLOUT_FAMILIES[0];
}

function svg(name: string, size: number): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

/** The icon before a callout's title. In a document it is a button: a click on it opens the type menu. */
export class CalloutIconWidget extends WidgetType {
  constructor(readonly type: string, readonly menu = false) { super(); }

  eq(other: CalloutIconWidget) { return other.type === this.type && other.menu === this.menu; }

  toDOM() {
    const family = calloutFamily(this.type);
    const icon = document.createElement('span');
    icon.className = 'cm-md-callout-icon';
    icon.dataset.calloutIcon = family.type;
    icon.innerHTML = svg(family.icon, 16);
    if (this.menu) {
      icon.setAttribute('role', 'button');
      icon.setAttribute('aria-haspopup', 'menu');
      icon.setAttribute('aria-label', `Callout type, ${family.label}`);
    }
    return icon;
  }

  ignoreEvent() { return true; }
}

const CALLOUT_HEAD = /^((?:[ \t]*>[ \t]?)+)\[!([\w-]+)\]([+-]?)/;

interface Foldable {
  /** Where the callout's first line starts. */
  head: number;
  headEnd: number;
  /** Its body lines, from the second line's start to the last line's end. */
  from: number;
  to: number;
  /** Folded as written: "-". */
  folded: boolean;
}

/** The callouts with a fold sign, outermost quotes only. */
function foldables(state: EditorState): Foldable[] {
  const found: Foldable[] = [];
  const { doc } = state;
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== 'Blockquote') return !['Paragraph', 'Table', 'FencedCode', 'CodeBlock', 'HTMLBlock'].includes(ref.name);
      const head = doc.lineAt(ref.from);
      const match = CALLOUT_HEAD.exec(head.text);
      const end = ref.to > ref.from && doc.lineAt(ref.to).from === ref.to ? ref.to - 1 : ref.to;
      const last = doc.lineAt(end);
      if (match?.[3] && last.number > head.number) found.push({ head: head.from, headEnd: head.to, from: head.to + 1, to: last.to, folded: match[3] === '-' });
      return false;
    },
  });
  return found;
}

/** Folds or opens the callout whose first line starts at this position. */
export const toggleFold = StateEffect.define<number>();

interface Folds {
  /** First lines of the callouts the reader folded or opened against their sign. */
  flipped: readonly number[];
  decorations: DecorationSet;
  /** The callouts folded now. */
  folded: readonly Foldable[];
}

class ChevronWidget extends WidgetType {
  constructor(readonly head: number, readonly open: boolean) { super(); }

  eq(other: ChevronWidget) { return other.head === this.head && other.open === this.open; }

  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-md-callout-fold';
    button.dataset.open = String(this.open);
    button.setAttribute('aria-expanded', String(this.open));
    button.setAttribute('aria-label', this.open ? 'Fold callout' : 'Open callout');
    button.setAttribute('aria-keyshortcuts', 'Meta+Enter');
    button.innerHTML = svg('chevron-right', 14);
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({ effects: toggleFold.of(this.head) });
    });
    return button;
  }

  ignoreEvent() { return true; }
}

const foldedHead = Decoration.line({ class: 'cm-md-callout-folded' });
const hiddenBody = Decoration.replace({ block: true });

function drawFolds(state: EditorState, flipped: readonly number[]): Folds {
  const out: Range<Decoration>[] = [];
  const folded: Foldable[] = [];
  for (const callout of foldables(state)) {
    const isFolded = callout.folded !== flipped.includes(callout.head);
    out.push(Decoration.widget({ widget: new ChevronWidget(callout.head, !isFolded), side: 1 }).range(callout.headEnd));
    if (!isFolded) continue;
    folded.push(callout);
    out.push(foldedHead.range(callout.head), hiddenBody.range(callout.from, callout.to));
  }
  return { flipped, folded, decorations: Decoration.set(out, true) };
}

/** Callout folding: the reader's choices, mapped through edits, and what they hide. */
export const calloutFolds = StateField.define<Folds>({
  create: (state) => drawFolds(state, []),
  update(value, tr) {
    let flipped = tr.docChanged ? value.flipped.map((at) => tr.changes.mapPos(at)) : value.flipped;
    let changed = tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state);
    for (const effect of tr.effects) {
      if (!effect.is(toggleFold)) continue;
      flipped = flipped.includes(effect.value) ? flipped.filter((at) => at !== effect.value) : [...flipped, effect.value];
      changed = true;
    }
    // A selection that lands in a folded callout opens it.
    if (tr.selection) {
      const { head } = tr.state.selection.main;
      const hidden = value.folded.find((callout) => head > callout.headEnd && head <= tr.changes.mapPos(callout.to));
      if (hidden) {
        const at = tr.changes.mapPos(hidden.head);
        flipped = flipped.includes(at) ? flipped.filter((other) => other !== at) : [...flipped, at];
        changed = true;
      }
    }
    return changed ? drawFolds(tr.state, flipped) : value;
  },
  provide: (field) => EditorView.decorations.from(field, (folds) => folds.decorations),
});

/** The change that makes a callout of the type `type`, writing it in the case of the word it replaces. */
export function retypeCallout(state: EditorState, head: number, type: string): { from: number; to: number; insert: string } | null {
  const line = state.doc.lineAt(head);
  const match = CALLOUT_HEAD.exec(line.text);
  if (!match) return null;
  const word = match[2];
  const cased = word === word.toUpperCase() && /[A-Z]/.test(word) ? type.toUpperCase()
    : word[0] === word[0].toUpperCase() && /[A-Z]/.test(word[0]) ? type[0].toUpperCase() + type.slice(1) : type;
  const from = line.from + match[1].length + 2;
  return { from, to: from + word.length, insert: cased };
}

/** The first line of the callout holding `at`, or null. */
export function calloutHeadAt(state: EditorState, at: number): number | null {
  let outer: SyntaxNode | null = null;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 1); node; node = node.parent) if (node.name === 'Blockquote') outer = node;
  if (!outer) return null;
  const head = state.doc.lineAt(outer.from);
  return CALLOUT_HEAD.test(head.text) ? head.from : null;
}

/**
 * Cmd+Enter on a foldable callout's first line folds or opens it, as on a
 * toggle in Notion. Writes nothing. On a callout that cannot fold, and on
 * its body in a document, it does nothing rather than split the callout.
 */
const toggleFoldHere: Command = (view) => {
  const { state } = view;
  const { head } = state.selection.main;
  const line = state.doc.lineAt(head);
  const callout = foldables(state).find((each) => each.head === line.from);
  if (callout) {
    view.dispatch({ effects: toggleFold.of(callout.head) });
    return true;
  }
  const start = calloutHeadAt(state, head);
  return start !== null && state.facet(EditorView.editable) && CALLOUT_HEAD.test(state.doc.lineAt(start).text) && isDocument(state);
};

const isDocument = (state: EditorState) => state.facet(docMode);

/** The fold sign after "[!type]": none, "+" (open) or "-" (folded). */
export type FoldSign = '' | '+' | '-';

/** The fold sign of the callout starting at `head`. */
export function foldSignAt(state: EditorState, head: number): FoldSign {
  return (CALLOUT_HEAD.exec(state.doc.lineAt(head).text)?.[3] ?? '') as FoldSign;
}

/** The change that writes `sign` after the "[!type]" of the callout starting at `head`, and nothing else. */
export function refoldCallout(state: EditorState, head: number, sign: FoldSign): { from: number; to: number; insert: string } | null {
  const line = state.doc.lineAt(head);
  const match = CALLOUT_HEAD.exec(line.text);
  if (!match || match[3] === sign) return null;
  const from = line.from + match[0].length - match[3].length;
  return { from, to: from + match[3].length, insert: sign };
}

/** The DOM event that asks the type menu to open on the callout starting at `detail`. */
export const CALLOUT_MENU_EVENT = 'opal-callout-menu';

/** Option+F10 or ⌃⌥T on a callout's title line in a document: opens its type menu, as a click on its icon does. */
const openTypeMenu: Command = (view) => {
  const { state } = view;
  if (!isDocument(state)) return false;
  const line = state.doc.lineAt(state.selection.main.head);
  const head = calloutHeadAt(state, line.from + (/^[\s>]*/.exec(line.text)?.[0].length ?? 0));
  if (head !== line.from || !CALLOUT_HEAD.test(line.text)) return false;
  view.dom.dispatchEvent(new CustomEvent(CALLOUT_MENU_EVENT, { detail: head }));
  return true;
};

export const callouts: Extension = [calloutFolds, keymap.of([
  { key: 'Mod-Enter', run: toggleFoldHere },
  { key: 'Alt-F10', run: openTypeMenu },
  { key: 'Ctrl-Alt-t', run: openTypeMenu },
])];
