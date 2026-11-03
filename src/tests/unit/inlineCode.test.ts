import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { clearFormattingAndCode, codeContent, codeSpan, literalText } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { hiddenRanges } from '@/renderer/features/disk-explorer/components/editor/livePreview';
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
});

function mount(doc: string, at = 0) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: at }, extensions: markdownEditorExtensions(DOC) }) });
  ensureSyntaxTree(view.state, doc.length, 5_000);
  view.dispatch({});
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();

function type(view: EditorView, typed: string) {
  act(() => {
    const at = view.state.selection.main.head;
    view.dispatch({ changes: { from: at, insert: typed }, selection: { anchor: at + typed.length }, userEvent: 'input.type' });
  });
}

describe('inline code', () => {
  it('keeps a typed backtick literal, growing the delimiters so the span stays whole', () => {
    const view = mount('a `bc` d\n', 4);
    type(view, '`');
    expect(text(view)).toBe('a ``b`c`` d\n');
    expect(view.state.selection.main.head).toBe(text(view).indexOf('c'));
    type(view, 'x');
    expect(text(view)).toBe('a ``b`xc`` d\n');
    const edge = mount('a `bc` d\n', 3);
    type(edge, '`');
    expect(text(edge)).toBe('a `` `bc `` d\n');
  });

  it('hides one space of padding on both sides', () => {
    const doc = 'x `` `tick` `` y\n';
    const view = mount(doc);
    const hidden = hiddenRanges(view.state, 0, doc.length).map((range) => doc.slice(range.from, range.to));
    expect(hidden).toEqual(['``', ' ', ' ', '``']);
    expect(view.contentDOM.querySelector('.cm-md-code')?.textContent).toBe('`tick`');
  });

  it('writes delimiters one longer than the longest run inside, padded when needed', () => {
    expect(codeSpan('a')).toBe('`a`');
    expect(codeSpan('a`b')).toBe('``a`b``');
    expect(codeSpan('`a')).toBe('`` `a ``');
    expect(codeSpan('a``b')).toBe('```a``b```');
    expect(codeSpan(' a ')).toBe('`  a  `');
    expect(codeContent(' a ')).toBe('a');
    expect(codeContent('  ')).toBe('  ');
    expect(literalText('a`b*c_d')).toBe('a\\`b\\*c\\_d');
  });

  it('takes code off on Clear formatting, without padding, escaping backticks that would pair', () => {
    const view = mount('see `` a`b `` and **bold** `x`\n');
    act(() => { view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length - 1) }); });
    clearFormattingAndCode(view);
    expect(text(view)).toBe('see a\\`b and bold x\n');
  });
});
