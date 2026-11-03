import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { BUDGETS } from '@/renderer/shared/perf/marks';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

/*
 * One typed key in a heavy document, within one 60fps frame: a 300-row
 * table, 100 inline and 100 display formulas (plain text until math
 * renders), a 1,627-line JSON fence and a 22,000-character paragraph. The
 * time is the median of a key's whole dispatch, decorations included, at
 * each spot where the page's cost grows with what is near the caret.
 * If it fails while the machine is busy, run it alone once before treating
 * it as real. The budget is never raised to pass.
 *
 *   npx vitest run src/tests/perf/editorKeystroke.test.ts
 */

const PAGE = '/Vault/Notes/Heavy.mdo';
const SAMPLES = 21;

function heavyPage(): string {
  const table = ['| Item | Owner | Cost |', '|---|---|---|', ...Array.from({ length: 300 }, (_, row) => `| item ${row} | person ${row % 17} | $${row * 3} |`)].join('\n');
  const inline = Array.from({ length: 100 }, (_, index) => `Step ${index} uses $x_${index}^2 + y$ and goes on.`).join('\n\n');
  const display = Array.from({ length: 100 }, (_, index) => `$$\n\\frac{a_${index}}{b} = \\sum_{k=0}^{n} c_k\n$$`).join('\n\n');
  const json = ['```json', '{', ...Array.from({ length: 1_625 - 2 }, (_, line) => `  "key${line}": ${line},`), '  "end": true', '}', '```'].join('\n');
  const words: string[] = [];
  for (let length = 0, index = 0; length < 22_000; index += 1) {
    const word = index % 40 === 0 ? `**bold ${index}**` : index % 55 === 0 ? `[link ${index}](https://example.com/${index})` : index % 70 === 0 ? `\`code${index}\`` : `word${index}`;
    words.push(word);
    length += word.length + 1;
  }
  const paragraph = words.join(' ');
  return ['# Heavy page', '', paragraph, '', table, '', inline, '', display, '', json, '', 'The end.', ''].join('\n');
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

let view: EditorView;

beforeAll(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [PAGE]: '' });
  view = new EditorView({ parent: document.body, state: EditorState.create({ doc: heavyPage(), extensions: markdownEditorExtensions(PAGE) }) });
  ensureSyntaxTree(view.state, view.state.doc.length, 30_000);
  view.dispatch({});
});

afterAll(() => {
  view.destroy();
});

/** The median time to type one character at `at`, taking it out again between samples. */
function keystroke(at: number): number {
  const samples: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    view.dispatch({ selection: { anchor: at } });
    const caret = view.state.selection.main.head;
    const start = performance.now();
    view.dispatch({ changes: { from: caret, insert: 'x' }, selection: { anchor: caret + 1 }, userEvent: 'input.type' });
    samples.push(performance.now() - start);
    view.dispatch({ changes: { from: caret, to: caret + 1 }, annotations: [] });
  }
  return median(samples);
}

describe('keystroke budget in the editor', () => {
  const spot = (find: (text: string) => number) => () => find(view.state.doc.toString());
  const spots: [string, () => number][] = [
    ['the middle of a 22,000-character paragraph', spot((text) => text.indexOf('word1500 ') + 4)],
    ['the line under a 300-row table', spot((text) => text.indexOf('\n\nStep 0') + 1)],
    ['next to an inline formula', spot((text) => text.indexOf('$x_50^2') - 1)],
    ['between display formulas', spot((text) => text.indexOf('$$\n\n$$', text.indexOf('a_50')) + 3)],
    ['under a 1,627-line JSON fence', spot((text) => text.indexOf('The end.'))],
    ['inside the 1,627-line JSON fence, edited in place', spot((text) => text.indexOf('"key800"') + 4)],
  ];

  it.each(spots)('types at %s within one frame', (_name, place) => {
    const elapsed = keystroke(place());
    console.info(`[keystroke] ${_name}: median ${elapsed.toFixed(2)} ms over ${SAMPLES} keys`);
    expect(elapsed).toBeLessThan(BUDGETS.keystrokeMs);
  });
});
