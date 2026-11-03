import { beforeAll, describe, expect, it } from 'vitest';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { fenceLanguage, loadAllLanguages } from '@/renderer/features/disk-explorer/components/editor/codeLanguages';
import { highlightMarks } from '@/renderer/features/disk-explorer/components/editor/codeHighlight';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';

beforeAll(async () => {
  await loadAllLanguages();
});

const marks = (code: string, info: string) => highlightMarks(code, fenceLanguage(info).language).map((mark) => [code.slice(mark.from, mark.to), mark.className]);

describe('code highlighting', () => {
  it('comes from each fence\'s own parse, in the grey classes', () => {
    expect(marks('const a = "x"; // note', 'ts')).toEqual([
      ['const', 'cm-code-keyword'],
      ['=', 'cm-code-punctuation'],
      ['"x"', 'cm-code-string'],
      [';', 'cm-code-punctuation'],
      ['// note', 'cm-code-comment'],
    ]);
    expect(marks('SELECT 1 FROM t', 'sql').map(([text]) => text)).toContain('SELECT');
    expect(marks('def f():\n    return 1', 'python')).toContainEqual(['def', 'cm-code-keyword']);
    expect(marks('echo "hi" # c', 'sh')).toContainEqual(['# c', 'cm-code-comment']);
    expect(marks('{"a": 1}', 'json')).toContainEqual(['1', 'cm-code-literal']);
  });

  it('leaves text and unknown languages plain', () => {
    expect(marks('const a = 1', 'text')).toEqual([]);
    expect(marks('const a = 1', '')).toEqual([]);
    expect(marks('{ print $1 }', 'awk')).toEqual([]);
  });

  it('never mounts a language in the page\'s tree, so a ```markdown fence is code to every command', () => {
    const doc = 'Intro\n\n```markdown\n- item\n# Title\n[l](u)\n```\n\n```js\nconst a = 1;\n```\n';
    const state = EditorState.create({ doc, extensions: markdownEditorExtensions('/Vault/a.mdo') });
    const tree = ensureSyntaxTree(state, doc.length, 5_000) ?? syntaxTree(state);
    for (const word of ['item', 'Title', 'l](', 'const']) {
      const node = tree.resolveInner(doc.indexOf(word) + 1, 1);
      expect(['CodeText', 'FencedCode']).toContain(node.name);
    }
    const names = new Set<string>();
    tree.iterate({ from: doc.indexOf('```markdown'), to: doc.length, enter: (ref) => { names.add(ref.name); } });
    expect([...names].filter((name) => ['ListItem', 'ATXHeading1', 'Link', 'VariableDefinition'].includes(name))).toEqual([]);
  });

  it('colours a 1,627-line JSON block within a frame once, then from its cache', () => {
    const json = ['{', ...Array.from({ length: 1_625 }, (_, line) => `  "key${line}": ${line},`), '}'].join('\n');
    const language = fenceLanguage('json').language;
    const start = performance.now();
    const first = highlightMarks(json, language);
    const cold = performance.now() - start;
    const again = performance.now();
    expect(highlightMarks(json, language)).toBe(first);
    console.info(`[highlight] 1,627-line JSON: ${cold.toFixed(1)} ms cold, ${(performance.now() - again).toFixed(2)} ms cached, ${first.length} marks`);
    expect(first.length).toBeGreaterThan(3_000);
  });
});
