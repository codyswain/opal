// Disposable Electron acceptance for input methods in a document. At each
// caret cell (both edges of bold, after a link, inline code and a wiki
// link, the text start of a list item, task, heading and quote, after Cmd+B,
// over a selection that crosses a mark, and on both sides of an inline
// formula and a file chip, at a line's start and end too) it types one
// letter with the real keyboard, then sends the same place an input
// method's composition through the DevTools protocol
// (Input.imeSetComposition, then Input.insertText), and a dead key (´ then
// é). The composed text must land where the letter did, with the same marks
// around it. Prints a result table for the PR body. Own userData and temp vault; run from the
// repository root after the Vite bundles are built: see README.md here.
//
//   node e2e/acceptance/ime-acceptance.mjs [--table]
import { _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// Each cell: the page's Markdown, and where the caret goes (‸) or what is selected (« to »).
const CELLS = [
  { name: 'start of bold', doc: 'Some ‸**bold** text' },
  { name: 'end of bold', doc: 'Some **bold‸** text' },
  { name: 'after a link', doc: 'See [the site](https://example.com)‸ now' },
  { name: 'after inline code', doc: 'Run `npm test`‸ now' },
  { name: 'inside inline code', doc: 'Run `npm‸ test` now' },
  { name: 'after a wiki link', doc: 'See [[Plan]]‸ now' },
  { name: 'list item start', doc: '- ‸item' },
  { name: 'task start', doc: '- [ ] ‸task' },
  { name: 'heading start', doc: '## ‸Heading' },
  { name: 'quote start', doc: '> ‸quoted' },
  { name: 'after Cmd+B', doc: 'Some text ‸', bold: true },
  { name: 'selection across a mark', doc: 'Some **bo«ld** te»xt' },
  { name: 'after an inline formula', doc: 'Energy $E=mc^2$‸ and more.' },
  { name: 'before an inline formula', doc: 'Energy ‸$E=mc^2$ and more.' },
  { name: 'line start, before a formula', doc: '‸$x$ starts this line.' },
  { name: 'line end, after a formula', doc: 'This line ends with $y$‸' },
  { name: 'before a file chip', doc: 'See ‸[[Library/files/2026-11/deck.pptx|deck]] here' },
  { name: 'after a file chip', doc: 'See [[Library/files/2026-11/deck.pptx|deck]]‸ here' },
  { name: 'line start, before a file chip', doc: '‸[[Library/files/2026-11/deck.pptx|deck]] here' },
  { name: 'line end, after a file chip', doc: 'See [[Library/files/2026-11/deck.pptx|deck]]‸' },
];

const COMPOSITIONS = [
  { name: 'Japanese', steps: ['に', 'にほ', 'にほん'], commit: '日本' },
  { name: 'dead key', steps: ['´'], commit: 'é' },
];

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-ime-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-ime-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Notes'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const DOC = `${vault}/Notes/ime.mdo`;
await writeFile(DOC, 'Start\n');
await writeFile(path.join(vault, 'Notes', 'Plan.md'), '# Plan\n');
await mkdir(path.join(vault, 'Library', 'files', '2026-11'), { recursive: true });
await writeFile(path.join(vault, 'Library', 'files', '2026-11', 'deck.pptx'), 'deck');
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

/** Puts `doc` in the page with the caret or selection it marks, and focuses the text. */
async function place(cell) {
  const raw = cell.doc.replace(/[‸«»]/g, '');
  const caret = cell.doc.indexOf('‸');
  const anchor = caret !== -1 ? caret : cell.doc.indexOf('«');
  const head = caret !== -1 ? caret : cell.doc.indexOf('»') - 1;
  await page.evaluate(({ text, from, to }) => {
    const view = document.querySelector('.cm-content').cmTile.root.view;
    view.focus();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    view.dispatch({ selection: { anchor: from, head: to }, userEvent: 'select' });
  }, { text: `${raw}\n`, from: anchor, to: head });
  await page.waitForTimeout(60);
  if (cell.bold) {
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(30);
  }
}

const text = () => page.evaluate(() => document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());

let cdp;
const table = [];
try {
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, DOC);
  await page.getByTestId('markdown-editor').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);
  cdp = await page.context().newCDPSession(page);

  for (const cell of CELLS) {
    await place(cell);
    await page.keyboard.type('x');
    await page.waitForTimeout(40);
    const typed = await text();
    const row = { cell: cell.name, typed: JSON.stringify(typed.trimEnd()) };
    for (const composition of COMPOSITIONS) {
      await place(cell);
      for (const step of composition.steps) {
        await cdp.send('Input.imeSetComposition', { text: step, selectionStart: step.length, selectionEnd: step.length });
        await page.waitForTimeout(20);
      }
      await cdp.send('Input.insertText', { text: composition.commit });
      await page.waitForTimeout(60);
      const composed = await text();
      // The composed text lands where the letter did, with the same marks around it.
      const raw = `${cell.doc.replace(/[‸«»]/g, '')}\n`;
      let first = 0;
      while (first < raw.length && raw[first] === typed[first]) first += 1;
      const letter = typed.indexOf('x', first);
      const expected = typed.slice(0, letter) + composition.commit + typed.slice(letter + 1);
      const ok = composed === expected;
      row[composition.name] = ok ? 'same as typing' : `FAIL ${JSON.stringify(composed.trimEnd())}`;
      check(`${composition.name} at ${cell.name}`, ok, ok ? '' : `typing gave ${JSON.stringify(expected.trimEnd())}`);
    }
    table.push(row);
  }

  // The last composition reaches the file on disk.
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);
  const saved = await readFile(DOC, 'utf8');
  check('the composed text is saved', saved === (await text()), JSON.stringify(saved.trimEnd()));
} catch (error) {
  check('runs', false, String(error));
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
  await rm(vaultParent, { recursive: true, force: true });
}

console.log('\n| Cell | Typed letter | Japanese (日本) | Dead key (é) |');
console.log('|---|---|---|---|');
for (const row of table) console.log(`| ${row.cell} | \`${row.typed.replace(/\|/g, '\\|')}\` | ${row.Japanese ?? ''} | ${row['dead key'] ?? ''} |`);
if (errors.length > 0) check('no page errors', false, errors.join(' | '));
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} ${results.length - failed} of ${results.length} checks`);
process.exit(failed === 0 ? 0 : 1);
