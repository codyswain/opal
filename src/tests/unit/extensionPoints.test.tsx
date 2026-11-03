import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { EditorState, type Extension, type StateCommand, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, runScopeHandlers } from '@codemirror/view';
import { Table } from 'lucide-react';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import {
  blockRenderers,
  deleteHandlers,
  insertItems,
  nodeDecorators,
  objectAt,
  objectKinds,
  protectedRanges,
  treeFor,
} from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { selectedLines, setHeading, toggleMarker } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { drawnBlockAt, hiddenRanges } from '@/renderer/features/disk-explorer/components/editor/livePreview';
import { MarkdownEditor } from '@/renderer/features/disk-explorer/components/editor/MarkdownEditor';
import { objectFrame, setFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const toast = vi.hoisted(() => vi.fn());
vi.mock('sonner', async (importOriginal) => ({ ...(await importOriginal<typeof import('sonner')>()), toast }));

const NOTE = '/Vault/Notes/Plan.md';
const DOC = '/Vault/Notes/Plan.mdo';

let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [NOTE]: '', [DOC]: '' });
  toast.mockClear();
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

function mount(doc: string, extensions: Extension, page = NOTE, at = 0) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: at }, extensions: [markdownEditorExtensions(page), extensions] }) });
  views.push(view);
  return view;
}

class TestWidget extends WidgetType {
  ignoreEvent() { return false; }

  toDOM() {
    const element = document.createElement('div');
    element.className = 'test-block';
    element.setAttribute('data-object', '');
    return element;
  }
}

/** Runs a command on a state and returns the text it leaves. */
function run(state: EditorState, command: StateCommand): string {
  let result: Transaction | null = null;
  command({ state, dispatch: (tr) => { result = tr; } });
  return (result as Transaction | null)?.newDoc.toString() ?? state.doc.toString();
}

describe('node decorators', () => {
  const doc = 'a **b** c\n';
  const marks = (view: EditorView) => hiddenRanges(view.state, 0, doc.length).map(({ from, to, unit }) => [from, to, unit]);

  it('run before the built-in case, which still runs when they return false', () => {
    const decorate = vi.fn(() => false);
    const view = mount(doc, nodeDecorators.of({ nodes: ['StrongEmphasis'], decorate }));
    expect(marks(view)).toEqual([[2, 4, false], [5, 7, false]]);
    expect(decorate).toHaveBeenCalledWith(expect.objectContaining({ docMode: false, page: NOTE }), expect.objectContaining({ name: 'StrongEmphasis', from: 2, to: 7 }));
  });

  it('skip the built-in case and the node\'s children when they return true, and can mark units', () => {
    const view = mount(doc, nodeDecorators.of({
      nodes: ['StrongEmphasis'],
      decorate: (ctx, node) => {
        ctx.out.push(Decoration.mark({ class: 'test-strong' }).range(node.from, node.to));
        ctx.unit(node.from, node.to);
        return true;
      },
    }));
    expect(marks(view)).toEqual([[2, 7, true]]);
    expect(view.contentDOM.querySelector('.test-strong')).toHaveTextContent('**b**');
  });
});

describe('block renderers', () => {
  it('draw a node as a block, and a null or undefined widget falls back as documented', () => {
    const table = '| a |\n|---|\n| 1 |\n';
    const rule = mount('text\n\n***\n', blockRenderers.of({ nodes: ['HorizontalRule'], widget: () => new TestWidget() }));
    expect(drawnBlockAt(rule.state, 7)).toEqual({ from: 6, to: 9 });
    expect(rule.contentDOM.querySelector('.test-block')).not.toBeNull();
    const none = mount(table, blockRenderers.of({ nodes: ['Table'], widget: () => null }));
    expect(drawnBlockAt(none.state, 0)).toBeNull();
    const passed = mount(table, blockRenderers.of({ nodes: ['Table'], widget: () => undefined }));
    expect(drawnBlockAt(passed.state, 0)).toEqual({ from: 0, to: table.length - 1 });
  });
});

describe('protected ranges', () => {
  it('keep formatting out of them: bold goes around one on a line, and lines one covers whole keep their bytes', () => {
    const doc = 'Energy $E=mc^2$ here\n| a |\n';
    const formula = { from: doc.indexOf('$'), to: doc.indexOf('$ here') + 1 };
    const table = { from: doc.indexOf('|'), to: doc.length - 1 };
    const view = mount(doc, protectedRanges.of(() => [formula, table]));
    const across = view.state.update({ selection: { anchor: 0, head: doc.indexOf('mc') } }).state;
    expect(run(across, toggleMarker('**'))).toBe('**Energy $E=mc^2$** here\n| a |\n');
    const all = view.state.update({ selection: { anchor: 0, head: doc.length } }).state;
    expect(selectedLines(all).map((line) => line.number)).toEqual([1]);
    expect(run(all, setHeading(2))).toBe('## Energy $E=mc^2$ here\n| a |\n');
  });
});

describe('object kinds', () => {
  it('find the object at a position, narrowed by their test', () => {
    const doc = 'a `x` b\n\n***\n';
    const view = mount(doc, [
      objectKinds.of({ kind: 'code', nodes: ['InlineCode'], block: false, test: (state, node) => state.sliceDoc(node.from, node.to) !== '`y`', open: () => undefined, actions: () => [] }),
      objectKinds.of({ kind: 'rule', nodes: ['HorizontalRule'], block: true, open: () => undefined, actions: () => [] }),
    ]);
    expect(objectAt(view.state, 2, 1)).toEqual({ kind: 'code', from: 2, to: 5, node: 'InlineCode' });
    expect(objectAt(view.state, 5, -1)).toEqual({ kind: 'code', from: 2, to: 5, node: 'InlineCode' });
    expect(objectAt(view.state, 3, 0)).toEqual({ kind: 'code', from: 2, to: 5, node: 'InlineCode' });
    expect(objectAt(view.state, 9, 1)).toEqual({ kind: 'rule', from: 9, to: 12, node: 'HorizontalRule' });
    expect(objectAt(mount('a `y` b\n', objectKinds.of({ kind: 'code', nodes: ['InlineCode'], block: false, test: (state, node) => state.sliceDoc(node.from, node.to) !== '`y`', open: () => undefined, actions: () => [] })).state, 2, 1)).toBeNull();
  });

  it('fill the bar for a framed object, and a click on a widget marked as one frames it', async () => {
    const remove = vi.fn();
    installMarkdownApi({ [DOC]: 'text\n\n***\n' });
    const kinds = objectKinds.of({
      kind: 'rule',
      nodes: ['HorizontalRule'],
      block: true,
      open: () => undefined,
      destination: () => 'Horizontal line',
      actions: () => [{ id: 'remove', label: 'Remove', run: remove }, { id: 'more', label: 'More', items: [{ id: 'copy', label: 'Copy as Markdown', run: vi.fn() }] }],
    });
    render(<TooltipProvider><MarkdownEditor path={DOC} extensions={[kinds, blockRenderers.of({ nodes: ['HorizontalRule'], widget: () => new TestWidget() })]} /></TooltipProvider>);
    const view = EditorView.findFromDOM(await screen.findByTestId('markdown-editor')) as EditorView;
    view.focus = vi.fn();
    const block = view.contentDOM.querySelector('.test-block') as Element;
    act(() => { block.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 })); });
    expect(view.state.field(objectFrame)).toEqual({ kind: 'rule', from: 6, to: 9, node: 'HorizontalRule' });
    expect(view.state.selection.main.head).toBe(10);
    // happy-dom has no layout, so the bar stays hidden where it would be measured.
    const bar = await screen.findByRole('toolbar', { name: 'rule, Horizontal line', hidden: true });
    expect(within(bar).getByText('Horizontal line')).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Remove', hidden: true }));
    expect(remove).toHaveBeenCalledWith(view, expect.objectContaining({ kind: 'rule', from: 6, to: 9 }));
    expect(within(bar).getByRole('button', { name: 'More', hidden: true })).toBeInTheDocument();
    act(() => { view.dispatch({ effects: setFrame.of(null) }); });
    expect(screen.queryByRole('toolbar', { name: 'rule, Horizontal line', hidden: true })).toBeNull();
  });
});

describe('delete handlers', () => {
  it('run by priority before doc mode\'s own Backspace, with the key event', () => {
    const calls: string[] = [];
    const view = mount('ab\n', [
      deleteHandlers.of({ priority: 1, run: () => { calls.push('low'); return true; } }),
      deleteHandlers.of({ priority: 5, run: (_view, dir, event) => { calls.push(`high ${dir} ${event?.key}`); return false; } }),
    ], DOC, 2);
    act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })); });
    expect(calls).toEqual(['high -1 Backspace', 'low']);
    expect(view.state.doc.toString()).toBe('ab\n');
    // Without a key event, as when a command runs, they get null.
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Delete' }), 'editor'); });
    expect(calls.slice(2)).toEqual(['high 1 undefined', 'low']);
  });
});

describe('insert items', () => {
  it('list in the toolbar\'s Insert menu by order, with Image… first', async () => {
    const insertDrawing = vi.fn();
    installMarkdownApi({ [DOC]: 'Text\n' });
    render(<TooltipProvider><MarkdownEditor path={DOC} extensions={[
      insertItems.of({ id: 'drawing', label: 'Drawing', icon: Table, order: 25, run: insertDrawing }),
    ]} /></TooltipProvider>);
    const view = EditorView.findFromDOM(await screen.findByTestId('markdown-editor')) as EditorView;
    view.focus = vi.fn();
    const user = userEvent.setup();
    await user.click(within(screen.getByRole('toolbar', { name: 'Formatting' })).getByRole('button', { name: 'Insert' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Image…', 'Table', 'Code block⌥⌘C', 'Drawing', 'Callout', 'Equation⇧⌘E', 'Horizontal line']);
    await user.click(items[3]);
    expect(insertDrawing).toHaveBeenCalledWith(view);
  });
});

describe('treeFor', () => {
  it('gives the tree up to a position, or null with a status message when there is none', () => {
    const view = mount('# Title\n\nText\n', []);
    expect(treeFor(view.state, view.state.doc.length)?.length).toBe(view.state.doc.length);
    expect(toast).not.toHaveBeenCalled();
    expect(treeFor(EditorState.create({ doc: 'plain' }), 5)).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
