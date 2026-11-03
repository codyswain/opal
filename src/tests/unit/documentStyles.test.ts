import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';

/** The declarations of the rule with exactly this selector in one of the editor's style sheets. */
function rule(sheet: string, selector: string): string {
  const css = readFileSync(path.join(__dirname, '../../renderer/features/disk-explorer/components/editor', sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, selectors]) => selectors.split(',').map((one) => one.trim()).includes(selector));
  return found?.[2] ?? '';
}

function mount(doc: string) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions('/Vault/Notes/Plan.mdo') }) });
  ensureSyntaxTree(view.state, doc.length, 5_000);
  view.dispatch({});
  return view;
}

describe('the look of documents', () => {
  it('keeps a line\'s height in an empty table cell, so a new table\'s rows are not thin strips', () => {
    const view = mount('| Owner | Column 2 |\n|---|---|\n|  |  |\n');
    const cells = view.contentDOM.querySelectorAll('td .cm-md-cell');
    expect(cells.length).toBe(2);
    expect([...cells].every((cell) => cell.textContent === '')).toBe(true);
    expect(rule('blocks.css', '.opal-editor .cm-editor .cm-md-table .cm-md-cell')).toMatch(/min-height: 1\.5em/);
    view.destroy();
  });

  it('closes each line\'s piece of inline code that wraps, as a chip\'s are', () => {
    const declarations = rule('code.css', '.opal-editor .cm-editor .cm-md-code');
    expect(declarations).toMatch(/-webkit-box-decoration-break: clone/);
    expect(declarations).toMatch(/(^|[^-])box-decoration-break: clone/);
    expect(rule('files.css', '.opal-editor .cm-editor .cm-file-chip')).toMatch(/-webkit-box-decoration-break: clone/);
  });

  it('draws the link underline under a formula in link text as a straight line', () => {
    const declarations = rule('math.css', '.opal-editor .cm-editor .cm-md-link .cm-math-inline');
    expect(declarations).toMatch(/box-shadow: inset 0 -1px 0/);
    expect(declarations).toMatch(/border-radius: 0;/);
  });

  it('edges a card\'s picture of a page with a hairline, so a white page shows its shape on a white card', () => {
    const declarations = rule('files.css', '.opal-editor .cm-editor .cm-file-card-tile-thumb.cm-file-card-tile-page::after');
    expect(declarations).toMatch(/box-shadow: inset 0 0 0 1px hsl\(var\(--border-subtle\)\)/);
    expect(declarations).toMatch(/pointer-events: none/);
  });
});
