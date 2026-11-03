import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { indentList } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { protectedRanges } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/Plan.md';

let views: EditorView[] = [];

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
});

/** A page with the caret at "‸", or a selection between two of them. */
function mount(marked: string, page = DOC) {
  const at = marked.indexOf('‸');
  const end = marked.indexOf('‸', at + 1);
  const doc = marked.replace(/‸/g, '');
  const selection = end === -1 ? { anchor: at } : { anchor: at, head: end - 1 };
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection, extensions: markdownEditorExtensions(page) }) });
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();

function press(view: EditorView, key: string, init: KeyboardEventInit = {}) {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...init }), 'editor');
}

/** Presses `key` on `marked` and gives back the page. */
function after(marked: string, key: string, init: KeyboardEventInit = {}, page = DOC): string {
  const view = mount(marked, page);
  press(view, key, init);
  return text(view);
}

describe('Tab and Shift+Tab in lists', () => {
  it('nests an item under the one above with a tab when the list indents with tabs', () => {
    expect(after('- a\n\t- b\n\t- c‸', 'Tab')).toBe('- a\n\t- b\n\t\t- c');
    expect(after('1. a\n\t1. b\n\t2. c‸', 'Tab')).toBe('1. a\n\t1. b\n\t\t1. c');
    // A top-level item next to tab-indented children takes a tab too.
    expect(after('- a\n\t- x\n- b‸', 'Tab')).toBe('- a\n\t- x\n\t- b');
  });

  it('nests to the parent\'s text column with spaces otherwise, numbering a new nested list from 1', () => {
    expect(after('- a\n- b‸', 'Tab')).toBe('- a\n  - b');
    expect(after('1. a\n2. b‸', 'Tab')).toBe('1. a\n   1. b');
    expect(after('- a\n  - b\n  - c‸', 'Tab')).toBe('- a\n  - b\n    - c');
    expect(after('- [ ] a\n- [ ] b‸', 'Tab')).toBe('- [ ] a\n  - [ ] b');
    // Joining a nested numbered list takes its next number.
    expect(after('1. a\n   1. x\n2. b‸', 'Tab')).toBe('1. a\n   1. x\n   2. b');
    // In a callout the indent goes after the quote marks.
    expect(after('> - a\n> - b‸', 'Tab')).toBe('> - a\n>   - b');
  });

  it('changes only the moved item\'s line, and nothing for a first item', () => {
    expect(after('- a\n- b‸\n  - child\n- c', 'Tab')).toBe('- a\n  - b\n  - child\n- c');
    expect(after('- a‸\n- b', 'Tab')).toBe('- a\n- b');
  });

  it('moves an item out a level with Shift+Tab, in the list\'s own characters', () => {
    expect(after('- a\n\t- b\n\t\t- c‸', 'Tab', { shiftKey: true })).toBe('- a\n\t- b\n\t- c');
    expect(after('1. a\n   1. b‸', 'Tab', { shiftKey: true })).toBe('1. a\n2. b');
    expect(after('- a‸', 'Tab', { shiftKey: true })).toBe('- a');
  });

  it('does nothing in a document\'s paragraph, even on two Tabs, while a note still indents', () => {
    const view = mount('Some text‸\n');
    press(view, 'Tab');
    press(view, 'Tab');
    expect(text(view)).toBe('Some text\n');
    expect(after('Some text‸\n', 'Tab', {}, NOTE)).not.toBe('Some text\n');
  });

  it('nests list items in a note too', () => {
    expect(after('- a\n\t- b\n\t- c‸', 'Tab', {}, NOTE)).toBe('- a\n\t- b\n\t\t- c');
  });

  it('indents only the list items of a selection from the toolbar', () => {
    const view = mount('- a\n- ‸b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n- c\n- d‸\n');
    indentList(true)(view);
    expect(text(view)).toBe('- a\n  - b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n- c\n  - d\n');
  });
});

describe('Enter in a document\'s numbered list', () => {
  it('changes only the caret\'s line and the new one in a 40-item list', () => {
    const items = Array.from({ length: 40 }, (_, index) => `${index + 1}. item ${index + 1}`);
    const doc = `${items[0]}‸\n${items.slice(1).join('\n')}\n`;
    const result = after(doc, 'Enter');
    expect(result).toBe(`${items[0]}\n2. \n${items.slice(1).join('\n')}\n`);
  });

  it('repeats the number in a list numbered 1., 1., 1.', () => {
    expect(after('1. a\n1. b‸\n1. c\n', 'Enter')).toBe('1. a\n1. b\n1. \n1. c\n');
    expect(after('1. a‸\n1. b\n', 'Enter')).toBe('1. a\n1. \n1. b\n');
  });

  it('leaves the items below an item with children alone', () => {
    expect(after('1. a‸\n\t1. x\n2. b\n', 'Enter')).toBe('1. a\n2. \n\t1. x\n2. b\n');
  });

  it('still renumbers in a note, which shows the written numbers', () => {
    expect(after('1. a‸\n2. b\n3. c\n', 'Enter', {}, NOTE)).toBe('1. a\n2. \n3. b\n4. c\n');
  });
});

describe('lists in a document', () => {
  const shown = (view: EditorView, selector: string) => [...view.contentDOM.querySelectorAll(selector)].map((element) => element.textContent);

  it('shows computed numbers from the list\'s start and keeps the bytes; a note shows them as written', () => {
    const view = mount('1. a\n1. b\n1. c\n‸');
    expect(shown(view, '.cm-md-number')).toEqual(['1.', '2.', '3.']);
    expect(text(view)).toBe('1. a\n1. b\n1. c\n');
    expect(shown(mount('3) a\n5) b\n‸'), '.cm-md-number')).toEqual(['3)', '4)']);
    expect(shown(mount('1. a\n1. b\n‸', NOTE), '.cm-md-number')).toEqual(['1.', '1.']);
  });

  it('takes the first item out of a numbered list on Backspace at its start, the next item taking its number', () => {
    expect(after('1. ‸a\n2. b\n3. c\n', 'Backspace')).toBe('a\n1. b\n3. c\n');
    const view = mount('1. ‸a\n2. b\n3. c\n');
    press(view, 'Backspace');
    expect(shown(view, '.cm-md-number')).toEqual(['1.', '2.']);
    // A list that would start past 1 under the text gets a blank line, so it stays a list.
    expect(after('5. ‸a\n6. b\n', 'Backspace')).toBe('a\n\n5. b\n');
  });

  it('draws no bullet for a lone "-" or "*" until a space follows', () => {
    expect(mount('-‸').contentDOM.querySelector('.cm-md-list-marker')).toBeNull();
    expect(mount('*‸').contentDOM.querySelector('.cm-md-list-marker')).toBeNull();
    expect(mount('- ‸').contentDOM.querySelector('.cm-md-bullet')).not.toBeNull();
  });

  it('shows a numbered task\'s number then its box, and goes on with both on Enter', () => {
    const view = mount('1. [ ] task‸\n');
    expect(view.contentDOM.querySelector('.cm-md-list-marker .cm-md-number')?.textContent).toBe('1.');
    expect(view.contentDOM.querySelector('.cm-md-list-marker .cm-md-task')).not.toBeNull();
    press(view, 'Enter');
    expect(text(view)).toBe('1. [ ] task\n2. [ ] \n');
    expect(view.state.selection.main.head).toBe(text(view).length - 1);
  });

  it('starts the next item on Enter at the end of an item\'s second paragraph', () => {
    expect(after('1. a\n\n   more‸\n2. b\n', 'Enter')).toBe('1. a\n\n   more\n2. \n2. b\n');
    expect(after('- a\n\n  more‸\n- b\n', 'Enter')).toBe('- a\n\n  more\n- \n- b\n');
  });

  it('checks and unchecks a task on Cmd+Enter', () => {
    const mod: KeyboardEventInit = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    const view = mount('- [ ] task‸\n');
    press(view, 'Enter', mod);
    expect(text(view)).toBe('- [x] task\n');
    press(view, 'Enter', mod);
    expect(text(view)).toBe('- [ ] task\n');
  });

  it('draws bullets by depth: a dot, a ring, a square, then a dot again', () => {
    const view = mount('- a\n  - b\n    - c\n      - d\n‸');
    expect([...view.contentDOM.querySelectorAll('.cm-md-list-marker')].map((marker) => (marker as HTMLElement).dataset.depth)).toEqual(['0', '1', '2', '0']);
  });
});

describe('Enter in code inside a list item or quote', () => {
  it('leaves a code line in a list item, and an empty code line in a quote, to the code', () => {
    // As the source of a code block shows after a double-click.
    expect(after('- item\n\n  ```\n  code‸\n  ```\n', 'Enter')).not.toContain('- \n');
    expect(after('> ```\n> one\n> ‸\n> ```\n', 'Enter')).toContain('> ```\n> one\n');
    expect(after('> ```\n> one\n> ‸\n> ```\n', 'Enter')).not.toBe('> ```\n> one\n\n\n> ```\n');
  });
});

describe('list keys next to inline objects and formatting', () => {
  it('nests and outdents an item that holds an inline protected range, such as a formula', () => {
    const formulas = protectedRanges.of((state, from, to) => [...state.sliceDoc(from, to).matchAll(/\$[^$\n]+\$/g)].map((match) => ({ from: from + (match.index ?? 0), to: from + (match.index ?? 0) + match[0].length })));
    const make = (doc: string) => {
      const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdownEditorExtensions(DOC), formulas] }) });
      views.push(view);
      return view;
    };
    const view = make('- a\n- b $x$');
    press(view, 'Tab');
    expect(text(view)).toBe('- a\n  - b $x$');
    press(view, 'Tab', { shiftKey: true });
    expect(text(view)).toBe('- a\n- b $x$');
  });

  it('starts the next item on Enter after a later paragraph that ends in formatting', () => {
    expect(after('- a\n\n  more *x*‸\n- b\n', 'Enter')).toBe('- a\n\n  more *x*\n- \n- b\n');
    expect(after('- a\n\n  more [x](y)‸\n- b\n', 'Enter')).toBe('- a\n\n  more [x](y)\n- \n- b\n');
  });
});
