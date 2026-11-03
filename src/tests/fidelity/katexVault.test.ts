import { describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { parseMarkdown } from '@/main/fs/MarkdownDocumentService';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { mathNodes, mathSpan } from '@/renderer/features/disk-explorer/components/editor/math';
import { loadMhchem, pageMacros, renderUncached } from '@/renderer/features/disk-explorer/components/editor/mathWidget';
import { openedLine, vaultFiles } from './censusHelpers';

/**
 * Every formula in the vault, drawn by KaTeX 0.18.11 as the page draws it,
 * with the page's macros and mhchem. Offline: KaTeX fetches nothing. No
 * drawn formula carries a colour. Read-only.
 *
 *   OPAL_CENSUS_ROOT=/path/to/vault npx vitest run src/tests/fidelity/katexVault.test.ts
 */
const ROOT = process.env.OPAL_CENSUS_ROOT;

const coloured = (html: string) => [...html.matchAll(/style="([^"]*)"/g)]
  .some(([, style]) => /(?:^|;)\s*(?:color|background-color|border-color)\s*:\s*(?!currentColor|inherit|transparent)/i.test(style));

describe.skipIf(!ROOT)('KaTeX vault census', () => {
  it('draws every vault formula without an error or a colour', async () => {
    await loadMhchem();
    const vault = await vaultFiles(ROOT as string);
    let opened = 0;
    let formulas = 0;
    const failures: string[] = [];
    const colours: string[] = [];
    for (const file of vault.found) {
      let body: string;
      try {
        body = parseMarkdown(await readFile(file)).body;
      } catch {
        continue;
      }
      opened += 1;
      if (!/\$|\\\(|\\\[/.test(body)) continue;
      const state = EditorState.create({ doc: body, extensions: markdownEditorExtensions(file) });
      const tree = ensureSyntaxTree(state, body.length, 10_000);
      if (!tree) continue;
      const macros = state.update({}).state.field(pageMacros);
      for (const node of mathNodes(tree, 0, body.length)) {
        const span = mathSpan(state.doc, node);
        formulas += 1;
        const rendered = renderUncached(span.tex, span.display, macros);
        if (rendered.error) failures.push(`${path.relative(ROOT as string, file)}: ${JSON.stringify(span.tex.slice(0, 80))} ${rendered.error}`);
        else if (coloured(rendered.html)) colours.push(`${path.relative(ROOT as string, file)}: ${JSON.stringify(span.tex.slice(0, 80))}`);
      }
    }
    console.info(openedLine('katex vault', opened, vault));
    console.info(`[katex vault] ${formulas - failures.length} of ${formulas} formulas drawn on KaTeX 0.18.11; ${failures.length} show their source; ${colours.length} with a colour`);
    if (failures.length > 0) console.info(`[katex vault] shown as source:\n  ${failures.join('\n  ')}`);
    expect(colours).toEqual([]);
    expect(failures).toEqual([]);
  }, 600_000);
});
