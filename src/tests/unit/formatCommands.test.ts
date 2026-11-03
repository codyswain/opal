import { describe, expect, it } from 'vitest';
import { undo } from '@codemirror/commands';
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import {
  clearFormatting,
  indentList,
  linkAt,
  removeLink,
  setHeading,
  toggleList,
  toggleMarker,
  writeLink,
} from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { formatState } from '@/renderer/features/disk-explorer/components/editor/formatState';

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/Plan.md';

/** A state from text where "‹" and "›" mark the selection, or one "‸" the caret. */
function stateOf(marked: string, path = DOC): EditorState {
  const caret = marked.indexOf('‸');
  const anchor = caret === -1 ? marked.indexOf('‹') : caret;
  const doc = marked.replace(/[‹›‸]/g, '');
  const head = caret === -1 ? marked.replace('‹', '').indexOf('›') : caret;
  return EditorState.create({ doc, selection: EditorSelection.single(anchor === -1 ? 0 : anchor, head === -1 ? 0 : head), extensions: markdownEditorExtensions(path) });
}

/** The text with the selection marked the same way. */
function marked(state: EditorState): string {
  const { from, to } = state.selection.main;
  const doc = state.doc.toString();
  return from === to ? `${doc.slice(0, from)}‸${doc.slice(from)}` : `${doc.slice(0, from)}‹${doc.slice(from, to)}›${doc.slice(to)}`;
}

function run(text: string, command: StateCommand, path = DOC): string {
  let state = stateOf(text, path);
  command({ state, dispatch: (tr) => { state = tr.state; } });
  return marked(state);
}

describe('bold, italic and strikethrough', () => {
  it('wraps the selected text and unwraps it again, keeping every other byte', () => {
    expect(run('a ‹bc› d', toggleMarker('**'))).toBe('a **‹bc›** d');
    expect(run('a **‹bc›** d', toggleMarker('**'))).toBe('a ‹bc› d');
    expect(run('a ‹bc› d', toggleMarker('*'))).toBe('a *‹bc›* d');
    expect(run('a ‹bc› d', toggleMarker('~~'))).toBe('a ~~‹bc›~~ d');
    expect(run('a ~~‹bc›~~ d', toggleMarker('~~'))).toBe('a ‹bc› d');
  });

  it('makes a partly bold selection all bold, joining the bold it touches', () => {
    expect(run('‹a **b**› c', toggleMarker('**'))).toBe('**‹a b›** c');
    expect(run('**ab**‹cd› e', toggleMarker('**'))).toBe('**ab‹cd›** e');
    expect(run('x ‹a **b** c **d** e› y', toggleMarker('**'))).toBe('x **‹a b c d e›** y');
    expect(run('**ab‹c**d›', toggleMarker('**'))).toBe('**ab‹cd›**');
  });

  it('takes bold off just the selected part of an all-bold selection, next to the text rather than a space', () => {
    expect(run('**a ‹b› c**', toggleMarker('**'))).toBe('**a** ‹b› **c**');
    expect(run('**‹a› b**', toggleMarker('**'))).toBe('‹a› **b**');
    expect(run('**a ‹b›**', toggleMarker('**'))).toBe('**a** ‹b›');
    expect(run('*a **‹b›** c*', toggleMarker('*'))).toBe('*a* **‹b›** *c*');
  });

  it('gives a note\'s caret an empty pair, while a document formats the caret\'s word or nothing', () => {
    expect(run('a ‸b', toggleMarker('**'), NOTE)).toBe('a **‸**b');
    expect(run('a **‸**b', toggleMarker('**'), NOTE)).toBe('a ‸b');
    expect(run('a ‸b', toggleMarker('**'))).toBe('a ‸b');
    expect(run('a b‸c d', toggleMarker('*'))).toBe('a *b‸c* d');
    expect(run('a **bo‸ld** b', toggleMarker('**'))).toBe('a bo‸ld b');
  });

  it('reads _ and __ as the marks they are, so Cmd+I on _x_ takes the italic off', () => {
    expect(run('‹_ab_›', toggleMarker('*'))).toBe('‹ab›');
    expect(run('‹__ab__›', toggleMarker('**'))).toBe('‹ab›');
    expect(run('‹a __b__›', toggleMarker('**'))).toBe('**‹a b›**');
  });

  it('keeps the formatting it adds outside a link the selection only partly covers', () => {
    expect(run('see [l‹ink](https://x.com) no›w', toggleMarker('**'))).toBe('see **[l‹ink](https://x.com) no›**w');
  });
});

describe('clear formatting', () => {
  it('removes bold, italic, strikethrough and code, and only marks the syntax tree reads as formatting', () => {
    expect(run('‹**a** *b* ~~c~~ `d` e›', clearFormatting)).toBe('‹a b c d e›');
    expect(run('‹snake_case and 5 * 3 and a_b_c›', clearFormatting)).toBe('‹snake_case and 5 * 3 and a_b_c›');
    expect(run('**a ‹b› c** and [link](https://x.com)', clearFormatting)).toBe('**a** ‹b› **c** and [link](https://x.com)');
    // Marks written at one place nest: the inner span closes first and the outer one opens first.
    expect(run('~~**a‹b›c**~~', clearFormatting)).toBe('~~**a**~~‹b›~~**c**~~');
    expect(run('*a **‹b›** c*', clearFormatting)).toBe('*a* ‹b› *c*');
  });

  it('unwraps code that holds Markdown characters in a note, and keeps it code in a document', () => {
    expect(run('‹x `a*b` y›', clearFormatting, NOTE)).toBe('‹x a*b y›');
    expect(run('‹x `a*b` y›', clearFormatting)).toBe('‹x `a*b` y›');
  });
});

describe('headings', () => {
  it('adds, changes and removes the "#" marks of the selected lines', () => {
    expect(run('Ti‸tle\nNext', setHeading(2))).toBe('## Ti‸tle\nNext');
    expect(run('## Ti‸tle', setHeading(4))).toBe('#### Ti‸tle');
    expect(run('## Ti‸tle ##', setHeading(0))).toBe('Ti‸tle');
    expect(run('- ## It‸em', setHeading(0))).toBe('- It‸em');
    expect(run('> Quo‸ted', setHeading(1))).toBe('> # Quo‸ted');
    expect(run('‹one\n\ntwo›', setHeading(3))).toBe('### ‹one\n\n### two›');
    expect(run('‸', setHeading(1))).toBe('# ‸');
  });
});

describe('lists', () => {
  it('makes lines a bulleted, numbered or check list, and plain again', () => {
    expect(run('‹a\nb›', toggleList('bullet'))).toBe('- ‹a\n- b›');
    expect(run('‹- a\n- b›', toggleList('bullet'))).toBe('‹a\nb›');
    expect(run('‹a\nb›', toggleList('number'))).toBe('1. ‹a\n2. b›');
    expect(run('‹- a\n- b›', toggleList('task'))).toBe('‹- [ ] a\n- [ ] b›');
    expect(run('> - a\n> - ‸b', toggleList('bullet'))).toBe('> - a\n>\n> ‸b');
    expect(run('- [ ] ‸a', toggleList('bullet'))).toBe('- ‸a');
    expect(run('- [x] ‸a', toggleList('task'))).toBe('‸a');
    expect(run('> ‸quoted', toggleList('bullet'))).toBe('> - ‸quoted');
  });

  it('carries the numbers on from the item above', () => {
    expect(run('1. x\n2. y\n‸z', toggleList('number'))).toBe('1. x\n2. y\n3. ‸z');
  });

  it('keeps a paragraph next to a list a paragraph with a blank line', () => {
    expect(run('‸a\nb', toggleList('bullet'))).toBe('- ‸a\n\nb');
    expect(run('- a\n- ‸b\n- c', toggleList('bullet'))).toBe('- a\n\n‸b\n\n- c');
  });

  it('indents and outdents list items one level, and leaves other lines alone', () => {
    expect(run('- a\n- ‸b', indentList(true))).toBe('- a\n  - ‸b');
    expect(run('- a\n  - ‸b', indentList(false))).toBe('- a\n- ‸b');
    expect(run('> - a\n> - ‸b', indentList(true))).toBe('> - a\n>   - ‸b');
    expect(run('Para‸graph', indentList(true))).toBe('Para‸graph');
  });
});

describe('links', () => {
  const apply = (text: string, url: string, linkText: string) => {
    let state = stateOf(text);
    const { main } = state.selection;
    state = state.update(writeLink(state, main, linkText, url, linkAt(state, main.from))).state;
    return marked(state);
  };

  it('writes a link over the selection, changes only the URL when the text stays, and removes one', () => {
    expect(apply('see ‹this› now', 'https://x.com', 'this')).toBe('see [this](https://x.com)‸ now');
    expect(apply('see [**th‸is**](https://old.com) now', 'https://new.com', '**this**')).toBe('see [**this**](https://new.com)‸ now');
    expect(apply('see [th‸is](https://old.com) now', 'https://x.com/a b', 'that')).toBe('see [that](<https://x.com/a b>)‸ now');
    expect(apply('see [[No‸tes]] now', 'Library/Notes', 'notes')).toBe('see [[Library/Notes|notes]]‸ now');
    // A wiki link keeps its heading, and a link left as it was is not rewritten.
    expect(linkAt(stateOf('see [[Plan#Budget|the bu‸dget]] now'), 22)).toMatchObject({ kind: 'wiki', target: 'Plan#Budget' });
    expect(apply('see [[Plan#Budget|the bu‸dget]] now', 'Plan#Budget', 'the budget')).toBe('see [[Plan#Budget|the budget]]‸ now');
    expect(apply('see [[Plan#Bu‸dget]] now', 'Plan#Budget', 'Plan#Budget')).toBe('see [[Plan#Budget]]‸ now');
    expect(apply('see [[Plan#Bu‸dget]] now', 'Plan#Costs', 'Plan#Costs')).toBe('see [[Plan#Costs]]‸ now');
    expect(apply('see https://x.c‸om now', 'https://x.com', 'https://x.com')).toBe('see https://x.com‸ now');
    const state = stateOf('see [th‸is](https://x.com) now');
    const link = linkAt(state, state.selection.main.head);
    expect(link).toMatchObject({ kind: 'link', target: 'https://x.com' });
    const removed = link && removeLink(state, link);
    expect(removed && state.update(removed).state.doc.toString()).toBe('see this now');
  });
});

describe('format state', () => {
  it('shows a style as on only when the whole selection has it, or the text before the caret does', () => {
    expect(formatState(stateOf('**a‸b** c')).bold).toBe(true);
    expect(formatState(stateOf('**ab** ‸c')).bold).toBe(false);
    expect(formatState(stateOf('‹**a** b›')).bold).toBe(false);
    expect(formatState(stateOf('‹**a *b***›')).bold).toBe(true);
    expect(formatState(stateOf('‹**a *b***›')).italic).toBe(false);
    expect(formatState(stateOf('~~‹x›~~')).strikethrough).toBe(true);
    expect(formatState(stateOf('see [th‸is](https://x.com)')).link).toBe(true);
  });

  it('reads the heading level and list kind of the selected lines, or null when they differ', () => {
    expect(formatState(stateOf('## T‸')).heading).toBe(2);
    expect(formatState(stateOf('‹# A\nB›')).heading).toBeNull();
    expect(formatState(stateOf('Pl‸ain')).heading).toBe(0);
    expect(formatState(stateOf('‹1. a\n2. b›'))).toMatchObject({ list: 'number', inList: true });
    expect(formatState(stateOf('‹- a\nb›'))).toMatchObject({ list: null, inList: true });
    expect(formatState(stateOf('- [ ] ‸a')).list).toBe('task');
  });

  it('knows whether there is something to undo or redo', () => {
    let state = stateOf('‹a›');
    expect(formatState(state)).toMatchObject({ canUndo: false, canRedo: false });
    toggleMarker('**')({ state, dispatch: (tr) => { state = tr.state; } });
    expect(formatState(state).canUndo).toBe(true);
    undo({ state, dispatch: (tr) => { state = tr.state; } });
    expect(formatState(state).canRedo).toBe(true);
  });
});
