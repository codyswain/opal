import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { codeText, copiedCode, copyCode, fenceAt, setLanguage, toggleCodeBlock } from '@/renderer/features/disk-explorer/components/editor/codeBlocks';
import { loadAllLanguages } from '@/renderer/features/disk-explorer/components/editor/codeLanguages';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { objectAt, objectKind } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { clearFormatting, toggleInlineCode, toggleList, toggleMarker, setHeading } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { formatState } from '@/renderer/features/disk-explorer/components/editor/formatState';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/Plan.md';

let views: EditorView[] = [];
let written: string[] = [];

beforeAll(async () => {
  await loadAllLanguages();
});

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '', [NOTE]: '' });
  written = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async (text: string) => { written.push(text); }) } });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

function mount(doc: string, at = 0, page = DOC) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: at }, extensions: markdownEditorExtensions(page) }) });
  ensureSyntaxTree(view.state, view.state.doc.length, 5_000);
  view.dispatch({});
  views.push(view);
  return view;
}

async function focusPage(view: EditorView) {
  view.focus = vi.fn();
  Object.defineProperty(view, 'hasFocus', { configurable: true, get: () => true });
  act(() => { view.contentDOM.dispatchEvent(new FocusEvent('focus')); });
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

// CodeMirror reads Mod as Cmd on macOS and Ctrl elsewhere.
const mod: KeyboardEventInit = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
const text = (view: EditorView) => view.state.doc.toString();
const caret = (view: EditorView) => view.state.selection.main.head;
const select = (view: EditorView, anchor: number, head = anchor) => act(() => { view.dispatch({ selection: { anchor, head } }); });
const key = (view: EditorView, name: string, init: KeyboardEventInit = {}) =>
  act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: name, ...init }), 'editor'); });

/** Types as the browser does: at its own caret, through the input handlers. */
function type(view: EditorView, typed: string) {
  act(() => {
    for (const character of typed) {
      const at = caret(view);
      const insert = () => view.state.update({ changes: { from: at, insert: character }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
      if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, at, at, character, insert))) view.dispatch(insert());
    }
  });
}

const hasNode = (view: EditorView, name: string) => {
  let found = false;
  syntaxTree(view.state).iterate({ enter: (ref) => { if (ref.name === name) found = true; } });
  return found;
};

describe('typing a fence in a document', () => {
  it('keeps ``` and ```ts as text until Enter, then writes both fences with the caret between', async () => {
    const view = mount('Intro\n\n\n\n# Below\n', 7);
    await focusPage(view);
    type(view, '```ts');
    expect(text(view)).toBe('Intro\n\n\\```ts\n\n# Below\n');
    expect(hasNode(view, 'FencedCode')).toBe(false);
    key(view, 'Enter');
    expect(text(view)).toBe('Intro\n\n```ts\n\n```\n\n# Below\n');
    expect(caret(view)).toBe(text(view).indexOf('ts\n') + 3);
    type(view, 'x');
    expect(text(view)).toBe('Intro\n\n```ts\nx\n```\n\n# Below\n');
  });

  it('turns the block back into the typed line on Backspace right after Enter', async () => {
    const view = mount('A\n\n', 3);
    await focusPage(view);
    type(view, '```');
    key(view, 'Enter');
    expect(text(view)).toBe('A\n\n```\n\n```');
    key(view, 'Backspace');
    expect(text(view)).toBe('A\n\n\\```');
    expect(caret(view)).toBe(text(view).length);
  });

  it('leaves typed backticks written escaped when the caret goes elsewhere', async () => {
    const view = mount('A\n\n\nB\n', 3);
    await focusPage(view);
    type(view, '```');
    select(view, 0);
    expect(text(view)).toBe('A\n\n\\```\nB\n');
    expect(hasNode(view, 'FencedCode')).toBe(false);
  });

  it('keeps a quote\'s marks and a list item\'s indent on the fences it writes', async () => {
    const quoted = mount('> ', 2);
    await focusPage(quoted);
    type(quoted, '```py');
    key(quoted, 'Enter');
    expect(text(quoted)).toBe('> ```py\n> \n> ```');
    const listed = mount('- ', 2);
    await focusPage(listed);
    type(listed, '```');
    key(listed, 'Enter');
    expect(text(listed)).toBe('- ```\n  \n  ```');
  });

  it('writes typed backticks as they are inside code and inline code', async () => {
    const view = mount('```\nab\n```\n\nx `cd` y\n', 4);
    await focusPage(view);
    type(view, '```');
    expect(text(view)).toBe('```\n```ab\n```\n\nx `cd` y\n');
  });
});

describe('a code block in a document', () => {
  const DOC_TEXT = 'Intro\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n\nAfter\n';

  it('shows no fence, draws a header with the language, and colours the code', async () => {
    const view = mount(DOC_TEXT);
    const shown = view.contentDOM.textContent ?? '';
    expect(shown).not.toContain('```');
    expect(view.contentDOM.querySelector('.cm-code-header')?.textContent).toContain('TypeScript');
    expect(view.contentDOM.querySelectorAll('.cm-code-line').length).toBe(4);
    expect(view.contentDOM.querySelector('.cm-code-keyword')?.textContent).toBe('const');
    expect(view.contentDOM.querySelector('.cm-code-header')?.getAttribute('aria-label')).toBe('Code, TypeScript');
  });

  it('never rests the caret on a fence line', async () => {
    const view = mount(DOC_TEXT);
    await focusPage(view);
    select(view, DOC_TEXT.indexOf('```ts') + 2);
    expect([DOC_TEXT.indexOf('```ts') - 1, DOC_TEXT.indexOf('const a')]).toContain(caret(view));
    select(view, DOC_TEXT.lastIndexOf('```') + 1);
    expect([DOC_TEXT.indexOf('2;') + 2, DOC_TEXT.indexOf('\nAfter') ]).toContain(caret(view));
  });

  it('moves into the first and last code lines with the arrow keys', async () => {
    const view = mount(DOC_TEXT, DOC_TEXT.indexOf('```ts') - 1);
    await focusPage(view);
    key(view, 'ArrowRight');
    expect(caret(view)).toBe(DOC_TEXT.indexOf('const a'));
    select(view, DOC_TEXT.indexOf('2;') + 2);
    key(view, 'ArrowRight');
    expect(caret(view)).toBe(DOC_TEXT.indexOf('\nAfter'));
  });

  it('frames from a click on the header, with Copy, Language and Remove', async () => {
    const view = mount(DOC_TEXT);
    const obj = objectAt(view.state, DOC_TEXT.indexOf('```ts'), 1);
    if (!obj) throw new Error('no code object');
    expect(obj.kind).toBe('code');
    const actions = objectKind(view.state, 'code')?.actions(view.state, obj).map((action) => action.label);
    expect(actions).toEqual(['Copy', 'Language', 'Remove']);
    const header = view.contentDOM.querySelector('.cm-code-header') as HTMLElement;
    view.focus = vi.fn();
    act(() => { header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1 })); });
    expect(view.state.field(objectFrame)?.kind).toBe('code');
    expect(text(view)).toBe(DOC_TEXT);
  });

  it('copies only the code, and the header\'s Copy then says Copied', async () => {
    const view = mount('> ```py\n> a = 1\n>   b\n> ```\n');
    copyCode(view, 3, null);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(written).toEqual(['a = 1\n  b']);
    const listed = mount('- item\n  ```\n  one\n    two\n  ```\n');
    const button = listed.contentDOM.querySelector('.cm-code-copy') as HTMLElement;
    act(() => { button.click(); });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(written[1]).toBe('one\n  two');
    expect(button.textContent).toBe('Copied');
  });

  it('copies a selection inside quoted or listed code without the quote marks or the item\'s indent', () => {
    const doc = '> ```\n> one\n> two\n> ```\n';
    const view = mount(doc);
    select(view, doc.indexOf('ne'), doc.indexOf('wo'));
    expect(copiedCode(view.state)).toBe('ne\nt');
    const plain = mount('```\none\ntwo\n```\n');
    select(plain, 5, 11);
    expect(copiedCode(plain.state)).toBeNull();
  });

  it('removes an empty line after a block on Backspace, and moves a text line\'s caret to the end of the code', async () => {
    const view = mount(DOC_TEXT, DOC_TEXT.indexOf('\nAfter'));
    await focusPage(view);
    key(view, 'Backspace');
    expect(text(view)).toBe('Intro\n\n```ts\nconst a = 1;\nconst b = 2;\n```\nAfter\n');
    expect(caret(view)).toBe(DOC_TEXT.indexOf('2;') + 2);
    select(view, text(view).indexOf('After'));
    key(view, 'Backspace');
    expect(text(view)).toBe('Intro\n\n```ts\nconst a = 1;\nconst b = 2;\n```\nAfter\n');
    expect(caret(view)).toBe(DOC_TEXT.indexOf('2;') + 2);
  });

  it('does nothing on Backspace at the start of the code, or Delete at its end', async () => {
    const view = mount(DOC_TEXT, DOC_TEXT.indexOf('const a'));
    await focusPage(view);
    key(view, 'Backspace');
    expect(text(view)).toBe(DOC_TEXT);
    select(view, DOC_TEXT.indexOf('2;') + 2);
    key(view, 'Delete');
    expect(text(view)).toBe(DOC_TEXT);
  });

  it('removes both fences on Backspace in an empty block', async () => {
    const doc = 'A\n\n```\n\n```\n\nB\n';
    const view = mount(doc, doc.indexOf('```\n\n') + 4);
    await focusPage(view);
    expect(view.contentDOM.querySelector('.cm-code-placeholder')?.textContent).toBe('Code');
    key(view, 'Backspace');
    expect(text(view)).toBe('A\n\n\n\nB\n');
  });

  it('writes a line break first when typing before a block that starts the page or after one that ends it', async () => {
    const start = mount('```\ncode\n```\n\nEnd\n', 0);
    await focusPage(start);
    type(start, 'x');
    expect(text(start)).toBe('x\n```\ncode\n```\n\nEnd\n');
    const end = mount('Top\n\n```\ncode\n```');
    await focusPage(end);
    select(end, end.state.doc.length);
    expect(caret(end)).toBe(end.state.doc.length);
    type(end, 'y');
    expect(text(end)).toBe('Top\n\n```\ncode\n```\ny');
  });

  it('leaves a block on Escape, ArrowDown on its last line and Cmd+Enter, writing nothing until a key is typed', async () => {
    const doc = 'Top\n\n```\none\ntwo\n```';
    let view = mount(doc);
    for (const [name, init] of [['Escape', {}], ['ArrowDown', {}], ['Enter', mod]] as const) {
      view = mount(doc, doc.indexOf('two') + 1);
      await focusPage(view);
      key(view, name, init);
      expect(caret(view)).toBe(doc.length);
      expect(text(view)).toBe(doc);
    }
    type(view, 'z');
    expect(text(view)).toBe(`${doc}\nz`);
    const followed = mount('```\none\n```\nNext\n', 5);
    await focusPage(followed);
    key(followed, 'Escape');
    expect(caret(followed)).toBe('```\none\n```\n'.length);
  });

  it('keeps the quote marks and the indent on Enter in quoted code', async () => {
    const doc = '> ```\n>   indented\n> ```\n';
    const view = mount(doc, doc.indexOf('indented') + 8);
    await focusPage(view);
    key(view, 'Enter');
    expect(text(view)).toBe('> ```\n>   indented\n>   \n> ```\n');
  });

  it('gives a blank code line in a list item its indent back when typing on it, so the item goes on', async () => {
    const doc = '1. item\n   ```\n   a\n\n   b\n   ```\n';
    const view = mount(doc, doc.indexOf('\n\n') + 1);
    await focusPage(view);
    type(view, 'x');
    expect(text(view)).toBe('1. item\n   ```\n   a\n   x\n   b\n   ```\n');
    select(view, text(view).indexOf('a') + 1);
    key(view, 'Enter');
    expect(text(view)).toBe('1. item\n   ```\n   a\n   \n   x\n   b\n   ```\n');
  });

  it('indents in the block\'s own style with Tab and Shift+Tab', async () => {
    const doc = '```\na\n  b\n  c\n```\n';
    const view = mount(doc, doc.indexOf('c'));
    await focusPage(view);
    key(view, 'Tab');
    expect(text(view)).toBe('```\na\n  b\n    c\n```\n');
    key(view, 'Tab', { shiftKey: true });
    expect(text(view)).toBe(doc);
    select(view, doc.indexOf('a'), doc.indexOf('c') + 1);
    key(view, 'Tab');
    expect(text(view)).toBe('```\n  a\n    b\n    c\n```\n');
    const python = mount('```py\ndef f():\n    x\n```\n', 19);
    await focusPage(python);
    key(python, 'Tab');
    expect(text(python)).toBe('```py\ndef f():\n        x\n```\n');
    const tabs = mount('```\n\ta\n```\n', 5);
    await focusPage(tabs);
    key(tabs, 'Tab');
    expect(text(tabs)).toBe('```\n\t\ta\n```\n');
  });

  it('selects the code on Cmd+A, then the page', async () => {
    const view = mount(DOC_TEXT, DOC_TEXT.indexOf('a ='));
    await focusPage(view);
    key(view, 'a', mod);
    expect(view.state.selection.main.from).toBe(DOC_TEXT.indexOf('const a'));
    expect(view.state.selection.main.to).toBe(DOC_TEXT.indexOf('2;') + 2);
    key(view, 'a', mod);
    expect(view.state.selection.main.to - view.state.selection.main.from).toBe(DOC_TEXT.length);
  });

  it('joins a later line of indented code to the line above on Backspace, and does nothing on its first line', async () => {
    const doc = 'Text\n\n    one\n    two\n';
    const view = mount(doc, doc.indexOf('two'));
    await focusPage(view);
    key(view, 'Backspace');
    expect(text(view)).toBe('Text\n\n    onetwo\n');
    select(view, text(view).indexOf('one'));
    key(view, 'Backspace');
    expect(text(view)).toBe('Text\n\n    onetwo\n');
  });

  it('keeps a fence on a list item\'s line beside its bullet', () => {
    const view = mount('- ```sh\n  ls\n  ```\n');
    expect(view.contentDOM.querySelector('.cm-md-list-marker')).not.toBeNull();
    expect(view.contentDOM.querySelector('.cm-code-header')?.textContent).toContain('Shell');
  });

  it('draws an unclosed fence as code to the end with a dashed edge, and End code here writes the closing fence', async () => {
    const doc = '```\none\ntwo';
    const view = mount(doc, doc.indexOf('one') + 3);
    await focusPage(view);
    expect(view.contentDOM.querySelector('.cm-code-open-end')?.textContent).toBe('No closing fence · End code here');
    expect(view.contentDOM.querySelector('.cm-code-unclosed')).not.toBeNull();
    act(() => { (view.contentDOM.querySelector('.cm-code-end-here') as HTMLElement).click(); });
    expect(text(view)).toBe('```\none\n```\ntwo');
  });

  it('draws diff lines', () => {
    const view = mount('```diff\n@@ -1 +1 @@\n-old\n+new\n same\n```\n');
    expect(view.contentDOM.querySelector('.cm-code-diff-add')?.textContent).toBe('+new');
    expect(view.contentDOM.querySelector('.cm-code-diff-del')?.textContent).toBe('-old');
    expect(view.contentDOM.querySelector('.cm-code-diff-meta')?.textContent).toBe('@@ -1 +1 @@');
  });
});

describe('Markdown commands and code', () => {
  const MD = 'Text\n\n```markdown\n- item\n# Title\n**x**\n![a](b.png)\nnext\n```\n';

  it('treats a ```markdown fence as code: typed marks, Backspace after an image line and Cmd+K change only the bytes at the caret', async () => {
    const view = mount(MD, MD.indexOf('next'));
    await focusPage(view);
    type(view, '- ');
    expect(text(view)).toBe(MD.replace('next', '- next'));
    type(view, '# **y**');
    expect(text(view)).toBe(MD.replace('next', '- # **y**next'));
    select(view, text(view).indexOf('- # **y**next'));
    key(view, 'Backspace');
    expect(text(view)).toBe(MD.replace('png)\nnext', 'png)- # **y**next'));
    const before = text(view);
    select(view, before.indexOf('item'), before.indexOf('item') + 4);
    key(view, 'k', mod);
    expect(text(view)).toBe(before);
    expect(hasNode(view, 'Link')).toBe(false);
  });

  it('changes nothing on Cmd+B, lists or headings with the caret in a code block, and the toolbar shows it as code', async () => {
    const view = mount(MD, MD.indexOf('Title') + 2);
    await focusPage(view);
    for (const name of ['b', 'i']) key(view, name, mod);
    key(view, '8', { ...mod, shiftKey: true });
    key(view, '2', { ...mod, altKey: true });
    type(view, 'z');
    expect(text(view)).toBe(MD.replace('Title', 'Tiztle'));
    expect(formatState(view.state).code).toBe('block');
  });

  it('keeps code lines\' bytes under Bold, Clear, lists and headings over a selection that includes them', () => {
    const doc = 'one\n\n```\nfoo *x*\n```\n\ntwo `c`\n';
    const view = mount(doc);
    act(() => { view.dispatch({ selection: EditorSelection.range(0, doc.length) }); });
    toggleMarker('**')(view);
    expect(text(view)).toBe('**one**\n\n```\nfoo *x*\n```\n\n**two `c`**\n');
    act(() => { view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) }); });
    clearFormatting(view);
    expect(text(view)).toContain('```\nfoo *x*\n```');
    act(() => { view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) }); });
    toggleList('bullet')(view);
    setHeading(2)(view);
    expect(text(view)).toContain('\n```\nfoo *x*\n```\n');
  });

  it('wraps Bold and links around the whole inline code span', async () => {
    const doc = 'a `x` b\n';
    const view = mount(doc, doc.indexOf('x'));
    await focusPage(view);
    act(() => { view.dispatch({ selection: EditorSelection.range(doc.indexOf('x'), doc.indexOf('x') + 1) }); });
    toggleMarker('**')(view);
    expect(text(view)).toBe('a **`x`** b\n');
    const linked = mount(doc, doc.indexOf('x'));
    await focusPage(linked);
    act(() => { linked.dispatch({ selection: EditorSelection.range(doc.indexOf('x'), doc.indexOf('x') + 1) }); });
    key(linked, 'k', mod);
    expect(linked.state.selection.main.from).toBe(2);
    expect(linked.state.selection.main.to).toBe(5);
  });
});

describe('making code', () => {
  it('toggles inline code with Cmd+E, counting backticks', async () => {
    const view = mount('say hello there\n', 6);
    await focusPage(view);
    key(view, 'e', mod);
    expect(text(view)).toBe('say `hello` there\n');
    key(view, 'e', mod);
    expect(text(view)).toBe('say hello there\n');
    const ticks = mount('a b`c d\n');
    act(() => { ticks.dispatch({ selection: EditorSelection.range(2, 5) }); });
    toggleInlineCode(ticks);
    expect(text(ticks)).toBe('a ``b`c`` d\n');
    const edge = mount('x `y z\n');
    act(() => { edge.dispatch({ selection: EditorSelection.range(2, 5) }); });
    toggleInlineCode(edge);
    expect(text(edge)).toBe('x `` `y `` z\n');
  });

  it('takes the marks of formatting inside the selection off, keeping what the page shows', () => {
    const view = mount('a **b** c\n');
    act(() => { view.dispatch({ selection: EditorSelection.range(0, 9) }); });
    toggleInlineCode(view);
    expect(text(view)).toBe('`a b c`\n');
  });

  it('escapes backticks that would pair when code comes off', () => {
    const view = mount('see ``a`b`` now\n', 7);
    toggleInlineCode(view);
    expect(text(view)).toBe('see a\\`b now\n');
  });

  it('wraps lines in a code block with Cmd+Option+C, and unwraps them', async () => {
    const doc = 'one\ntwo\n\nthree\n';
    const view = mount(doc);
    await focusPage(view);
    act(() => { view.dispatch({ selection: EditorSelection.range(0, 7) }); });
    key(view, 'c', { ...mod, altKey: true });
    expect(text(view)).toBe('```\none\ntwo\n```\n\nthree\n');
    select(view, text(view).indexOf('two'));
    toggleCodeBlock(view);
    expect(text(view)).toBe(doc);
    const empty = mount('a\n\nb\n', 2);
    toggleCodeBlock(empty);
    expect(text(empty)).toBe('a\n```\n\n```\nb\n');
    expect(caret(empty)).toBe(6);
    const fenced = mount('x\n```\ninside\n```\n', 0);
    act(() => { fenced.dispatch({ selection: EditorSelection.range(0, fenced.state.doc.length) }); });
    toggleCodeBlock(fenced);
    expect(text(fenced)).toBe('````\nx\n```\ninside\n```\n````\n');
  });

  it('writes only the first word of the info string when a language is picked', () => {
    const view = mount('```ts title="x"\ncode\n```\n');
    setLanguage(view, 5, 'python');
    expect(text(view)).toBe('```python title="x"\ncode\n```\n');
    const bare = mount('```\ncode\n```\n');
    setLanguage(bare, 5, 'sql');
    expect(text(bare)).toBe('```sql\ncode\n```\n');
  });
});

describe('code in a note', () => {
  it('draws a highlighted block that scrolls inside the column, and shows its source while the caret is in it', async () => {
    const doc = 'Text\n\n```python\ndef f():\n    return 1\n```\n';
    const view = mount(doc, 0, NOTE);
    const block = view.contentDOM.querySelector('.cm-md-codeblock-widget') as HTMLElement;
    expect(block.querySelector('.cm-code-keyword')?.textContent).toBe('def');
    await focusPage(view);
    select(view, doc.indexOf('return'));
    expect(view.contentDOM.querySelector('.cm-md-codeblock-widget')).toBeNull();
    expect(view.contentDOM.querySelectorAll('.cm-md-codeblock')).toHaveLength(4);
    expect(view.contentDOM.querySelector('.cm-code-keyword')?.textContent).toBe('def');
  });

  it('reads the code without fences or the container', () => {
    const view = mount('> ```\n> a\n> b\n> ```\n', 0, NOTE);
    const fence = fenceAt(view.state, 3);
    expect(fence && codeText(view.state, fence)).toBe('a\nb');
  });
});
