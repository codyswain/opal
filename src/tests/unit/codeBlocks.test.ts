import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { codeText, collapsedBlocks, copiedCode, copyCode, fenceAt, setLanguage, toggleCodeBlock } from '@/renderer/features/disk-explorer/components/editor/codeBlocks';
import { loadAllLanguages } from '@/renderer/features/disk-explorer/components/editor/codeLanguages';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { objectAt, objectKind } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { clearFormatting, clearFormattingAndCode, toggleInlineCode, toggleList, toggleMarker, setHeading } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { setDiagramCode } from '@/renderer/features/disk-explorer/components/editor/diagrams';
import { blockPosition } from '@/renderer/features/disk-explorer/components/editor/livePreview';
import { formatState } from '@/renderer/features/disk-explorer/components/editor/formatState';
import { focusObjectBar, objectFrame, setFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
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

  it('writes \\, \\., *, _, a backtick, 1984. , <!-- and --- in code exactly as typed', async () => {
    for (const typed of ['\\', '\\.', '*', '_', '`', '1984. ', '<!--', '---']) {
      const doc = '> ```\n> a b\n> ```\n';
      const view = mount(doc, doc.indexOf(' b'));
      await focusPage(view);
      type(view, typed);
      expect(text(view)).toBe(doc.replace('a b', `a${typed} b`));
    }
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

  it('keeps fence lines whole when a deleted or typed-over selection covers part of a block', async () => {
    const doc = 'Para one\n```\ncode\n```\nPara two\n';
    const view = mount(doc);
    await focusPage(view);
    select(view, doc.indexOf('one'), doc.indexOf('de'));
    key(view, 'Backspace');
    expect(text(view)).toBe('Para \n```\nde\n```\nPara two\n');
    select(view, text(view).indexOf('e\n```'), text(view).indexOf('two'));
    act(() => { view.dispatch({ ...view.state.replaceSelection('X'), userEvent: 'input.type' }); });
    expect(text(view)).toBe('Para \n```\ndX\n```\ntwo\n');
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
    expect(view.contentDOM.querySelector('.cm-code-diff-add .cm-code-diff-sign')?.textContent).toBe('+');
    expect(view.contentDOM.querySelector('.cm-code-diff-del')?.textContent).toBe('-old');
    expect(view.contentDOM.querySelector('.cm-code-diff-meta')?.textContent).toBe('@@ -1 +1 @@');
  });
});

describe('the header and long blocks', () => {
  it('opens a language menu whose search writes nothing, and a pick writes the info string\'s first word', async () => {
    const doc = '```ts title="a"\ncode\n```\n';
    const view = mount(doc);
    const label = view.contentDOM.querySelector('.cm-code-label') as HTMLElement;
    expect(label.getAttribute('aria-label')).toBe('Language, TypeScript');
    act(() => { label.click(); });
    const search = document.querySelector('.opal-code-menu-search') as HTMLInputElement;
    expect(search).not.toBeNull();
    act(() => {
      search.value = 'pyth';
      search.dispatchEvent(new Event('input'));
    });
    expect([...document.querySelectorAll('.opal-code-menu-item')].map((item) => item.textContent)).toEqual(['Python']);
    expect(text(view)).toBe(doc);
    act(() => { search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
    expect(text(view)).toBe('```python title="a"\ncode\n```\n');
    expect(document.querySelector('.opal-code-menu')).toBeNull();
  });

  it('shows Plain text only as a quiet label for a fence with no language', () => {
    const view = mount('```\nx\n```\n');
    const header = view.contentDOM.querySelector('.cm-code-header') as HTMLElement;
    expect(header.dataset.quiet).toBe('true');
    expect(header.textContent).toContain('Plain text');
    expect(header.getAttribute('aria-label')).toBe('Code');
  });

  it('moves focus to the header\'s buttons on Option+F10 with the caret in a block', async () => {
    const doc = 'A\n\n```sh\nls\n```\n';
    const view = mount(doc, doc.indexOf('ls'));
    await focusPage(view);
    key(view, 'F10', { altKey: true });
    expect(document.activeElement?.classList.contains('cm-code-label')).toBe(true);
  });

  it('collapses a block over 40 lines behind Show all, steps over the hidden lines, and shows them for a search match', async () => {
    const code = Array.from({ length: 60 }, (_, line) => `line ${line}`).join('\n');
    const doc = `Top\n\n\`\`\`\n${code}\n\`\`\`\nAfter\n`;
    const view = mount(doc);
    await focusPage(view);
    expect(collapsedBlocks(view.state)).toEqual([{ from: doc.indexOf('line 40'), to: doc.indexOf('\n```\nAfter'), block: doc.indexOf('```') }]);
    select(view, doc.indexOf('line 39') + 7);
    key(view, 'ArrowRight');
    expect(caret(view)).toBe(doc.indexOf('After'));
    act(() => { view.dispatch({ selection: EditorSelection.range(doc.indexOf('line 50'), doc.indexOf('line 50') + 7), userEvent: 'select.search' }); });
    expect(view.state.selection.main.from).toBe(doc.indexOf('line 50'));
    expect(collapsedBlocks(view.state)).toEqual([]);
    expect(text(view)).toBe(doc);
  });

  it('collapses a long block in a note too, until Show all', () => {
    const code = Array.from({ length: 45 }, (_, line) => `l${line}`).join('\n');
    const view = mount(`\`\`\`\n${code}\n\`\`\`\n`, 0, NOTE);
    const block = view.contentDOM.querySelector('.cm-md-codeblock-widget') as HTMLElement;
    expect(block.querySelectorAll('[data-offset]')).toHaveLength(40);
    act(() => { (block.querySelector('.cm-code-show-all') as HTMLElement).click(); });
    expect(block.querySelectorAll('[data-offset]')).toHaveLength(45);
  });

  it('never reads a [ref]: url line inside code as a link definition', () => {
    const view = mount('See [docs] here.\n\n```\n[docs]: https://example.com\n```\n', 0, NOTE);
    expect(view.contentDOM.querySelector('[data-href]')).toBeNull();
    const defined = mount('See [docs] here.\n\n[docs]: https://example.com\n', 0, NOTE);
    expect(defined.contentDOM.querySelector('[data-href]')?.getAttribute('data-href')).toBe('https://example.com');
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

describe('edits across fences', () => {
  it('keeps fence lines when Enter or Shift+Enter replaces a selection that crosses one', async () => {
    for (const init of [{}, { shiftKey: true }]) {
      const down = mount('```\nab\n```\npara\n', 5);
      await focusPage(down);
      select(down, 5, 13);
      key(down, 'Enter', init);
      expect(text(down)).toBe('```\na\n\n```\nra\n');
      const up = mount('para\n```\nab\n```\n', 2);
      await focusPage(up);
      select(up, 2, 10);
      key(up, 'Enter', init);
      expect(text(up)).toBe('pa\n\n```\nb\n```\n');
    }
  });

  it('keeps the quote marks on both sides when Enter replaces a selection from quoted code into the quote\'s next line', async () => {
    const doc = '> ```\n> ab\n> ```\n> para\n';
    const view = mount(doc, 9);
    await focusPage(view);
    select(view, 9, doc.indexOf('ra'));
    key(view, 'Enter');
    expect(text(view)).toBe('> ```\n> a\n> \n> ```\n> ra\n');
  });

  it('keeps the quote marks on Shift+Enter in quoted code', async () => {
    const view = mount('> ```\n> ab\n> ```\n\nafter\n', 9);
    await focusPage(view);
    key(view, 'Enter', { shiftKey: true });
    expect(text(view)).toBe('> ```\n> a\n> b\n> ```\n\nafter\n');
  });

  it('lengthens the block\'s fences when a line typed or pasted in it would close it', async () => {
    const doc = 'Intro\n\n```markdown\nA fence looks like:\n\n# Heading\n```\n\nMore text';
    const view = mount(doc, doc.indexOf('like:') + 5);
    await focusPage(view);
    key(view, 'Enter');
    type(view, '```');
    expect(text(view)).toBe('Intro\n\n````markdown\nA fence looks like:\n```\n\n# Heading\n````\n\nMore text');
    expect(fenceAt(view.state, text(view).indexOf('# Heading'))?.close?.text).toBe('````');
    const pasted = 'Intro\n\n```markdown\nexample:\n```\n\n# Heading';
    const paste = mount(pasted, pasted.indexOf('example:') + 8);
    await focusPage(paste);
    act(() => { paste.dispatch({ ...paste.state.replaceSelection('\n```sh\nls\n```'), userEvent: 'input.paste' }); });
    expect(text(paste)).toBe('Intro\n\n````markdown\nexample:\n```sh\nls\n```\n````\n\n# Heading');
    expect(hasNode(paste, 'ATXHeading1')).toBe(true);
  });

  it('keeps fence lines when a drag moves text across one, and drops only the text that left', async () => {
    const doc = 'Intro line\n\n```js\nlet a = 1\n```\n\nAfter the block\n\n# Heading';
    const view = mount(doc);
    await focusPage(view);
    const from = doc.indexOf('= 1');
    const to = doc.indexOf('the block');
    act(() => { view.dispatch({ changes: [{ from: 0, insert: doc.slice(from, to) }, { from, to }], selection: { anchor: 0, head: to - from }, userEvent: 'move.drop' }); });
    expect(text(view)).toBe('= 1\n\nAfter Intro line\n\n```js\nlet a \n```\nthe block\n\n# Heading');
    expect(fenceAt(view.state, text(view).indexOf('let'))?.close).not.toBeNull();
  });

  it('puts only the removed text on the clipboard when a cut keeps a fence', async () => {
    const doc = '```\nab\n```\npara\n\nend\n';
    const view = mount(doc);
    await focusPage(view);
    select(view, 5, 13);
    const setData = vi.fn();
    const event = new Event('cut', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData, clearData: vi.fn(), getData: () => '' } });
    act(() => { view.contentDOM.dispatchEvent(event); });
    expect(setData).toHaveBeenLastCalledWith('text/plain', 'b\npa');
    expect(text(view)).toBe('```\na\n```\nra\n\nend\n');
  });

  it('leaves a note\'s copy to CodeMirror, so quoted code keeps its marks', () => {
    const doc = '> ```\n> abc\n> def\n> ```\n';
    const view = mount(doc, 0, NOTE);
    select(view, doc.indexOf('bc'), doc.indexOf('ef'));
    const setData = vi.fn();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData, clearData: vi.fn(), getData: () => '' } });
    act(() => { view.contentDOM.dispatchEvent(event); });
    expect(setData.mock.calls.some(([, copied]) => copied === 'bc\nd')).toBe(false);
  });

  it('writes the line break before composed text at the page-edge stops', async () => {
    const end = mount('```\nab\n```', 6);
    await focusPage(end);
    key(end, 'Escape');
    expect(caret(end)).toBe(10);
    act(() => { end.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
    act(() => { end.dispatch({ changes: { from: caret(end), insert: 'é' }, selection: { anchor: caret(end) + 1 }, userEvent: 'input.type.compose' }); });
    expect(text(end)).toBe('```\nab\n```\né');
    const start = mount('```\nab\n```\nmore', 4);
    await focusPage(start);
    select(start, 0);
    act(() => { start.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
    act(() => { start.dispatch({ changes: { from: caret(start), insert: 'é' }, selection: { anchor: caret(start) + 1 }, userEvent: 'input.type.compose' }); });
    expect(text(start)).toBe('é\n```\nab\n```\nmore');
  });

  it('gives a tab-indented list item\'s blank code line its tab back', async () => {
    const doc = '- step\n\t```sh\n\techo a\n\n\techo b\n\t```\n- next';
    const view = mount(doc, doc.indexOf('\n\n') + 1);
    await focusPage(view);
    type(view, 'x');
    expect(text(view)).toBe('- step\n\t```sh\n\techo a\n\tx\n\techo b\n\t```\n- next');
    expect(fenceAt(view.state, text(view).indexOf('echo a'))?.close).not.toBeNull();
  });
});

describe('the stops beside a block', () => {
  it('treats the caret after a final block, and before a first one, as outside it', async () => {
    const view = mount('Intro\n\n```\nab\n```', 13);
    await focusPage(view);
    key(view, 'Escape');
    expect(caret(view)).toBe(17);
    expect(formatState(view.state).code).toBeNull();
    toggleCodeBlock(view);
    expect(text(view)).toBe('Intro\n\n```\nab\n```\n```\n\n```');
    expect(caret(view)).toBe(text(view).length - 4);
    const after = mount('Intro\n\n```\nab\n```', 13);
    await focusPage(after);
    key(after, 'Escape');
    key(after, 'b', mod);
    type(after, 'x');
    expect(text(after)).toBe('Intro\n\n```\nab\n```\n**x**');
    const listed = mount('Intro\n\n```\nab\n```', 13);
    await focusPage(listed);
    key(listed, 'Escape');
    key(listed, '8', { ...mod, shiftKey: true });
    type(listed, 'x');
    expect(text(listed)).toBe('Intro\n\n```\nab\n```\n- x');
    const bold = mount('```\nab\n```\n\nafter', 5);
    await focusPage(bold);
    select(bold, 0);
    key(bold, 'b', mod);
    type(bold, 'x');
    expect(text(bold)).toBe('**x**\n```\nab\n```\n\nafter');
    const first = mount('```\nab\n```\n\nafter', 5);
    await focusPage(first);
    select(first, 0);
    expect(formatState(first.state).code).toBeNull();
    toggleCodeBlock(first);
    expect(text(first)).toBe('```\n\n```\n```\nab\n```\n\nafter');
    expect(caret(first)).toBe(4);
  });
});

describe('fences on list items', () => {
  it('keeps the bullet when a block is unwrapped or emptied, and wraps an item\'s text inside the item', async () => {
    const unwrap = mount('- ```py\n  x = 1\n  ```\n- next\n', 10);
    await focusPage(unwrap);
    toggleCodeBlock(unwrap);
    expect(text(unwrap)).toBe('- x = 1\n- next\n');
    const empty = mount('- ```\n  \n  ```\n- next\n', 8);
    await focusPage(empty);
    key(empty, 'Backspace');
    expect(text(empty)).toBe('- \n- next\n');
    const wrap = mount('- one\n- two\n', 3);
    await focusPage(wrap);
    toggleCodeBlock(wrap);
    expect(text(wrap)).toBe('- ```\n  one\n  ```\n- two\n');
  });

  it('still reads link definitions after a fence on a list item\'s line', () => {
    const view = mount('See [the docs][ref].\n\n- ```js\n  x\n  ```\n\n[ref]: https://example.com\n', 0, NOTE);
    expect(view.contentDOM.querySelector('[data-href]')?.getAttribute('data-href')).toBe('https://example.com');
  });
});

describe('formatting next to code', () => {
  it('leaves a one-line indented code block alone under select all and Bold, in documents and notes', () => {
    for (const page of [DOC, NOTE]) {
      const doc = 'Intro\n\n    npm run build\n\nOutro';
      const view = mount(doc, 0, page);
      act(() => { view.dispatch({ selection: EditorSelection.range(0, doc.length) }); });
      toggleMarker('**')(view);
      expect(text(view)).toBe('**Intro**\n\n    npm run build\n\n**Outro**');
    }
  });

  it('puts Bold and links around inline code that fills its line, which can still become a heading', async () => {
    const doc = 'Intro\n\n`npm install`\n';
    const view = mount(doc, 9);
    await focusPage(view);
    select(view, 8, 19);
    key(view, 'b', mod);
    expect(text(view)).toBe('Intro\n\n**`npm install`**\n');
    const caretOnly = mount(doc, 10);
    await focusPage(caretOnly);
    key(caretOnly, 'b', mod);
    expect(text(caretOnly)).toBe('Intro\n\n**`npm install`**\n');
    const linked = mount(doc, 10);
    await focusPage(linked);
    select(linked, 9, 12);
    key(linked, 'k', mod);
    expect([linked.state.selection.main.from, linked.state.selection.main.to]).toEqual([7, 20]);
    const heading = mount(doc, 10);
    setHeading(2)(heading);
    expect(text(heading)).toBe('Intro\n\n## `npm install`\n');
    const all = mount('Intro\n\n`npm run build`\n\nOutro');
    act(() => { all.dispatch({ selection: EditorSelection.range(0, all.state.doc.length) }); });
    toggleMarker('**')(all);
    expect(text(all)).toBe('**Intro**\n\n**`npm run build`**\n\n**Outro**');
  });

  it('keeps a link\'s address and an embed when Cmd+E codes a selection holding them', () => {
    const doc = 'See [the docs](https://example.com/docs) now';
    const view = mount(doc);
    act(() => { view.dispatch({ selection: EditorSelection.range(0, doc.length) }); });
    toggleInlineCode(view);
    expect(text(view)).toBe('`See `[`the docs`](https://example.com/docs)` now`');
    const embed = 'Run ![[Library/files/2026-11/shot.abc.png]] here';
    const embedded = mount(embed);
    act(() => { embedded.dispatch({ selection: EditorSelection.range(0, embed.length) }); });
    toggleInlineCode(embedded);
    expect(text(embedded)).toBe('`Run `![[Library/files/2026-11/shot.abc.png]]` here`');
  });

  it('escapes a line-start block mark when code that fills its line comes off', () => {
    const view = mount('`# not a heading`\n\n`- item`\n\n`1. x`\n\nsay `# hi`\n');
    act(() => { view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) }); });
    clearFormattingAndCode(view);
    expect(text(view)).toBe('\\# not a heading\n\n\\- item\n\n1\\. x\n\nsay # hi\n');
    const off = mount('Intro\n\n`- item`\n\nOutro', 9);
    toggleInlineCode(off);
    expect(text(off)).toBe('Intro\n\n\\- item\n\nOutro');
  });
});

describe('reaching a block from the keyboard', () => {
  it('puts the caret at the clicked character in a note\'s highlighted block', () => {
    const doc = 'Top\n\n```js\nconst x = 1;\n```\n';
    const view = mount(doc, 0, NOTE);
    const block = view.contentDOM.querySelector('.cm-md-codeblock-widget') as HTMLElement;
    const line = block.querySelector('[data-offset]') as HTMLElement;
    const one = [...line.querySelectorAll('span')].find((span) => span.textContent === '1') as HTMLElement;
    const original = document.caretRangeFromPoint;
    document.caretRangeFromPoint = () => ({ startContainer: one.firstChild, startOffset: 0 }) as unknown as Range;
    try {
      expect(blockPosition(view, block, one, new MouseEvent('mousedown'))).toBe(doc.indexOf('1;'));
    } finally {
      document.caretRangeFromPoint = original;
    }
  });

  it('focuses the framed block\'s bar on Option+F10', () => {
    const doc = 'A\n\n```sh\nls\n```\n';
    const view = mount(doc);
    const obj = objectAt(view.state, doc.indexOf('```'), 1);
    if (!obj) throw new Error('no code object');
    act(() => { view.dispatch({ effects: setFrame.of(obj) }); });
    const bar = document.createElement('div');
    bar.dataset.objectBar = 'code';
    bar.innerHTML = '<button data-bar-item="copy" tabindex="0">Copy</button>';
    document.body.append(bar);
    try {
      expect(focusObjectBar(view)).toBe(true);
      expect((document.activeElement as HTMLElement | null)?.dataset.barItem).toBe('copy');
    } finally {
      bar.remove();
    }
  });

  it('moves through every header button with the arrow keys, Diagram and Code included', () => {
    const doc = '```mermaid\nflowchart TD\n  A --> B\n```\n';
    const view = mount(doc);
    act(() => { view.dispatch({ effects: setDiagramCode.of({ at: 0, code: true }) }); });
    const header = view.contentDOM.querySelector('.cm-code-header') as HTMLElement;
    const label = header.querySelector('.cm-code-label') as HTMLElement;
    label.focus();
    const seen: string[] = [];
    for (let press = 0; press < 4; press += 1) {
      act(() => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
      seen.push((document.activeElement as HTMLElement).className);
    }
    expect(seen).toEqual(['cm-diagram-segment', 'cm-diagram-segment', 'cm-code-copy', 'cm-code-label']);
  });

  it('shows a collapsed block\'s hidden lines when the arrow keys reach them', async () => {
    const code = Array.from({ length: 60 }, (_, line) => `line ${line}`).join('\n');
    const doc = `Top\n\n\`\`\`\n${code}\n\`\`\`\nAfter\n`;
    const view = mount(doc, doc.indexOf('line 39') + 2);
    await focusPage(view);
    key(view, 'ArrowDown');
    expect(collapsedBlocks(view.state)).toEqual([]);
    expect(view.state.doc.lineAt(caret(view)).text).toBe('line 40');
    const back = mount(doc, doc.indexOf('After') + 2);
    await focusPage(back);
    key(back, 'ArrowUp');
    expect(collapsedBlocks(back.state)).toEqual([]);
    expect(back.state.doc.lineAt(caret(back)).text).toBe('line 59');
  });
});

describe('small edges of blocks', () => {
  it('leaves no blank line when a whole line next to a fence is deleted', async () => {
    const before = mount('para\n```\nab\n```\n', 0);
    await focusPage(before);
    select(before, 0, 5);
    key(before, 'Backspace');
    expect(text(before)).toBe('```\nab\n```\n');
    const after = mount('```\nab\n```\npara\n', 0);
    await focusPage(after);
    select(after, 10, 15);
    key(after, 'Backspace');
    expect(text(after)).toBe('```\nab\n```\n');
  });

  it('writes a code line when a block with none is opened', async () => {
    const doc = 'A\n\n```\n```\n\nB\n';
    const view = mount(doc);
    const obj = objectAt(view.state, doc.indexOf('```'), 1);
    if (!obj) throw new Error('no code object');
    objectKind(view.state, 'code')?.open?.(view, obj);
    expect(text(view)).toBe('A\n\n```\n\n```\n\nB\n');
    expect(caret(view)).toBe(doc.indexOf('```') + 4);
    type(view, 'x');
    expect(text(view)).toBe('A\n\n```\nx\n```\n\nB\n');
  });

  it('shows a collapsed block whole when Backspace on the line under it moves the caret into it', async () => {
    const code = Array.from({ length: 50 }, (_, line) => `line ${line}`).join('\n');
    const doc = `\`\`\`\n${code}\n\`\`\`\n\nafter`;
    const view = mount(doc, doc.length);
    await focusPage(view);
    select(view, doc.indexOf('\n\nafter') + 1);
    key(view, 'Backspace');
    expect(collapsedBlocks(view.state)).toEqual([]);
    type(view, 'Z');
    expect(text(view)).toBe(doc.replace('line 49\n```\n\n', 'line 49Z\n```\n'));
  });

  it('writes typed backticks in an HTML block as they are', async () => {
    const doc = '<div>\nhello\n</div>\n';
    const view = mount(doc, doc.indexOf('hello') + 5);
    await focusPage(view);
    act(() => { view.dispatch({ changes: { from: caret(view), insert: '\n' }, selection: { anchor: caret(view) + 1 } }); });
    type(view, '```');
    expect(text(view)).toBe('<div>\nhello\n```\n</div>\n');
  });
});

describe('the header and its menus', () => {
  it('keeps a gap between the box and a line of text right above or below it', () => {
    const view = mount('Hello world\n```py\nprint(1)\n```\nBelow\n');
    expect(view.contentDOM.querySelector('.cm-code-head')?.classList.contains('cm-code-after-text')).toBe(true);
    expect(view.contentDOM.querySelector('.cm-code-foot')?.classList.contains('cm-code-before-text')).toBe(true);
    const spaced = mount('Hello world\n\n```py\nprint(1)\n```\n\nBelow\n');
    expect(spaced.contentDOM.querySelector('.cm-code-after-text, .cm-code-before-text')).toBeNull();
  });

  it('announces the language menu\'s active option, and closes it when the page scrolls', () => {
    const view = mount('```ts\ncode\n```\n');
    const label = view.contentDOM.querySelector('.cm-code-label') as HTMLElement;
    expect(label.getAttribute('aria-haspopup')).toBe('dialog');
    act(() => { label.click(); });
    const search = document.querySelector('.opal-code-menu-search') as HTMLInputElement;
    const active = document.querySelector('.opal-code-menu-item[data-active]') as HTMLElement;
    expect(search.getAttribute('aria-activedescendant')).toBe(active.id);
    act(() => { search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); });
    expect(search.getAttribute('aria-activedescendant')).toBe((document.querySelector('.opal-code-menu-item[data-active]') as HTMLElement).id);
    act(() => { view.scrollDOM.dispatchEvent(new Event('scroll')); });
    expect(document.querySelector('.opal-code-menu')).toBeNull();
  });

  it('offers Mermaid in the bar\'s Language menu, as the header does', () => {
    const doc = '```ts\ncode\n```\n';
    const view = mount(doc);
    const obj = objectAt(view.state, 0, 1);
    if (!obj) throw new Error('no code object');
    const language = objectKind(view.state, 'code')?.actions(view.state, obj).find((action) => action.id === 'language');
    expect(language?.items?.map((item) => item.id)).toContain('mermaid');
    expect(language?.items?.filter((item) => item.checked).map((item) => item.label)).toEqual(['TypeScript']);
  });
});
