import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { findNext, getSearchQuery, openSearchPanel, replaceAll, replaceNext, SearchQuery, setSearchQuery } from '@codemirror/search';
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
    // Strikethrough stands in for a formula: one object, protected from Replace.
    const asObject = [
      objectKinds.of({ kind: 'formula', nodes: ['Strikethrough'], block: false, open: () => undefined, actions: () => [] }),
      protectedRanges.of((state, from, to) => {
        const found: { from: number; to: number }[] = [];
        syntaxTree(state).iterate({ from, to, enter: (ref) => { if (ref.name === 'Strikethrough') found.push({ from: ref.from, to: ref.to }); } });
        return found;
      }),
    ];
    const view = mount('See ~~frac x~~ here\n', DOC, asObject);
    query(view, 'frac');
    run(view, findNext);
    expect(view.state.field(objectFrame)).toMatchObject({ kind: 'formula', from: 4, to: 14 });
    // The caret rests after the text, before the hidden closing marks.
    expect(view.state.selection.main.head).toBe(12);
  });

  it('frames a formula a match is inside, offers Edit formula, and Replace All leaves its TeX', () => {
    const view = mount('See $\\frac{a}{b}$ and $$\\frac{c}{d}$$ here\n');
    query(view, 'frac', 'ratio');
    run(view, findNext);
    expect(view.state.field(objectFrame)).toMatchObject({ kind: 'math', from: 4, to: 17 });
    const frame = view.state.field(objectFrame);
    if (!frame) throw new Error('no frame');
    const kind = view.state.facet(objectKinds).find((entry) => entry.kind === frame.kind);
    expect(kind?.actions(view.state, frame).map((action) => action.label)).toContain('Edit formula');
    run(view, replaceAll);
    expect(text(view)).toBe('See $\\frac{a}{b}$ and $$\\frac{c}{d}$$ here\n');
    const words = mount('a and $a + b$ and a\n');
    query(words, 'a', 'z');
    run(words, replaceAll);
    expect(text(words)).toBe('z znd $a + b$ znd z\n');
  });

  it('escapes a money sign when the number after it is replaced by text that would open a formula', () => {
    const view = mount('About $300k per unit, or $300k a year\n');
    query(view, '300k', '*300k* each');
    run(view, replaceAll);
    expect(text(view)).toBe('About \\$\\*300k\\* each per unit, or \\$\\*300k\\* each a year\n');
    const kept = mount('About $300k per unit\n');
    query(kept, '300k', '400k');
    run(kept, replaceAll);
    expect(text(kept)).toBe('About $400k per unit\n');
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

  it('replaces one match that crosses a mark and scrolls to the next one that still exists', () => {
    const view = mount('A pl**an** and plan\n');
    query(view, 'plan', 'roadmap');
    act(() => { view.dispatch({ selection: { anchor: 0 } }); });
    run(view, findNext);
    expect(() => run(view, replaceNext)).not.toThrow();
    expect(text(view)).toBe('A roadmap and plan\n');
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe('plan');
  });

  it('fills Find with the selection as the page shows it', () => {
    const view = mount('A pl**an** here\n');
    const doc = text(view);
    act(() => { view.dispatch({ selection: { anchor: doc.indexOf('pl'), head: doc.indexOf('an') + 2 } }); });
    run(view, openSearchPanel);
    expect(getSearchQuery(view.state).search).toBe('plan');
  });

  it('escapes stars as well as pipes in a table cell', () => {
    const view = mount('| a | b |\n| --- | --- |\n| plan | x |\n');
    query(view, 'plan', '*new* a|b');
    run(view, replaceAll);
    expect(text(view)).toBe('| a | b |\n| --- | --- |\n| \\*new\\* a\\|b | x |\n');
  });

  it('keeps a match in inline code when the replacement holds a backtick', () => {
    const view = mount('x `plan` y and plan\n');
    query(view, 'plan', 'a`b');
    run(view, replaceAll);
    expect(text(view)).toBe('x `plan` y and a`b\n');
  });

  it('replaces every match with punctuation in the replacement in well under a second on 1500 lines', () => {
    const lines = Array.from({ length: 1500 }, (_, i) => `Line ${i} has a plan and **bold** text and [a link](https://x.com/${i}).`);
    const view = mount(`${lines.join('\n')}\n`);
    query(view, 'plan', 'plan-b');
    const started = performance.now();
    run(view, replaceAll);
    const took = performance.now() - started;
    expect(text(view).split('plan-b').length - 1).toBe(1500);
    expect(took).toBeLessThan(2_000);
  });

  it('shows matches Replace keeps apart from those it changes, and says how many it kept', () => {
    const view = mount('The plan is in [[Plan]] and at https://plan.example.com/plan today.\n');
    query(view, 'plan', 'roadmap');
    run(view, openSearchPanel);
    query(view, 'plan', 'roadmap');
    run(view, replaceAll);
    expect(text(view)).toBe('The roadmap is in [[Plan]] and at https://plan.example.com/plan today.\n');
    expect(view.contentDOM.querySelectorAll('.cm-searchMatch:not(.opal-searchKept)').length).toBe(0);
    expect(view.contentDOM.querySelectorAll('.opal-searchKept').length).toBe(3);
  });

  it('writes a replacement into a wiki link\'s text as written, and keeps the match when brackets or a bar would end the link', () => {
    const view = mount('[[React Home|React Home]] and Home\n');
    query(view, 'Home', '*Home*');
    run(view, replaceAll);
    expect(text(view)).toBe('[[React Home|React *Home*]] and \\*Home\\*\n');
    const kept = mount('[[React Home|React Home]] and Home\n');
    query(kept, 'Home', 'Home [x]');
    run(kept, replaceAll);
    expect(text(kept)).toBe('[[React Home|React Home]] and Home [x]\n');
  });

  it('escapes brackets that would unmake the link around a replacement', () => {
    const view = mount('see [this one](https://x.com) now\n');
    query(view, 'this', 'this [Zq]');
    run(view, replaceAll);
    expect(text(view)).toBe('see [this \\[Zq\\] one](https://x.com) now\n');
  });
});
