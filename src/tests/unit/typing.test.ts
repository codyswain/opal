import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { toggleList, toggleMarker } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { formatState } from '@/renderer/features/disk-explorer/components/editor/formatState';
import { fitMarks, literalText } from '@/renderer/features/disk-explorer/components/editor/typing';
import { visibleLine, visibleSlice } from '@/renderer/features/disk-explorer/components/editor/visibleText';
import { pasteSpec } from '@/renderer/features/disk-explorer/components/editor/clipboard';
import { countWords, pageWords } from '@/renderer/features/disk-explorer/components/editor/wordMotion';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/Plan.md';

let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '', [NOTE]: '' });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

function mount(doc: string, page = DOC) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(page) }) });
  ensureSyntaxTree(view.state, view.state.doc.length, 5_000);
  view.dispatch({});
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();

/** Types each character as the browser does, at the caret. */
function type(view: EditorView, typed: string) {
  for (const character of typed) {
    act(() => {
      const at = view.state.selection.main.head;
      const insert = () => view.state.update({ changes: { from: at, insert: character }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
      if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, at, at, character, insert))) view.dispatch(insert());
    });
  }
}

function at(view: EditorView, anchor: number) {
  act(() => { view.dispatch({ selection: { anchor } }); });
}

/** Types one character over the selection, as the browser does. */
function typeOver(view: EditorView, character: string) {
  act(() => {
    const { from, to } = view.state.selection.main;
    const insert = () => view.state.update({ changes: { from, to, insert: character }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
    if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, character, insert))) view.dispatch(insert());
  });
}

const visible = (view: EditorView) => visibleLine(view.state, 0).text;

describe('typing in a document', () => {
  it('writes exactly the typed bytes inside inline code', () => {
    const view = mount('Use `xy` here\n');
    at(view, 6);
    type(view, '\\d+\\.');
    expect(text(view)).toBe('Use `x\\d+\\.y` here\n');
    // And the rest of the delimiters too.
    type(view, '*_~<!--');
    expect(text(view)).toBe('Use `x\\d+\\.*_~<!--y` here\n');
  });

  it('writes a closing star whose opener sits inside a word escaped: 2*3*4', () => {
    const view = mount('\n');
    at(view, 0);
    type(view, '2*3*4');
    expect(text(view)).toBe('2*3\\*4\n');
  });

  it('keeps bold and italic typed in this session as shortcuts', () => {
    const view = mount('see \n');
    at(view, 4);
    type(view, '**x**');
    expect(text(view)).toBe('see **x**\n');
    const italic = mount('see \n');
    at(italic, 4);
    type(italic, '*y*');
    expect(text(italic)).toBe('see *y*\n');
  });

  it('escapes a star that would close an old one, and a backtick before an old one', () => {
    const view = mount('*nix and \n');
    at(view, 9);
    type(view, 'C* pointers');
    expect(text(view)).toBe('*nix and C\\* pointers\n');
    const code = mount('a b` c\n');
    at(code, 2);
    type(code, '`');
    expect(text(code)).toBe('a \\`b` c\n');
  });

  it('doubles a backslash before punctuation: C:\\*.txt', () => {
    const view = mount('\n');
    at(view, 0);
    type(view, 'C:\\*.txt');
    expect(text(view)).toBe('C:\\\\*.txt\n');
  });

  it('escapes a backslash typed before punctuation that is already there', () => {
    const view = mount('a*b\n');
    at(view, 1);
    type(view, '\\');
    expect(text(view)).toBe('a\\\\*b\n');
  });

  it('writes a number other than 1 at a line start escaped, unless it continues an ordered list', () => {
    const view = mount('A paragraph\n');
    at(view, 11);
    act(() => { view.dispatch({ changes: { from: 11, insert: '\n' }, selection: { anchor: 12 } }); });
    type(view, '1984. A great year');
    expect(text(view)).toBe('A paragraph\n1984\\. A great year\n');
    const after = mount('Intro\n\n');
    at(after, 7);
    type(after, '3. x');
    expect(text(after)).toBe('Intro\n\n3\\. x');
    const list = mount('1. a\n2. b\n');
    at(list, 9);
    act(() => { list.dispatch({ changes: { from: 9, insert: '\n' }, selection: { anchor: 10 } }); });
    type(list, '3. c');
    expect(text(list)).toBe('1. a\n2. b\n3. c\n');
    const one = mount('\n');
    at(one, 0);
    type(one, '1. go');
    expect(text(one)).toBe('1. go\n');
    const paren = mount('\n');
    at(paren, 0);
    type(paren, '1) go');
    expect(text(paren)).toBe('1) go\n');
    const two = mount('Intro\n\n');
    at(two, 7);
    type(two, '2) x');
    expect(text(two)).toBe('Intro\n\n2\\) x');
  });

  it('keeps a bullet, task, quote or heading typed at a line start, and escapes a mark typed before text', () => {
    for (const typed of ['* x', '- [ ] task', '> quote', '## Head']) {
      const view = mount('\n');
      at(view, 0);
      type(view, typed);
      expect(text(view)).toBe(`${typed}\n`);
    }
    const before = mount('  raw text\n');
    at(before, 0);
    type(before, '*');
    expect(text(before)).toBe('\\*  raw text\n');
    const quote = mount('hello\n');
    at(quote, 0);
    type(quote, '>');
    expect(text(quote)).toBe('\\>hello\n');
  });

  it('escapes <!-- so the rest of the page stays text', () => {
    const view = mount('\nmore\n');
    at(view, 0);
    type(view, '<!--');
    expect(text(view)).toBe('\\<!--\nmore\n');
  });

  it('puts a blank line above --- or === typed under a paragraph', () => {
    const view = mount('abc\n');
    at(view, 3);
    act(() => { view.dispatch({ changes: { from: 3, insert: '\n' }, selection: { anchor: 4 } }); });
    type(view, '---');
    expect(text(view)).toBe('abc\n\n---\n');
    const equals = mount('abc\n');
    at(equals, 3);
    act(() => { equals.dispatch({ changes: { from: 3, insert: '\n' }, selection: { anchor: 4 } }); });
    type(equals, '===');
    expect(text(equals)).toBe('abc\n\n===\n');
  });

  it('starts a list on the empty line under a paragraph, and the typed item sits right under it', () => {
    for (const [kind, marker] of [['bullet', '- '], ['number', '1. '], ['task', '- [ ] ']] as const) {
      const view = mount('Plan the week\n', '/Vault/Library/daily/2026-11-04.mdo');
      at(view, text(view).length);
      act(() => { toggleList(kind)(view); });
      // The empty item draws as a list item, not as the paragraph's heading underline.
      expect(formatState(view.state).list).toBe(kind);
      type(view, 'First item');
      expect(text(view)).toBe(`Plan the week\n${marker}First item`);
    }
  });

  it('puts a letter that would unmake a mark on the mark\'s other side', () => {
    const view = mount('say — *"hi"* now\n');
    at(view, text(view).indexOf('*'));
    type(view, 'x');
    expect(text(view)).toBe('say — *x"hi"* now\n');
  });

  it('types wiki links, embeds, links and autolinks as written: no backslash before the last bracket', () => {
    for (const typed of ['[[Note]]', '![[img.png]]', 'see [text](https://x.com)', '<https://x.com>']) {
      const view = mount('\n');
      at(view, 0);
      type(view, typed);
      expect(text(view)).toBe(`${typed}\n`);
    }
  });

  it('closes an old star some other way when a backslash would land in a bare URL, and never moves typed letters', () => {
    const view = mount('\n');
    at(view, 0);
    type(view, 'a*b and https://x.com/c*d*e ok');
    expect(visible(view)).toBe('a*b and https://x.com/c*d*e ok');
  });

  it('leaves numbers with a decimal point at a line start as typed', () => {
    for (const typed of ['3.14 is pi', '2.5 hours', '10.5% growth', '11.03 meeting']) {
      const view = mount('\n');
      at(view, 0);
      type(view, typed);
      expect(text(view)).toBe(`${typed}\n`);
    }
  });

  it('takes the blank line out again when a line under a paragraph stops being a rule or underline', () => {
    const view = mount('Total\n');
    act(() => { view.dispatch({ changes: { from: 5, insert: '\n' }, selection: { anchor: 6 }, userEvent: 'input' }); });
    type(view, '= 5 + 3');
    expect(text(view)).toBe('Total\n= 5 + 3\n');
    const dashes = mount('Total\n');
    act(() => { dashes.dispatch({ changes: { from: 5, insert: '\n' }, selection: { anchor: 6 }, userEvent: 'input' }); });
    // Three dashes draw a rule, and text typed after a rule starts its own paragraph, so two stay text.
    type(dashes, '-- x');
    expect(text(dashes)).toBe('Total\n-- x\n');
  });

  it('writes <!-- as typed inside a wiki link or URL, where a backslash would show', () => {
    // An unaliased wiki link is one object in a document, so the typing goes in an alias.
    const view = mount('[[Robotics|Robotics]] and https://x.com/ab\n');
    at(view, 14);
    type(view, '<!--');
    const url = text(view).indexOf('ab') + 1;
    at(view, url);
    type(view, '<!--');
    expect(text(view)).toBe('[[Robotics|Rob<!--otics]] and https://x.com/a<!--b\n');
  });

  it('doubles a backslash typed before an HTML comment on its own line', () => {
    const view = mount('Before\n\n<!--SR:!2024-03-27,3,250-->\n');
    at(view, text(view).indexOf('<!--'));
    type(view, '\\');
    expect(visibleLine(view.state, text(view).indexOf('<!--')).text).toBe('\\<!--SR:!2024-03-27,3,250-->');
  });

  it('escapes a delimiter typed over a selection', () => {
    const view = mount('*nix c\n');
    act(() => { view.dispatch({ selection: { anchor: 4, head: 6 } }); });
    typeOver(view, '*');
    expect(visible(view)).toBe('*nix*');
  });

  it('leaves a note as typed', () => {
    const view = mount('\n', NOTE);
    at(view, 0);
    type(view, '2*3*4');
    expect(text(view)).toBe('2*3*4\n');
  });

  it('does nothing in an HTML block', () => {
    const view = mount('<div>\nx\n</div>\n');
    at(view, 7);
    type(view, ' *a* 2*3*4 <!--');
    expect(text(view)).toBe('<div>\nx *a* 2*3*4 <!--\n</div>\n');
  });
});

describe('bold, italic and strikethrough next to punctuation', () => {
  const state = (doc: string) => mount(doc).state;

  it('moves the marks inward past punctuation', () => {
    const s = state('file.txt\n');
    expect(fitMarks(s, 4, 8)).toEqual({ from: 5, to: 8 });
    const cjk = state('これは「太字」です\n');
    expect(fitMarks(cjk, 3, 7)).toEqual({ from: 4, to: 6 });
    const beta = state('Opal(beta)\n');
    expect(fitMarks(beta, 4, 10)).toEqual({ from: 5, to: 9 });
  });

  it('writes bold, italic and strikethrough that parse, never visible stars', () => {
    const cases: [string, string, string, string][] = [
      ['file.txt here', '.txt', '**', 'file.**txt** here'],
      ['これは「太字」です', '「太字」', '**', 'これは「**太字**」です'],
      ['Opal(beta) ships', '(beta)', '*', 'Opal(*beta*) ships'],
      ['a.b c', '.', '~~', '~~a.b~~ c'],
    ];
    for (const [doc, selected, marker, written] of cases) {
      const view = mount(`${doc}\n`);
      const from = doc.indexOf(selected);
      act(() => { view.dispatch({ selection: { anchor: from, head: from + selected.length } }); });
      act(() => { toggleMarker(marker)(view); });
      expect(text(view)).toBe(`${written}\n`);
    }
  });

  it('takes a style off without leaving a mark against punctuation', () => {
    const view = mount('it cites *every point it makes,* with\n');
    const from = text(view).indexOf('makes');
    act(() => { view.dispatch({ selection: { anchor: from, head: from + 5 } }); });
    act(() => { toggleMarker('*')(view); });
    expect(text(view)).toBe('it cites *every point it* makes, with\n');
  });

  it('widens to the word when moving inward leaves nothing', () => {
    expect(fitMarks(state('a.b\n'), 1, 2)).toEqual({ from: 0, to: 3 });
    expect(fitMarks(state('x ... y\n'), 2, 5)).toEqual({ from: 2, to: 5 });
  });
});

describe('literal text', () => {
  it('escapes only what would become Markdown in that spot', () => {
    const view = mount('Text \n');
    const s = view.state;
    expect(literalText(s, 5, 5, 'https://x.com/a_b*c')).toBe('https://x.com/a_b*c');
    expect(literalText(s, 5, 5, 'snake_case_name')).toBe('snake_case_name');
    expect(literalText(s, 5, 5, 'a | b')).toBe('a | b');
    expect(literalText(s, 5, 5, '*not italic*')).toBe('\\*not italic\\*');
    expect(literalText(s, 5, 5, '`code`')).toBe('\\`code\\`');
    expect(literalText(s, 5, 5, 'a | b', { table: true })).toBe('a \\| b');
  });

  it('goes in raw in inline code', () => {
    const view = mount('Use `x` here\n');
    expect(literalText(view.state, 5, 5, '*a* `b`')).toBe('*a* `b`');
  });
});

describe('Enter inside formatting in a document', () => {
  const enter = (view: EditorView) => act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor'); });

  it('closes bold, italic, code and a link before the break and opens them again after it', () => {
    const cases: [string, string, string][] = [
      ['**bold text** end', 'bold', '**bold**\n**text** end'],
      ['*it here*', 'it', '*it*\n*here*'],
      ['`co de`', 'co', '`co`\n`de`'],
      ['[link text](https://x.com) b', 'link', '[link](https://x.com)\n[text](https://x.com) b'],
      ['**a [bc](https://x.com) d**', 'a [b', '**a [b](https://x.com)**\n**[c](https://x.com) d**'],
    ];
    for (const [doc, before, written] of cases) {
      const view = mount(`${doc}\n`);
      at(view, doc.indexOf(before) + before.length);
      enter(view);
      expect(text(view)).toBe(`${written}\n`);
    }
  });

  it('makes two paragraphs, each still bold or linked, from Enter twice', () => {
    for (const [doc, before, written] of [
      ['**bold text**', 'bold', '**bold**\n\n**text**'],
      ['[link text](https://x.com)', 'link', '[link](https://x.com)\n\n[text](https://x.com)'],
    ]) {
      const view = mount(`${doc}\n`);
      at(view, doc.indexOf(before) + before.length);
      enter(view);
      enter(view);
      expect(text(view)).toBe(`${written}\n`);
    }
  });

  it('keeps a list item\'s marker on the new line', () => {
    const view = mount('- **bold text**\n');
    at(view, 8);
    enter(view);
    expect(text(view)).toBe('- **bold**\n- **text**\n');
  });

  it('leaves a break outside formatting as it is', () => {
    const view = mount('plain **bold**\n');
    at(view, 3);
    enter(view);
    expect(text(view)).toBe('pla\nin **bold**\n');
  });
});

describe('the word count', () => {
  it('counts the words the system segments, in visible text, and those selected', () => {
    expect(countWords('one two, three')).toBe(3);
    expect(countWords('日本語のテキストです')).toBeGreaterThan(1);
    const view = mount('# Title\n\nSome **bold** [link](https://example.com/a/b/c) text.\n');
    expect(pageWords(view.state)).toEqual({ words: 5, selected: null });
    act(() => { view.dispatch({ selection: { anchor: 9, head: 18 } }); });
    expect(pageWords(view.state).selected).toBe(2);
  });

  it('keeps a note\'s count when the caret moves onto a line that shows its Markdown', async () => {
    const view = mount('Intro line here.\n\nSee [the site](https://example.com/a-long/path-name) now.\n', NOTE);
    view.focus = vi.fn();
    Object.defineProperty(view, 'hasFocus', { configurable: true, get: () => true });
    act(() => { view.contentDOM.dispatchEvent(new FocusEvent('focus')); });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    at(view, 2);
    const away = pageWords(view.state).words;
    at(view, 25);
    expect(pageWords(view.state).words).toBe(away);
  });
});

describe('hard breaks in a document', () => {
  it('keeps a typed backslash at a line\'s end on the page when Enter follows', () => {
    const view = mount('see C:\\');
    at(view, 7);
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor'); });
    type(view, 'next');
    expect(text(view)).toBe('see C:\\\\\nnext');
    expect(visibleLine(view.state, 0).text).toBe('see C:\\');
  });

  it('go with the line break when Backspace joins the lines', () => {
    for (const [doc, caret] of [['one\\\ntwo\n', 5], ['First line  \nSecond line\n', 13]] as const) {
      const view = mount(doc);
      at(view, caret);
      act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
      expect(text(view)).toBe(doc.replace(/(\\| {2,})\n/, ''));
    }
  });

  it('hide the backslash or spaces, and typing at the line\'s end lands before them', () => {
    for (const [doc, typedDoc] of [['one\\\ntwo\n', 'onex\\\ntwo\n'], ['one  \ntwo\n', 'onex  \ntwo\n']]) {
      const view = mount(doc);
      expect(visibleLine(view.state, 0).text).toBe('one');
      at(view, doc.indexOf('\n'));
      type(view, 'x');
      expect(text(view)).toBe(typedDoc);
    }
  });
});

describe('input methods in a document', () => {
  it('take a selection across a mark out first, keeping the marks, when a composition starts', () => {
    const view = mount('Some **bold** text\n');
    act(() => { view.dispatch({ selection: { anchor: 9, head: 15 } }); });
    act(() => { view.contentDOM.dispatchEvent(new Event('compositionstart', { bubbles: true })); });
    expect(text(view)).toBe('Some **bo**ext\n');
    expect(view.state.selection.main.head).toBe(9);
  });
});

describe('undo right after an autoformat', () => {
  const MOD = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
  const commandZ = (view: EditorView) => act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'z', ...MOD }), 'editor'); });
  // Edit > Undo reaches the page as the browser's undo input, which the history takes.
  const editUndo = (view: EditorView) => act(() => { view.contentDOM.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true })); });

  for (const [name, run] of [['Cmd+Z', commandZ], ['Edit > Undo', editUndo]] as const) {
    it(`shows the marks as text first, then takes the typing back, through ${name}`, () => {
      for (const [typed, formatted, literal] of [['# ', '# ', '\\# '], ['- ', '- ', '\\- '], ['1. ', '1. ', '1\\. '], ['see `x`', 'see `x`', 'see \\`x\\`'], ['see ~~x~~', 'see ~~x~~', 'see \\~\\~x\\~\\~']]) {
        const view = mount('\n');
        at(view, 0);
        type(view, typed);
        expect(text(view)).toBe(`${formatted}\n`);
        run(view);
        expect(text(view)).toBe(`${literal}\n`);
        run(view);
        expect(text(view)).toBe('\n');
      }
    });
  }

  it('never shows italic on the way to bold typed as **x**, and undo after bold has no italic step', () => {
    const view = mount('\n');
    at(view, 0);
    type(view, 'see **x*');
    expect(visibleLine(view.state, 0).text).toBe('see **x*');
    type(view, '*');
    expect(text(view)).toBe('see **x**\n');
    expect(visibleLine(view.state, 0).text).toBe('see x');
    act(() => { undo(view); });
    expect(text(view)).toBe('see \\*\\*x\\*\\*\n');
    // The typing is one undo step with no italic formatting inside it.
    act(() => { undo(view); });
    expect(text(view)).toBe('\n');
    const literal = mount('\n');
    at(literal, 0);
    type(literal, 'a **x* b');
    expect(visibleLine(literal.state, 0).text).toBe('a **x* b');
  });

  it('keeps bold typed as **x** bold, and its first undo shows the stars', () => {
    const view = mount('\n');
    at(view, 0);
    type(view, 'see **x**');
    expect(text(view)).toBe('see **x**\n');
    act(() => { undo(view); });
    expect(text(view)).toBe('see \\*\\*x\\*\\*\n');
  });
});

describe('typing edge cases, second pass', () => {
  it('keeps the item text a paragraph when "=" or "-" is typed on its next line', () => {
    for (const [doc, typed] of [['- Plan for the week\n  ', '='], ['- Plan for the week\n  ', '=='], ['> - Plan\n>   ', '=']] as const) {
      const view = mount(doc);
      at(view, view.state.doc.length);
      type(view, typed);
      const names: string[] = [];
      syntaxTree(view.state).iterate({ enter: (node) => { if (/Heading/.test(node.name)) names.push(node.name); } });
      expect(names).toEqual([]);
      expect(visibleSlice(view.state, 0, view.state.doc.length)).toContain(typed);
    }
  });

  it('shows punctuation typed over a selection that half covers italic, with no star', () => {
    for (const marker of ['*', '**']) {
      const doc = `a ${marker}it${marker} b\n`;
      const view = mount(doc);
      const from = 2 + marker.length + 1;
      const to = from + 1 + marker.length + 1;
      act(() => { view.dispatch({ selection: { anchor: from, head: to } }); });
      const expected = visibleSlice(view.state, 0, from) + '_' + visibleSlice(view.state, to, view.state.doc.length);
      typeOver(view, '_');
      expect(visibleSlice(view.state, 0, view.state.doc.length)).toBe(expected);
    }
  });

  it('pastes literal text over a selection that half covers italic, with no star', () => {
    const view = mount('a *it* b\n');
    act(() => { view.dispatch({ selection: { anchor: 4, head: 7 } }); });
    const spec = pasteSpec(view.state, '_z_', true);
    if (!spec) throw new Error('no paste');
    act(() => { view.dispatch(spec); });
    expect(visibleSlice(view.state, 0, view.state.doc.length)).toBe('a i_z_b\n');
  });

  it('keeps both typed backslashes of \\*stars\\* on the page', () => {
    const view = mount('\n');
    at(view, 0);
    type(view, 'and \\*stars\\*');
    expect(visible(view)).toBe('and \\*stars\\*');
  });

  it('typing over a selection from plain text into bold leaves the rest bold, with no stars', () => {
    const view = mount('Intro with **bold words**, more.\n');
    act(() => { view.dispatch({ selection: { anchor: 6, head: 17 } }); });
    typeOver(view, 'x');
    expect(text(view)).toBe('Intro x **words**, more.\n');
    const deleted = mount('Intro with **bold words**, more.\n');
    act(() => { deleted.dispatch({ selection: { anchor: 6, head: 17 } }); });
    act(() => { runScopeHandlers(deleted, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(visible(deleted)).toBe('Intro  words, more.');
    expect(text(deleted)).toBe('Intro **words**, more.\n'.replace('Intro ', 'Intro  '));
  });
  it('writes a typed HTML tag or entity escaped, so other apps show it as typed too', () => {
    const view = mount('\n');
    at(view, 0);
    type(view, 'a <br> tag, &amp; ok');
    expect(text(view)).toBe('a \\<br> tag, \\&amp; ok\n');
    expect(visible(view)).toBe('a <br> tag, &amp; ok');
  });

  it('starts a task from [] or [ ] and a space on an empty line, undone in two steps', async () => {
    for (const typed of ['[] ', '[ ] ']) {
      const view = mount('\n');
      at(view, 0);
      type(view, typed);
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      type(view, 'call');
      expect(text(view)).toBe('- [ ] call\n');
      act(() => { undo(view); });
      act(() => { undo(view); });
      expect(text(view)).toBe(`${typed}\n`);
    }
    const quoted = mount('> \n');
    at(quoted, 2);
    type(quoted, '[] ');
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(text(quoted)).toBe('> - [ ] \n');
    const midLine = mount('see [] \n');
    at(midLine, 6);
    type(midLine, ' x');
    expect(text(midLine)).toBe('see [] x \n');
  });

  it('keeps short inline code on one line', () => {
    const view = mount('Run `npm test` or `npm run build && npm test -- --watch` now\n');
    const codes = [...view.contentDOM.querySelectorAll('.cm-md-code')];
    expect(codes.map((code) => code.classList.contains('cm-md-code-short'))).toEqual([true, false]);
  });
});
