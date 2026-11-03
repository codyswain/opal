import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import { act } from '@testing-library/react';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { diagramField, diagramKind, pocketSteps, setDiagramCode, stripColours } from '@/renderer/features/disk-explorer/components/editor/diagrams';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { objectAt } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

/*
 * Diagrams without layout: happy-dom draws no SVG, so these check what goes
 * into Mermaid and what the page does around it. The vault's own Mermaid and
 * Pocket fences are checked when OPAL_CENSUS_ROOT points at the vault.
 */

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/Plan.md';
const ROOT = process.env.OPAL_CENSUS_ROOT;
let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '', [NOTE]: '' });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
});

function mount(doc: string, at = 0, page = DOC) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: at }, extensions: markdownEditorExtensions(page) }) });
  ensureSyntaxTree(view.state, doc.length, 5_000);
  view.dispatch({});
  views.push(view);
  return view;
}

const MERMAID = 'flowchart TD\n  A[Write] --> B{Review}\n  B -->|ok| C[Merge]\n  classDef hot fill:#f96,stroke:#333,stroke-width:4px,color:#fff\n  class A hot\n  style C fill:#bbf,stroke-dasharray: 5 5\n  linkStyle 0 stroke:#ff3,stroke-width:2px';

/** The fences of `kind` in the vault's notes, for the checks that read it. */
async function vaultFences(kind: string, files: string[]): Promise<string[]> {
  const fences: string[] = [];
  for (const file of files) {
    const text = await readFile(path.join(ROOT as string, file), 'utf8');
    for (const match of text.matchAll(new RegExp(`^[ \\t>]*(\`{3,}|~{3,})${kind}[^\\n]*\\n([\\s\\S]*?)^[ \\t>]*\\1[ \\t]*$`, 'gm'))) fences.push(match[2]);
  }
  return fences;
}

describe('diagrams', () => {
  it('know a diagram fence by its info string', () => {
    expect(diagramKind('mermaid')).toBe('mermaid');
    expect(diagramKind('Mermaid title="x"')).toBe('mermaid');
    expect(diagramKind('flowchart')).toBe('pocket');
    expect(diagramKind('ts')).toBeNull();
  });

  it('draw colours grey: style, classDef and linkStyle colours are left out before drawing, and the rest stays', () => {
    const stripped = stripColours(MERMAID);
    expect(stripped).not.toMatch(/#f96|#333|#fff|#bbf|#ff3/);
    expect(stripped).toContain('classDef hot stroke-width:4px');
    expect(stripped).toContain('style C stroke-dasharray: 5 5');
    expect(stripped).toContain('linkStyle 0 stroke-width:2px');
    expect(stripped).toContain('A[Write] --> B{Review}');
    expect(stripColours('%%{init: {"theme": "forest"}}%%\ngraph LR\n  a --> b')).toBe('\ngraph LR\n  a --> b');
  });

  it('pass Mermaid\'s own parser', async () => {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    for (const source of [MERMAID, 'sequenceDiagram\n  Opal->>Disk: write\n  Disk-->>Opal: saved', 'graph LR\n  a --> b']) {
      await expect(mermaid.parse(stripColours(source))).resolves.toBeTruthy();
    }
    await expect(mermaid.parse('flowchart TD\n  A[ -->')).rejects.toThrow();
  });

  it('lay out Pocket\'s flowcharts as a chain, and leave anything else as code', () => {
    expect(pocketSteps('Hiring -> Shipping\nShipping -> Assembly\nAssembly -> Training')).toEqual(['Hiring', 'Shipping', 'Assembly', 'Training']);
    expect(pocketSteps('Slice -> Jar\nAdd salt + sugar\nWait 7 hours -> Serve')).toEqual(['Slice', 'Jar', 'Add salt + sugar', 'Wait 7 hours', 'Serve']);
    expect(pocketSteps('Task (Head-cam) -> SOP/Sheet\nSOP/Sheet -> Review & Iteration')).toEqual(['Task (Head-cam)', 'SOP/Sheet', 'Review & Iteration']);
    expect(pocketSteps('TD\n  A[x] --> B')).toBeNull();
    expect(pocketSteps('')).toBeNull();
  });

  it.skipIf(!ROOT)('parse every Mermaid fence in the vault and lay out every Pocket flowchart', async () => {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const sources = await vaultFences('mermaid', [
      'Library/parametric/mini-bit/research-1to3/electronics.md',
      'Library/parametric/bastion-desktop/camera-service-research.md',
      'Library/parametric/bastion-hosting/research/05-data-volume.md',
      'Library/parametric/strategy/2026-10-26/memos/2-production.md',
      'docs/superpowers/specs/2026-09-24-local-agent-communication-design.md',
    ]);
    expect(sources).toHaveLength(5);
    for (const source of sources) await expect(mermaid.parse(stripColours(source))).resolves.toBeTruthy();
    const flowcharts = await vaultFences('flowchart', [
      'Library/recordings/2026-10-21 1053 Robotics Hardware Scaling and Operations.md',
      'Library/recordings/2026-10-21 2052 Nature Videos and Casual Chat.md',
      'Library/recordings/2026-10-19 1115 Cody Lucas.md',
      'Library/recordings/2026-10-22 1050 Operator Staffing and Robot Hardware.md',
    ]);
    expect(flowcharts).toHaveLength(4);
    for (const source of flowcharts) expect(pocketSteps(source)?.length).toBeGreaterThan(3);
  });
});

describe('diagrams in a document', () => {
  const PAGE = 'Above\n\n```mermaid\ngraph LR\n  a --> b\n```\n\nBelow\n';

  it('draw over the fence, step the caret over it, and frame on Backspace from the line below', async () => {
    const view = mount(PAGE, PAGE.indexOf('Below'));
    expect(view.state.field(diagramField).decorations.size).toBe(1);
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'ArrowLeft' }), 'editor'); });
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'ArrowLeft' }), 'editor'); });
    expect(view.state.selection.main.head).toBe(PAGE.indexOf('```') - 1);
    act(() => { view.dispatch({ selection: { anchor: PAGE.indexOf('Below') - 1 } }); });
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(view.state.field(objectFrame)?.kind).toBe('diagram');
    expect(view.state.doc.toString()).toBe(PAGE);
  });

  it('show their code in place on Code or Enter, writing nothing, and the diagram under it', () => {
    const view = mount(PAGE);
    const obj = objectAt(view.state, PAGE.indexOf('```'), 1);
    expect(obj?.kind).toBe('diagram');
    act(() => { view.dispatch({ effects: setDiagramCode.of({ at: PAGE.indexOf('```'), code: true }) }); });
    expect(view.state.doc.toString()).toBe(PAGE);
    expect(objectAt(view.state, PAGE.indexOf('```'), 1)?.kind).toBe('code');
    expect(view.contentDOM.querySelector('.cm-code-header .cm-diagram-modes')).not.toBeNull();
    expect(view.contentDOM.querySelectorAll('.cm-code-line').length).toBe(4);
  });

  it('draw a note\'s diagram as a block with its own Diagram and Code', () => {
    const view = mount(PAGE, 0, NOTE);
    const block = view.contentDOM.querySelector('.cm-diagram') as HTMLElement;
    expect(block.getAttribute('aria-label')).toBe('Diagram, Mermaid');
    act(() => { ([...block.querySelectorAll('.cm-diagram-segment')][1] as HTMLElement).click(); });
    expect(block.querySelector('.cm-diagram-source')?.textContent).toBe('graph LR\n  a --> b');
  });

  it('draw a Pocket flowchart as its chain', () => {
    const view = mount('```flowchart\nOne -> Two\nTwo -> Three\n```\n', 0, NOTE);
    expect([...view.contentDOM.querySelectorAll('.cm-diagram-step')].map((step) => step.textContent)).toEqual(['One', 'Two', 'Three']);
  });
});
