import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { toggleMarker } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { fitMarks, literalText } from '@/renderer/features/disk-explorer/components/editor/typing';
import { visibleLine } from '@/renderer/features/disk-explorer/components/editor/visibleText';
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

  it('puts a letter that would unmake a mark on the mark\'s other side', () => {
    const view = mount('say — *"hi"* now\n');
    at(view, text(view).indexOf('*'));
    type(view, 'x');
    expect(text(view)).toBe('say — *x"hi"* now\n');
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
});

describe('hard breaks in a document', () => {
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

  it('keeps bold typed as **x** bold, and its first undo shows the stars', () => {
    const view = mount('\n');
    at(view, 0);
    type(view, 'see **x**');
    expect(text(view)).toBe('see **x**\n');
    act(() => { undo(view); });
    expect(text(view)).toBe('see \\*\\*x\\*\\*\n');
  });
});
