import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { hiddenRanges } from '@/renderer/features/disk-explorer/components/editor/livePreview';
import {
  OBJECT,
  hiddenOn,
  rawAfter,
  rawRange,
  visibleLine,
  visibleLines,
  visibleOffset,
  visibleSlice,
} from '@/renderer/features/disk-explorer/components/editor/visibleText';
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

function open(doc: string): EditorState {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(DOC) }) });
  ensureSyntaxTree(view.state, view.state.doc.length, 5_000);
  view.dispatch({});
  views.push(view);
  return view.state;
}

describe('visible text', () => {
  it('leaves out hidden marks and maps each shown character to its raw place', () => {
    const state = open('- a **b** [c](https://x.com) `d` [[E|e]]\n');
    const line = visibleLine(state, 0);
    expect(line.text).toBe('a b c d e');
    const raw = state.doc.toString();
    expect(line.starts.map((at) => raw[at]).join('')).toBe('a b c d e');
    expect(rawRange(line, 2, 3)).toEqual({ from: raw.indexOf('b'), to: raw.indexOf('b') + 1 });
    expect(visibleOffset(line, raw.indexOf('c'))).toBe(4);
    expect(rawAfter(line, 1)).toBe(raw.indexOf('a') + 1);
  });

  it('shows a drawn thing as one object character, and a drawn table\'s cells as text', () => {
    const state = open('Text\n\n---\n\n| a | b |\n|---|---|\n| c | d |\n');
    const rule = visibleLine(state, state.doc.line(3).from);
    expect(rule.text).toBe(OBJECT);
    const row = visibleLine(state, state.doc.line(7).from);
    expect(row.text).toBe(`${OBJECT} c ${OBJECT} d ${OBJECT}`);
  });

  it('reads the hidden ranges once per state for the same lines', () => {
    const state = open('a **b** c\n');
    expect(hiddenOn(state, 0, 9)).toBe(hiddenOn(state, 0, 9));
    expect(hiddenOn(state, 0, 9)).toEqual(hiddenRanges(state, 0, 9));
    expect(visibleLines(state, 0, 9)[0]).toBe(visibleLine(state, 4));
  });

  it('joins the lines of a slice with line breaks', () => {
    const state = open('# Title\n\n**bold** text\n');
    expect(visibleSlice(state, 0, state.doc.length)).toBe('Title\n\nbold text\n');
  });

  it('finds the caret\'s place in a 22,000-character paragraph within one frame', () => {
    const words: string[] = [];
    for (let length = 0, index = 0; length < 22_000; index += 1) {
      const word = index % 40 === 0 ? `**bold ${index}**` : index % 55 === 0 ? `[link ${index}](https://example.com/${index})` : `word${index}`;
      words.push(word);
      length += word.length + 1;
    }
    const state = open(`${words.join(' ')}\n`);
    visibleLine(state, 0);
    const next = state.update({ changes: { from: 10_000, insert: 'x' } }).state;
    const start = performance.now();
    visibleLine(next, 10_000);
    expect(performance.now() - start).toBeLessThan(16);
  });
});
