import { afterEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { setHeading } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { formatState } from '@/renderer/features/disk-explorer/components/editor/formatState';
import { hiddenRanges } from '@/renderer/features/disk-explorer/components/editor/livePreview';

const DOC = '/Vault/Notes/Plan.mdo';

let views: EditorView[] = [];

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
});

/** A document with the caret at "‸". */
function mount(marked: string) {
  const at = marked.indexOf('‸');
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: marked.replace('‸', ''), selection: { anchor: at }, extensions: markdownEditorExtensions(DOC) }) });
  views.push(view);
  return view;
}

const marked = (view: EditorView) => {
  const doc = view.state.doc.toString();
  const head = view.state.selection.main.head;
  return `${doc.slice(0, head)}‸${doc.slice(head)}`;
};

/** Presses `key` at the "‸" and gives back the page with "‸" at the caret. */
function press(text: string, key: string): string {
  const view = mount(text);
  act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key }), 'editor'); });
  return marked(view);
}

describe('Enter and Backspace on headings in a document', () => {
  it('puts an empty line above a heading on Enter at its start, keeping its style', () => {
    expect(press('Intro\n\n## ‸Head\n', 'Enter')).toBe('Intro\n\n\n## ‸Head\n');
    expect(press('> ## ‸Head\n', 'Enter')).toBe('>\n> ## ‸Head\n');
  });

  it('makes both halves headings on Enter in the middle', () => {
    expect(press('## He‸ad\n', 'Enter')).toBe('## He\n## ‸ad\n');
    expect(press('# Big title‸ here\n', 'Enter')).toBe('# Big title\n# ‸here\n');
  });

  it('starts a normal line past closing marks on Enter at the end', () => {
    expect(press('# Title‸ #\nNext\n', 'Enter')).toBe('# Title #\n‸\nNext\n');
    expect(press('## Head‸\nNext\n', 'Enter')).toBe('## Head\n‸\nNext\n');
  });

  it('takes only the blank line on Backspace at the start of a heading under one', () => {
    expect(press('para\n\n## ‸Head\n', 'Backspace')).toBe('para\n## ‸Head\n');
  });
});

describe('setext headings in a document', () => {
  it('hides the underline as one place with the end of the heading', () => {
    const view = mount('Title‸\n===\n\nnext\n');
    const units = hiddenRanges(view.state, 0, view.state.doc.length).filter((range) => range.unit);
    expect(units).toContainEqual({ from: 5, to: 10, caretAfter: false, unit: true });
    expect(view.contentDOM.querySelector('.cm-md-setext-hidden')).not.toBeNull();
  });

  it('goes past the underline on Enter at the heading\'s end, and before the text on Enter at its start', () => {
    expect(press('Title‸\n===\n\nnext\n', 'Enter')).toBe('Title\n===\n‸\n\nnext\n');
    expect(press('‸Title\n===\n', 'Enter')).toBe('\n‸Title\n===\n');
  });

  it('comes back to the heading\'s end on Backspace on the line under it, taking the line when it is empty', () => {
    expect(press('Title\n===\n‸\nnext\n', 'Backspace')).toBe('Title‸\n===\nnext\n');
    expect(press('Title\n---\n‸next\n', 'Backspace')).toBe('Title‸\n---\nnext\n');
  });

  it('reads its level in the style menu and writes "#" form only when the level changes', () => {
    const doc = 'Title\n===\n\nnext\n';
    const state = EditorState.create({ doc, selection: { anchor: 2 }, extensions: markdownEditorExtensions(DOC) });
    ensureSyntaxTree(state, doc.length, 1_000);
    expect(formatState(state).heading).toBe(1);
    const run = (level: number) => {
      let out = doc;
      setHeading(level)({ state, dispatch: (tr) => { out = tr.newDoc.toString(); } });
      return out;
    };
    expect(run(1)).toBe(doc);
    expect(run(2)).toBe('## Title\n\nnext\n');
    expect(run(0)).toBe('Title\n\nnext\n');
    const before = 'Title\n---\nnext\n';
    const tight = EditorState.create({ doc: before, selection: { anchor: 2 }, extensions: markdownEditorExtensions(DOC) });
    let out = before;
    setHeading(0)({ state: tight, dispatch: (tr) => { out = tr.newDoc.toString(); } });
    expect(out).toBe('Title\n\nnext\n');
  });
});

describe('heading edges', () => {
  it('starts a normal line under an empty heading on Enter', () => {
    expect(press('# ‸\n', 'Enter')).toBe('# \n‸\n');
  });

  it('writes a setext heading in "#" form when Backspace takes the blank line above it, so the text above never joins it', () => {
    expect(press('Para\n\n‸Title\n===\n', 'Backspace')).toBe('Para\n# ‸Title\n');
    expect(press('Para\n\n‸Title\n---\n\nnext\n', 'Backspace')).toBe('Para\n## ‸Title\n\nnext\n');
  });

  it('keeps a setext underline on Delete at the heading\'s end, taking the blank line after it or bringing the next paragraph up', () => {
    expect(press('Title‸\n===\n\nnext\n', 'Delete')).toBe('Title‸\n===\nnext\n');
    expect(press('Title‸\n===\nnext\n', 'Delete')).toBe('Title‸next\n===\n');
    expect(press('Title‸\n===\n| a |\n|---|\n', 'Delete')).toBe('Title‸\n===\n| a |\n|---|\n');
    expect(press('Title‸\n===\n', 'Delete')).toBe('Title‸\n===\n');
  });
});
