// Disposable Electron acceptance for blocks in a document: typing under a
// table keeps a blank line, Backspace frames the table and a second press
// removes it, a typed letter at a framed table lands under it, Cmd+Z brings
// the table back, a cell click types into the cell, Tab nests a list item,
// Enter in a numbered list adds one line, and the framed table and rule are
// screenshotted light and dark. Own userData and temp vault; run from the
// repository root after the Vite bundles are built (see README.md here):
//
//   node e2e/acceptance/mdo-blocks-acceptance.mjs [--out dir]
import { _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = path.resolve(outFlag !== -1 ? args[outFlag + 1] : path.join('e2e', 'out', 'mdo-blocks'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const TABLE = '| Area | Owner |\n|---|---|\n| Blocks | PR 1 |\n| Typing | PR 2 |';
const BODY = `Intro paragraph.\n\n${TABLE}\n\n***\n\n> [!note] A callout\n> With a body line.\n\n1. one\n2. two\n3. three\n\n- top\n- next\n`;

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-blocks-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-blocks-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Docs'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const DOC = path.join(vault, 'Docs', 'Blocks.mdo');
await writeFile(DOC, BODY);
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
await mkdir(outDir, { recursive: true });

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

const readDoc = () => readFile(DOC, 'utf8');
const waitForFile = async (predicate, timeout = 10_000) => {
  const start = Date.now();
  let text = await readDoc();
  while (!predicate(text) && Date.now() - start < timeout) {
    await page.waitForTimeout(100);
    text = await readDoc();
  }
  return text;
};
const editorText = () => page.evaluate(() => {
  const view = document.querySelector('.cm-content')?.cmView?.view;
  return view ? view.state.doc.toString() : null;
});

async function setTheme(theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((resolved) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  }, theme);
  await page.waitForTimeout(200);
}

async function shoot(name) {
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    await page.locator('.opal-editor').first().screenshot({ path: path.join(outDir, `${name}-${theme}.png`) });
  }
  await setTheme('light');
}

try {
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, DOC);
  const editor = page.getByTestId('markdown-editor');
  await editor.waitFor({ timeout: 15_000 });
  await page.setViewportSize({ width: 1100, height: 1000 }).catch(() => undefined);
  await page.waitForTimeout(500);

  // Click on the blank line under the table and type.
  const table = page.locator('.cm-md-table').first();
  const box = await table.boundingBox();
  await page.mouse.click(box.x + 40, box.y + box.height + 10);
  await page.keyboard.type('x');
  let saved = await waitForFile((text) => text.includes('\nx'));
  check('text typed under a table keeps a blank line above it', saved.includes(`${TABLE}\n\nx\n`), JSON.stringify(saved.slice(saved.indexOf('| Typing'), saved.indexOf('| Typing') + 40)));

  // Backspace at the start of that text frames the table; a letter lands under it.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  const framed = await page.waitForSelector('[data-object-framed="table"]', { timeout: 3_000 }).then(() => true, () => false);
  check('Backspace at the start of the text under a table frames it', framed);
  check('the framed table shows its bar', await page.locator('[data-object-bar="table"]').count() === 1);
  await shoot('framed-table');
  await page.keyboard.type('y');
  saved = await waitForFile((text) => text.includes('yx'));
  check('a letter typed at a framed table lands under it and deletes nothing', saved.includes(`${TABLE}\n\nyx\n`));

  // Two Backspaces from the start of the text remove it; Cmd+Z brings it back.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  saved = await waitForFile((text) => !text.includes('| Area'));
  check('a second Backspace removes the framed table, keeping one blank line', saved.startsWith('Intro paragraph.\n\nyx\n'), JSON.stringify(saved.slice(0, 40)));
  await page.keyboard.press('Meta+z');
  saved = await waitForFile((text) => text.includes('| Area'));
  check('Cmd+Z restores the table', saved.includes(`${TABLE}\n\nyx\n`));

  // A rule frames too.
  const rule = page.locator('.cm-md-hr').first();
  const ruleBox = await rule.boundingBox();
  await page.mouse.click(ruleBox.x + 30, ruleBox.y + ruleBox.height + 18);
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  check('Backspace beside a rule frames it', await page.locator('.cm-object-framed').count() >= 1 || await page.locator('[data-object-bar="horizontal rule"]').count() === 1);
  await shoot('framed-rule');
  await page.keyboard.press('Escape');

  // A click in a cell, then a key, types into that cell.
  const cell = page.locator('.cm-md-table td').first();
  await cell.click();
  check('a click in a cell outlines it', await page.locator('.cm-md-cell-caret').count() === 1);
  await shoot('cell-caret');
  await page.keyboard.type('Z');
  saved = await waitForFile((text) => text.includes('ZBlocks'));
  check('the first key after a cell click lands in the cell', saved.includes('| ZBlocks | PR 1 |'));
  await page.keyboard.press('Escape');

  // Enter at the end of a numbered item adds one line and renumbers nothing.
  await page.locator('.cm-line', { hasText: /one$/ }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('new');
  saved = await waitForFile((text) => text.includes('2. new'));
  check('Enter in a numbered list adds one item and renumbers nothing', saved.includes('1. one\n2. new\n2. two\n3. three\n'), JSON.stringify(saved.slice(saved.indexOf('1. one'), saved.indexOf('1. one') + 40)));
  check('the page shows 1 to 4', (await page.locator('.cm-md-number').allTextContents()).join(' ') === '1. 2. 3. 4.');

  // Tab nests a bullet under the one above; Tab in a paragraph does nothing.
  await page.locator('.cm-line', { hasText: /next$/ }).first().click();
  await page.keyboard.press('Tab');
  saved = await waitForFile((text) => text.includes('  - next'));
  check('Tab nests a list item under the one above', saved.endsWith('- top\n  - next\n'));
  await page.locator('.cm-line', { hasText: /^Intro paragraph\.$/ }).first().click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);
  check('two Tabs in a paragraph change nothing', (await readDoc()).startsWith('Intro paragraph.\n'));
  await shoot('page');
  check('the editor still holds the file', (await editorText()) === null || (await editorText()) === (await readDoc()));
} catch (error) {
  check('the run finished', false, String(error));
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
  await rm(vaultParent, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok).length;
console.log(`${failed === 0 && errors.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed} of ${results.length} checks${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}; screenshots in ${outDir}`);
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
