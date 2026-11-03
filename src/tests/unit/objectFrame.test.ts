import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { EditorState, Transaction, type Extension } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { objectKinds, type ObjectKind } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const DOC = '/Vault/Notes/Plan.mdo';

let views: EditorView[] = [];
let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '' });
  open = vi.fn();
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

/** A block kind for rules and an inline kind for inline code, registered by the test the way a feature would. */
const kinds = (): Extension => [
  objectKinds.of({ kind: 'rule', nodes: ['HorizontalRule'], block: true, open: (view, obj) => open(obj), actions: () => [] } satisfies ObjectKind),
  objectKinds.of({ kind: 'inline-code', nodes: ['InlineCode'], block: false, open: () => undefined, actions: () => [] } satisfies ObjectKind),
];

function mount(doc: string, at: number) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: at }, extensions: [markdownEditorExtensions(DOC), kinds()] }) });
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
const frame = (view: EditorView) => view.state.field(objectFrame);
const caret = (view: EditorView) => view.state.selection.main.head;

/** A key press as the browser sends it, through every handler. Returns whether a handler took it. */
function key(view: EditorView, name: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  act(() => { view.contentDOM.dispatchEvent(event); });
  return event.defaultPrevented;
}

/** Types as the browser does after a key it was left: the text at the caret. */
function type(view: EditorView, typed: string) {
  act(() => {
    const at = caret(view);
    const insert = () => view.state.update({ changes: { from: at, insert: typed }, selection: { anchor: at + typed.length }, userEvent: 'input.type' });
    if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, at, at, typed, insert))) view.dispatch(insert());
  });
}

function clipboardEvent(type: 'copy' | 'cut') {
  const data = new Map<string, string>();
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { setData: (kind: string, value: string) => data.set(kind, value), getData: (kind: string) => data.get(kind) ?? '' } });
  return { event, data };
}

const RULE = 'text\n***\nmore\n';
const AFTER = RULE.indexOf('more');

describe('the object frame', () => {
  it('frames a block on the first Backspace, holds against a held key, and removes it on a new press', () => {
    const view = mount(RULE, AFTER);
    expect(key(view, 'Backspace')).toBe(true);
    expect(frame(view)).toMatchObject({ kind: 'rule', from: 5, to: 8 });
    expect(text(view)).toBe(RULE);
    expect(key(view, 'Backspace', { repeat: true })).toBe(true);
    expect(text(view)).toBe(RULE);
    expect(frame(view)).not.toBeNull();
    key(view, 'Backspace');
    expect(text(view)).toBe('text\n\nmore\n');
    expect(frame(view)).toBeNull();
    expect(caret(view)).toBe('text\n\n'.length);
  });

  it('frames from the line above with Delete, and keeps no blank line at the page\'s edges', () => {
    const view = mount(RULE, 4);
    key(view, 'Delete');
    expect(frame(view)).toMatchObject({ kind: 'rule' });
    key(view, 'Delete');
    expect(text(view)).toBe('text\n\nmore\n');
    expect(caret(view)).toBe(4);
    // Backspace on the line under a blank line takes the blank line first.
    const top = mount('***\n\nmore\n', 4);
    key(top, 'Backspace');
    key(top, 'Backspace');
    expect(text(top)).toBe('more\n');
    const bottom = mount('text\n\n***\n\n', 10);
    key(bottom, 'Backspace');
    key(bottom, 'Backspace');
    expect(text(bottom)).toBe('text\n');
  });

  it('frames and removes through the Backspace command too, as a test or menu runs it', () => {
    const view = mount(RULE, AFTER);
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(frame(view)).not.toBeNull();
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(text(view)).toBe('text\n\nmore\n');
  });

  it('lets a typed key, paste, drop or an input method land at the caret and delete nothing', () => {
    for (const input of ['key', 'paste', 'drop', 'compositionstart'] as const) {
      const view = mount(RULE, AFTER);
      key(view, 'Backspace');
      expect(frame(view)).not.toBeNull();
      if (input === 'key') expect(key(view, 'x')).toBe(false);
      else act(() => { view.contentDOM.dispatchEvent(new Event(input, { bubbles: true, cancelable: true })); });
      expect(frame(view)).toBeNull();
      type(view, 'x');
      expect(text(view)).toBe('text\n***\nxmore\n');
    }
  });

  it('opens the object on Enter, does nothing on Space and Tab, and clears on arrows and Escape', () => {
    const view = mount(RULE, AFTER);
    key(view, 'Backspace');
    expect(key(view, ' ')).toBe(true);
    expect(key(view, 'Tab')).toBe(true);
    expect(text(view)).toBe(RULE);
    expect(frame(view)).not.toBeNull();
    key(view, 'Enter');
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rule', from: 5, to: 8 }));
    expect(text(view)).toBe(RULE);
    for (const name of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape']) {
      act(() => { view.dispatch({ selection: { anchor: AFTER } }); });
      key(view, 'Backspace');
      expect(frame(view)).not.toBeNull();
      key(view, name);
      expect(frame(view)).toBeNull();
      expect(text(view)).toBe(RULE);
    }
  });

  it('copies the framed object\'s Markdown on Cmd+C, and cuts it on Cmd+X', () => {
    const view = mount(RULE, AFTER);
    key(view, 'Backspace');
    expect(key(view, 'c', { metaKey: true })).toBe(false);
    const copy = clipboardEvent('copy');
    act(() => { view.contentDOM.dispatchEvent(copy.event); });
    expect(copy.data.get('text/plain')).toBe('***');
    expect(text(view)).toBe(RULE);
    expect(frame(view)).not.toBeNull();
    const cut = clipboardEvent('cut');
    act(() => { view.contentDOM.dispatchEvent(cut.event); });
    expect(cut.data.get('text/plain')).toBe('***');
    expect(text(view)).toBe('text\n\nmore\n');
  });

  it('removes an inline object in one press', () => {
    const doc = 'a `x` b\n';
    const view = mount(doc, doc.indexOf(' b'));
    key(view, 'Backspace');
    expect(text(view)).toBe('a  b\n');
    expect(frame(view)).toBeNull();
    const forward = mount(doc, 2);
    key(forward, 'Delete');
    expect(text(forward)).toBe('a  b\n');
  });

  it('follows an agent\'s edit elsewhere and clears on one inside the object', () => {
    const view = mount(RULE, AFTER);
    key(view, 'Backspace');
    const remote = (from: number, to: number, insert: string) => act(() => {
      view.dispatch({ changes: { from, to, insert }, annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)] });
    });
    remote(0, 0, 'Some ');
    expect(frame(view)).toMatchObject({ kind: 'rule', from: 10, to: 13 });
    remote(11, 12, '-');
    expect(frame(view)).toBeNull();
    // A second press never removes what the agent left.
    key(view, 'Backspace');
    expect(text(view)).toContain('*-*');
  });

  it('clears on a click elsewhere, which moves the caret', () => {
    const view = mount(RULE, AFTER);
    key(view, 'Backspace');
    act(() => { view.dispatch({ selection: { anchor: 0 } }); });
    expect(frame(view)).toBeNull();
  });
});
