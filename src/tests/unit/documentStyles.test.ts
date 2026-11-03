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

  it('closes each line\'s piece of inline code that wraps', () => {
    const declarations = rule('code.css', '.opal-editor .cm-editor .cm-md-code');
    expect(declarations).toMatch(/-webkit-box-decoration-break: clone/);
    expect(declarations).toMatch(/(^|[^-])box-decoration-break: clone/);
  });

  it('keeps a file chip whole on one line, a long name ending in an ellipsis', () => {
    expect(rule('files.css', '.opal-editor .cm-editor .cm-file-chip')).toMatch(/white-space: nowrap/);
    const name = rule('files.css', '.opal-editor .cm-editor .cm-file-chip-name');
    expect(name).toMatch(/display: inline-block/);
    expect(name).toMatch(/max-width: min\(24ch, 100%\)/);
    expect(name).toMatch(/text-overflow: ellipsis/);
  });

  it('gives every file row one width and a card exactly 64px with its edge, buttons under the name when narrow', () => {
    const card = rule('files.css', '.opal-editor .cm-editor .cm-file-card');
    expect(card).toMatch(/height: 64px/);
    // 48px tile, 7px above and below it, a 1px edge.
    expect(card).toMatch(/padding: 7px 12px 7px 8px/);
    expect(card).toMatch(/container-type: inline-size/);
    expect(rule('files.css', '.opal-editor .cm-editor .cm-file-audio')).toMatch(/width: min\(100%, 28rem\)/);
    const css = readFileSync(path.join(__dirname, '../../renderer/features/disk-explorer/components/editor/files.css'), 'utf8');
    expect(css).toMatch(/@container \(max-width: 400px\) \{\s*\.opal-editor \.cm-editor \.cm-file-card > \.cm-file-card-actions \{[^}]*flex-basis: 100%[^}]*padding-left: 60px/);
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
