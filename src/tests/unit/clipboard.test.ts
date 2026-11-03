import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { balancedText, containerPrefix, pasteLiterallyNext, pasteSpec } from '@/renderer/features/disk-explorer/components/editor/clipboard';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { protectedRanges } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { linkAt, writeLink } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { LinkPopover } from '@/renderer/features/disk-explorer/components/editor/LinkPopover';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const DOC = '/Vault/Notes/Plan.mdo';

let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '' });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

function mount(doc: string, extra: Extension[] = []) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [markdownEditorExtensions(DOC), extra] }) });
  ensureSyntaxTree(view.state, view.state.doc.length, 5_000);
  view.dispatch({});
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
const select = (view: EditorView, anchor: number, head = anchor) => act(() => { view.dispatch({ selection: { anchor, head } }); });

/** happy-dom has no DataTransfer, so supply the minimum the handlers use. */
function clipboardData(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getData: (type: string) => data.get(type) ?? '',
    setData: (type: string, value: string) => { data.set(type, value); },
    clearData: () => data.clear(),
    get types() { return [...data.keys()]; },
    files: [] as File[],
    items: [] as DataTransferItem[],
    data,
  };
}

function clipboardEvent(view: EditorView, type: 'copy' | 'cut' | 'paste', data = clipboardData()) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: data });
  act(() => { view.contentDOM.dispatchEvent(event); });
  return { event, data };
}

/** Pastes `pasted` as ⌘V, or as ⌘⇧V with `literal`. */
function paste(view: EditorView, pasted: string, literal = false) {
  if (literal) pasteLiterallyNext(view);
  const spec = pasteSpec(view.state, pasted, literal);
  act(() => {
    if (spec) view.dispatch(spec);
    else {
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: pasted }, selection: { anchor: from + pasted.length }, userEvent: 'input.paste' });
    }
  });
}

describe('copy, cut and drag in a document', () => {
  it('write balanced Markdown for a selection that half covers bold or a link', () => {
    const view = mount('Some **bold** and a [link](https://x.com) end\n');
    const doc = text(view);
    const from = doc.indexOf('old');
    const to = doc.indexOf('ink');
    expect(balancedText(view.state, from, to)).toBe('**old** and a [l](https://x.com)');
    const inside = doc.indexOf('ol');
    expect(balancedText(view.state, inside, inside + 2)).toBe('**ol**');
    expect(balancedText(view.state, doc.indexOf('Some'), doc.indexOf(' end'))).toBe('Some **bold** and a [link](https://x.com)');
  });

  it('copies a formula whole, with its dollars, when a selection ends inside it', () => {
    const formula = protectedRanges.of((state) => {
      const doc = state.doc.toString();
      const at = doc.indexOf('$');
      return at === -1 ? [] : [{ from: at, to: doc.indexOf('$', at + 1) + 1 }];
    });
    const view = mount('Area $a^2 + b$ end\n', [formula]);
    expect(balancedText(view.state, 0, text(view).indexOf('+'))).toBe('Area $a^2 + b$');
  });

  it('copies code as it is from a selection inside it', () => {
    const view = mount('Use `a*b*c` here\n');
    const from = text(view).indexOf('a*b');
    expect(balancedText(view.state, from, from + 3)).toBe('a*b');
  });

  it('puts the balanced text on the clipboard, and does nothing with nothing selected', () => {
    const view = mount('Some **bold** text\n');
    const doc = text(view);
    select(view, doc.indexOf('old'), doc.indexOf(' text'));
    // CodeMirror's copy and drag pass the selected text through these filters.
    const output = (raw: string) => view.state.facet(EditorView.clipboardOutputFilter).reduce((written, filter) => filter(written, view.state), raw);
    const { from, to } = view.state.selection.main;
    expect(output(view.state.sliceDoc(from, to))).toBe('**old**');
    select(view, 3);
    const empty = clipboardEvent(view, 'copy', clipboardData({ 'text/plain': 'before' }));
    expect(empty.event.defaultPrevented).toBe(true);
    expect(empty.data.getData('text/plain')).toBe('before');
    const cut = clipboardEvent(view, 'cut', clipboardData({ 'text/plain': 'before' }));
    expect(cut.data.getData('text/plain')).toBe('before');
    expect(text(view)).toBe(doc);
  });

  it('cuts half of a bold word and keeps the rest bold', () => {
    const view = mount('Some **bold** text\n');
    const doc = text(view);
    select(view, doc.indexOf('ld'), doc.indexOf(' text'));
    const { from, to } = view.state.selection.main;
    expect(balancedText(view.state, from, to)).toBe('**ld**');
    act(() => { view.dispatch({ changes: { from, to }, userEvent: 'delete.cut' }); });
    expect(text(view)).toBe('Some **bo** text\n');
  });

  it('keeps the marks around text dragged away', () => {
    const view = mount('Some **bold** text\n');
    const doc = text(view);
    const from = doc.indexOf('ld');
    const to = doc.indexOf(' text');
    act(() => { view.dispatch({ changes: [{ from, to }, { from: doc.length - 1, insert: '**ld**' }], userEvent: 'move.drop' }); });
    expect(text(view)).toBe('Some **bo** text**ld**\n');
  });
});

describe('Paste and Match Style in a document', () => {
  const literal = (doc: string, at: number, pasted: string, extra: Extension[] = []) => {
    const view = mount(doc, extra);
    select(view, at);
    paste(view, pasted, true);
    return text(view);
  };

  it('keeps URLs, snake_case and a pipe outside a table as they are', () => {
    expect(literal('See \n', 4, 'https://x.com/a_b*c')).toBe('See https://x.com/a_b*c\n');
    expect(literal('See \n', 4, 'snake_case_name')).toBe('See snake_case_name\n');
    expect(literal('See \n', 4, 'a | b')).toBe('See a | b\n');
  });

  it('escapes what would become Markdown in that spot', () => {
    expect(literal('See \n', 4, '*not italic* and [x](y)')).toBe('See \\*not italic\\* and \\[x\\](y)\n');
    expect(literal('\n', 0, '# not a heading')).toBe('\\# not a heading\n');
    expect(literal('\n', 0, '- not a bullet')).toBe('\\- not a bullet\n');
  });

  it('pastes raw into inline code and into a formula', () => {
    expect(literal('Use `xy` now\n', 6, '*a* `b`')).toBe('Use `x*a* `b`y` now\n');
    const formula = protectedRanges.of((state) => {
      const at = state.doc.toString().indexOf('$');
      return at === -1 ? [] : [{ from: at, to: state.doc.toString().indexOf('$', at + 1) + 1 }];
    });
    expect(literal('Area $a b$ end\n', 7, '*x*', [formula])).toBe('Area $a*x* b$ end\n');
  });

  it('is what the paste event does after ⌘⇧V', () => {
    const view = mount('See \n');
    select(view, 4);
    pasteLiterallyNext(view);
    clipboardEvent(view, 'paste', clipboardData({ 'text/plain': '*x*' }));
    expect(text(view)).toBe('See \\*x\\*\n');
  });
});

describe('paste in a document', () => {
  it('links a selection with a pasted URL, and changes a link\'s address over its text', () => {
    const view = mount('See the site now\n');
    select(view, 4, 12);
    clipboardEvent(view, 'paste', clipboardData({ 'text/plain': 'https://example.com' }));
    expect(text(view)).toBe('See [the site](https://example.com) now\n');
    const link = mount('See [the site](https://a.com) now\n');
    select(link, 5, 8);
    clipboardEvent(link, 'paste', clipboardData({ 'text/plain': 'https://b.com' }));
    expect(text(link)).toBe('See [the site](https://b.com) now\n');
  });

  it('keeps three pasted lines inside a callout', () => {
    const view = mount('> [!note] Title\n> first\n\nAfter\n');
    select(view, 23);
    paste(view, ' one\ntwo\n\n- three');
    expect(text(view)).toBe('> [!note] Title\n> first one\n> two\n>\n> - three\n\nAfter\n');
  });

  it('keeps three pasted lines inside a nested list item', () => {
    const view = mount('- a\n  - b\n- c\n');
    select(view, 9);
    paste(view, ' one\ntwo\n\n- three');
    expect(text(view)).toBe('- a\n  - b one\n    two\n\n    - three\n- c\n');
    expect(containerPrefix(view.state, 9)).toBe('    ');
  });

  it('prefixes lines dropped into a quote', () => {
    const view = mount('> quoted\n');
    act(() => { view.dispatch({ changes: { from: 8, insert: ' x\ny' }, userEvent: 'input.drop' }); });
    expect(text(view)).toBe('> quoted x\n> y\n');
  });
});

describe('Cmd+K over partly formatted text', () => {
  it('writes balanced marks', () => {
    const view = mount('**bold** t\n');
    const { state } = view;
    const from = text(view).indexOf('old');
    const range = { from, to: text(view).indexOf('t\n') + 1 };
    act(() => { view.dispatch(writeLink(state, range, state.sliceDoc(range.from, range.to), 'https://x.com', linkAt(state, range.from))); });
    expect(text(view)).toBe('**b**[**old** t](https://x.com)\n');
    const whole = mount('a **bold** b\n');
    const all = { from: 2, to: 10 };
    act(() => { whole.dispatch(writeLink(whole.state, all, whole.state.sliceDoc(2, 10), 'https://x.com', null)); });
    expect(text(whole)).toBe('a [**bold**](https://x.com) b\n');
    const after = mount('a **bold** b\n');
    const start = { from: 0, to: 5 };
    act(() => { after.dispatch(writeLink(after.state, start, after.state.sliceDoc(0, 5), 'https://x.com', null)); });
    expect(text(after)).toBe('[a **b**](https://x.com)**old** b\n');
  });
});

describe('the link form', () => {
  const form = (view: EditorView, from: number, to: number) => render(createElement(TooltipProvider, null,
    createElement(LinkPopover, { view, editor: { from, to, editing: true } })));

  it('shows the visible text, and keeps the link\'s formatting when the text stays', async () => {
    const user = userEvent.setup();
    const view = mount('See [**the** site](https://a.com) now\n');
    view.focus = vi.fn();
    const link = linkAt(view.state, 6);
    if (!link) throw new Error('no link');
    form(view, link.from, link.to);
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('the site');
    const address = screen.getByRole('textbox', { name: 'Link' });
    await user.clear(address);
    await user.type(address, 'https://b.com{Enter}');
    expect(text(view)).toBe('See [**the** site](https://b.com) now\n');
  });

  it('writes typed stars, underscores, backticks and brackets so they show as typed', async () => {
    const user = userEvent.setup();
    const view = mount('See this now\n');
    view.focus = vi.fn();
    form(view, 4, 8);
    const field = screen.getByRole('textbox', { name: 'Text' });
    await user.clear(field);
    await user.type(field, 'a*b_c`d[[e]');
    await user.type(screen.getByRole('textbox', { name: 'Link' }), 'https://x.com{Enter}');
    expect(text(view)).toBe('See [a\\*b\\_c\\`d\\[e\\]](https://x.com) now\n');
  });
});
