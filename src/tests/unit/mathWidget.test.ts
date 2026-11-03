import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { loadMhchem, pageMacros, renderTex, renderUncached } from '@/renderer/features/disk-explorer/components/editor/mathWidget';

/** Every colour a piece of HTML sets in a style, other than the text colour. */
function colours(html: string): string[] {
  return [...html.matchAll(/style="([^"]*)"/g)].flatMap(([, style]) => [...style.matchAll(/(?:^|;)\s*(?:color|background-color|border-color)\s*:\s*([^;]+)/g)].map((match) => match[1].trim()))
    .filter((value) => !/^(currentColor|inherit|transparent)$/i.test(value));
}

describe('math rendering', () => {
  it.each([
    ['\\label', '\\label{eq:1} x = 1', false],
    ['\\eqref', 'see \\eqref{eq:1}', false],
    ['\\ref', 'see \\ref{a}', false],
    ['\\require', '\\require{cancel} \\cancel{x}', false],
    ['multline', '\\begin{multline} a + b \\\\ = c \\end{multline}', true],
    ['\\newcommand over a built-in', '\\newcommand{\\R}{\\mathbb{R}} x \\in \\R', false],
    ['inline align', '\\begin{align} a &= b \\\\ c &= d \\end{align}', false],
    ['inline equation', '\\begin{equation} E = mc^2 \\end{equation}', false],
    ['zero-width characters', '2H_2\u200BO + \u200D x', false],
  ])('renders %s', (_name, tex, display) => {
    const rendered = renderUncached(tex, display);
    expect(rendered.error).toBeNull();
    expect(rendered.html).toContain('katex');
    const annotation = /<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/.exec(rendered.html)?.[1] ?? '';
    expect(annotation).not.toMatch(/[\u200B-\u200D\uFEFF]/);
  });

  it.each([
    ['\\color{red} x'],
    ['\\textcolor{blue}{x}'],
    ['\\colorbox{yellow}{z}'],
    ['\\fcolorbox{red}{yellow}{z}'],
  ])('draws %s in the text colour', (tex) => {
    const rendered = renderUncached(tex, false);
    expect(rendered.error).toBeNull();
    expect(colours(rendered.html)).toEqual([]);
  });

  it.each([
    ['\\htmlStyle{color: red}{x}', '\\htmlStyle'],
    ['\\htmlClass{evil}{x}', '\\htmlClass'],
    ['\\htmlId{a}{x}', '\\htmlId'],
    ['\\href{javascript:alert(1)}{x}', '\\href'],
    ['\\url{file:///etc/passwd}', '\\url'],
    ['\\includegraphics{https://example.com/x.png}', '\\includegraphics'],
  ])('refuses %s', (tex, command) => {
    const rendered = renderUncached(tex, false);
    expect(rendered.error).toContain(command);
    expect(rendered.html).toBe('');
  });

  it('links http, https and mailto addresses with no colour', () => {
    const rendered = renderUncached('\\href{https://example.com/paper}{paper} \\url{mailto:a@b.co}', false);
    expect(rendered.error).toBeNull();
    expect(rendered.html).toContain('href="https://example.com/paper"');
    expect(rendered.html).toContain('href="mailto:a@b.co"');
    expect(colours(rendered.html)).toEqual([]);
  });

  it('caps sizes at 50em', () => {
    const rendered = renderUncached('\\rule{100000em}{1em}', false);
    expect(rendered.error).toBeNull();
    const drawn = rendered.html.replace(/<annotation[\s\S]*?<\/annotation>/g, '');
    const sizes = [...drawn.matchAll(/([\d.]+)em/g)].map((match) => Number(match[1]));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(50);
  });

  it('shows KaTeX\'s message for TeX it cannot read, with no colour', () => {
    for (const tex of ['\\frac{1}{', 'x^', '\\foo', '\\SI{5}{m}', '\\begin{tikzpicture}\\end{tikzpicture}']) {
      const rendered = renderUncached(tex, false);
      expect(rendered.error, tex).toBeTruthy();
      expect(rendered.error, tex).not.toMatch(/KaTeX parse error/);
    }
    expect(renderUncached('\\foo', false).error).toBe('Undefined control sequence: \\foo');
    expect(renderUncached('\\frac{1}{', false).errorAt).not.toBeNull();
  });

  it('stops a recursive definition at the expansion limit', () => {
    expect(renderUncached('\\def\\a{\\a}\\a', false).error).toMatch(/Too many expansions/);
  });

  it('loads mhchem the first time \\ce appears', async () => {
    expect(renderTex('\\ce{2H2O -> 2H2 + O2}', true).error).toBe('Loading chemistry…');
    await loadMhchem();
    const rendered = renderTex('\\ce{2H2O -> 2H2 + O2}', true);
    expect(rendered.error).toBeNull();
    expect(renderTex('\\pu{123 kJ}', false).error).toBeNull();
  });

  it('caches by display, TeX and macros', () => {
    expect(renderTex('x^2', false)).toBe(renderTex('x^2', false));
    expect(renderTex('x^2', false)).not.toBe(renderTex('x^2', true));
  });

  it('builds the page\'s macros in document order, whatever is in view', () => {
    const doc = 'Intro $\\gdef\\vv{\\mathbf{v}}$ then\n\n$\\vv + 1$\n\n$\\def\\loop{\\loop}$';
    const state = EditorState.create({ doc, extensions: markdownEditorExtensions('/Vault/Notes/Page.md') });
    ensureSyntaxTree(state, doc.length, 5_000);
    const macros = state.update({}).state.field(pageMacros);
    expect(Object.keys(macros.macros)).toContain('\\vv');
    expect(renderTex('\\vv + 1', false, macros).error).toBeNull();
    expect(renderTex('\\vv + 1', false).error).toMatch(/Undefined control sequence/);
  });

  it('draws formulas on the page with role math and the TeX as their label', () => {
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'Energy $E=mc^2$ and $\\foo$.\n\n$$\n\\frac{a}{b}\n$$\n', extensions: markdownEditorExtensions('/Vault/Notes/Page.mdo') }) });
    const drawn = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-math')];
    expect(drawn.map((element) => element.getAttribute('aria-label'))).toEqual(['E=mc^2', '\\foo', '\\frac{a}{b}']);
    for (const element of drawn) expect(element.getAttribute('role')).toBe('math');
    const error = drawn[1];
    expect(error.classList.contains('cm-math-error')).toBe(true);
    expect(error.textContent).toBe('$\\foo$');
    expect(error.title).toBe('Undefined control sequence: \\foo');
    expect(drawn[0].querySelector('.katex-mathml math')).not.toBeNull();
    view.destroy();
  });
});
