import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { findNext, getSearchQuery, replaceAll, replaceNext, SearchQuery, setSearchQuery } from '@codemirror/search';
import { undo } from '@codemirror/commands';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { objectKinds, protectedRanges } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { drawnBlockAt } from '@/renderer/features/disk-explorer/components/editor/livePreview';
import { VisibleQuery } from '@/renderer/features/disk-explorer/components/editor/visibleSearch';
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

function mount(doc: string, page = DOC, extra: Extension[] = []) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [markdownEditorExtensions(page), extra] }) });
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

const text = (view: EditorView) => view.state.doc.toString();
const query = (view: EditorView, search: string, replace = '') =>
  act(() => { view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search, replace })) }); });
const run = (view: EditorView, command: (view: EditorView) => boolean) => act(() => { command(view); });

describe('Find and Replace in a document', () => {
  it('Replace All changes only visible text: wiki link targets and addresses stay', () => {
    const view = mount('A plan, [[Plan]], [[Plan|the plan]], [plan doc](https://x.com/plan) and https://plan.com/plan.\n');
    query(view, 'plan', 'roadmap');
    run(view, replaceAll);
    expect(text(view)).toBe('A roadmap, [[Plan]], [[Plan|the roadmap]], [roadmap doc](https://x.com/plan) and https://plan.com/plan.\n');
  });

  it('turns the panel\'s query into one over visible text, in documents only', () => {
    const view = mount('x\n');
    query(view, 'x');
    expect(getSearchQuery(view.state)).toBeInstanceOf(VisibleQuery);
    const note = mount('x\n', NOTE);
    query(note, 'x');
    expect(getSearchQuery(note.state)).not.toBeInstanceOf(VisibleQuery);
  });

  it('finds matches across formatting and keeps the marks around them', () => {
    const view = mount('**plan** and *plan* and pl**an**s\n');
    query(view, 'plan', 'roadmap');
    run(view, replaceAll);
    expect(text(view)).toBe('**roadmap** and *roadmap* and roadmaps\n');
  });

  it('makes Replace All one undo step', () => {
    const view = mount('plan **plan** plan\n');
    query(view, 'plan', 'roadmap');
    run(view, replaceAll);
    expect(text(view)).toBe('roadmap **roadmap** roadmap\n');
    act(() => { undo(view); });
    expect(text(view)).toBe('plan **plan** plan\n');
  });

  it('writes the replacement literally: stars escaped, a pipe in a table cell escaped', () => {
    const view = mount('a plan here\n');
    query(view, 'plan', '*not italic*');
    run(view, replaceAll);
    expect(text(view)).toBe('a \\*not italic\\* here\n');
    const under = mount('a plan here\n');
    query(under, 'plan', '_x_ and snake_case');
    run(under, replaceAll);
    expect(text(under)).toBe('a \\_x\\_ and snake_case here\n');
    const table = mount('| a | b |\n|---|---|\n| plan | x |\n');
    query(table, 'plan', 'a|b');
    run(table, replaceAll);
    expect(text(table)).toBe('| a | b |\n|---|---|\n| a\\|b | x |\n');
  });

  it('replaces the selected match with Replace and moves on', () => {
    const view = mount('plan [plan](https://x.com/plan)\n');
    query(view, 'plan', 'idea');
    run(view, findNext);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('plan');
    run(view, replaceNext);
    expect(text(view)).toBe('idea [plan](https://x.com/plan)\n');
    run(view, replaceNext);
    expect(text(view)).toBe('idea [idea](https://x.com/plan)\n');
  });

  it('never replaces inside a protected range', () => {
    const formula = protectedRanges.of((state, from, to) => {
      const found: { from: number; to: number }[] = [];
      const doc = state.doc.toString();
      for (let at = doc.indexOf('$'); at !== -1; at = doc.indexOf('$', at + 1)) {
        const end = doc.indexOf('$', at + 1);
        if (end === -1) break;
        if (end + 1 >= from && at <= to) found.push({ from: at, to: end + 1 });
        at = end;
      }
      return found;
    });
    const view = mount('a and $a + b$ and a\n', DOC, [formula]);
    query(view, 'a', 'z');
    run(view, replaceAll);
    expect(text(view)).toBe('z znd $a + b$ znd z\n');
  });

  it('frames the object a match inside a protected range belongs to', () => {
    // Inline code stands in for a formula: one object, protected from Replace.
    const asObject = [
      objectKinds.of({ kind: 'formula', nodes: ['InlineCode'], block: false, open: () => undefined, actions: () => [] }),
      protectedRanges.of((state, from, to) => {
        const found: { from: number; to: number }[] = [];
        syntaxTree(state).iterate({ from, to, enter: (ref) => { if (ref.name === 'InlineCode') found.push({ from: ref.from, to: ref.to }); } });
        return found;
      }),
    ];
    const view = mount('See `frac x` here\n', DOC, asObject);
    query(view, 'frac');
    run(view, findNext);
    expect(view.state.field(objectFrame)).toMatchObject({ kind: 'formula', from: 4, to: 12 });
    expect(view.state.selection.main.head).toBe(12);
  });

  it('opens a drawn table\'s source with the match selected', async () => {
    const view = mount('Intro\n\n| a | b |\n|---|---|\n| needle | x |\n\nEnd\n');
    await focusPage(view);
    act(() => { view.dispatch({ selection: { anchor: 0 } }); });
    const at = text(view).indexOf('needle');
    expect(drawnBlockAt(view.state, at)).not.toBeNull();
    query(view, 'needle');
    run(view, findNext);
    expect(view.state.selection.main.from).toBe(at);
    expect(view.state.selection.main.to).toBe(at + 6);
    expect(drawnBlockAt(view.state, at)).toBeNull();
  });
});
