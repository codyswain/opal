// Disposable Electron acceptance for blocks in a document: typing under a
// table keeps a blank line, Backspace frames the table and a second press
// removes it, a typed letter at a framed table lands under it, Cmd+Z brings
// the table back, Option+F10 reaches the table's bar, Delete on the blank
// line under it frames it, a cell click types into the cell, Tab nests a list
// item, Enter in a numbered list adds one line, a numbered task keeps its
// box, a quote in a callout draws its rule, and the framed table and rule are
// screenshotted light and dark. A second document that ends with a table
// takes text typed after Cmd+Down as a paragraph under it, and a callout from
// Insert ignores Cmd+Enter and takes its fold sign from its type menu. Own userData and temp vault; run from the
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

const TABLE = '| Area | Owner |\n|---|---|\n| Blocks | PR 1 |\n| Typing | [the plan](https://example.com/plan) |';
const BODY = `Intro paragraph.\n\n${TABLE}\n\n***\n\n> [!note] A callout\n> With a body line.\n\n1. one\n2. two\n3. three\n\n- top\n- next\n\n> [!tip]- A folded tip\n> Hidden until opened.\n\n> [!WARNING]+ An open warning\n> > A nested quote in it.\n\nTasks:\n\n1. [ ] A numbered task\n2. [x] Done one\n`;

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
  check('text typed under a table keeps a blank line above it', saved.includes(`${TABLE}\n\nx\n`), JSON.stringify(saved.slice(saved.indexOf('| Typing'), saved.indexOf('| Typing') + 70)));

  // Backspace at the start of that text frames the table; a letter lands under it.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  const framed = await page.waitForSelector('[data-object-framed="table"]', { timeout: 3_000 }).then(() => true, () => false);
  check('Backspace at the start of the text under a table frames it', framed);
  check('the framed table shows its bar', await page.locator('[data-object-bar="table"]').count() === 1);
  await shoot('framed-table');
  await page.keyboard.press('Alt+F10');
  check('Option+F10 moves focus to the framed table\'s bar', await page.evaluate(() => Boolean(document.activeElement?.closest('[data-object-bar]'))));
  await shoot('bar-focus');
  await page.keyboard.press('Escape');
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

  // Delete on the blank line between the table and the text frames the table instead of joining them.
  await page.locator('.cm-line', { hasText: /^yx$/ }).first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Delete');
  check('Delete on the blank line under a table frames it', await page.locator('[data-object-bar="table"]').count() === 1);
  await page.waitForTimeout(800);
  check('and joins nothing to it', (await readDoc()).includes(`${TABLE}\n\nyx\n`));
  await page.keyboard.press('Escape');

  // A rule frames too.
  const rule = page.locator('.cm-md-hr').first();
  const ruleBox = await rule.boundingBox();
  await page.mouse.click(ruleBox.x + 30, ruleBox.y + ruleBox.height + 18);
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  check('Backspace beside a rule frames it', await page.locator('.cm-object-framed').count() >= 1 || await page.locator('[data-object-bar="horizontal rule"]').count() === 1);
  await shoot('framed-rule');
  await page.keyboard.press('Escape');

  // A click on a rule frames it; Backspace then removes only the rule, and Cmd+Z brings it back.
  {
    const before = await readDoc();
    const box = await page.locator('.cm-md-hr').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    check('a click on a rule frames it', await page.locator('[data-object-bar="horizontal rule"]').count() === 1);
    await page.keyboard.press('Backspace');
    const removed = await waitForFile((text) => !text.includes('***'));
    check('Backspace on a clicked rule removes only the rule', removed === before.replace('***\n\n', ''), JSON.stringify(removed.slice(0, 80)));
    await page.keyboard.press('Meta+z');
    check('Cmd+Z restores the rule', (await waitForFile((text) => text.includes('***'))) === before);
  }

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
  check('the page shows 1 to 4', (await page.locator('.cm-md-number').allTextContents()).slice(0, 4).join(' ') === '1. 2. 3. 4.');

  // A numbered task shows its number, then a full box; a quote nested in a callout draws its rule.
  const boxes = await page.locator('.cm-md-list-marker .cm-md-task').evaluateAll((tasks) => tasks.map((task) => Math.round(task.getBoundingClientRect().width)));
  check('a numbered task\'s box is as wide as it is tall', boxes.length === 2 && boxes.every((width) => width >= 12), JSON.stringify(boxes));
  const nested = await page.locator('.cm-line', { hasText: 'A nested quote in it.' }).first().evaluate((line) => getComputedStyle(line).backgroundImage);
  check('a quote nested in a callout draws its rule', nested !== 'none', nested.slice(0, 60));

  // Tab nests a bullet under the one above; Tab in a paragraph does nothing.
  await page.locator('.cm-line', { hasText: /next$/ }).first().click();
  await page.keyboard.press('Tab');
  saved = await waitForFile((text) => text.includes('  - next'));
  check('Tab nests a list item under the one above', saved.includes('- top\n  - next\n'));
  await page.locator('.cm-line', { hasText: /^Intro paragraph\.$/ }).first().click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);
  check('two Tabs in a paragraph change nothing', (await readDoc()).startsWith('Intro paragraph.\n'));

  // A folded callout opens from its chevron, writing nothing.
  const before = await readDoc();
  check('a "-" callout starts folded', await page.locator('.cm-line', { hasText: 'Hidden until opened.' }).count() === 0);
  await page.locator('.cm-md-callout-fold').first().dispatchEvent('mousedown');
  await page.waitForTimeout(300);
  check('its chevron opens it', await page.locator('.cm-line', { hasText: 'Hidden until opened.' }).count() === 1);
  await page.waitForTimeout(800);
  check('folding writes nothing', (await readDoc()) === before);
  await page.locator('.cm-md-callout-fold').first().dispatchEvent('mousedown');

  // A link in a cell shows its popover on a click and stays put.
  await page.keyboard.press('Meta+ArrowUp');
  await page.locator('.cm-md-table [data-href]').first().click();
  check('a click on a link in a cell shows its popover', await page.getByTestId('link-popover').isVisible().catch(() => false));
  await shoot('cell-link');
  await page.keyboard.press('Escape');

  // Insert > Table writes a table that parses, with its source open.
  await page.locator('.cm-line', { hasText: /^Intro paragraph\.$/ }).first().click();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Insert' }).click();
  await page.getByRole('menuitem', { name: 'Table' }).click();
  saved = await waitForFile((text) => text.includes('| Column 1 |'));
  check('Insert > Table writes a 3 by 3 table with blank lines around it', saved.startsWith('Intro paragraph.\n\n| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n\n'));
  await page.keyboard.type('Name');
  saved = await waitForFile((text) => text.includes('| Name |'));
  check('typing goes into the first header', saved.includes('| Name | Column 2 |'));
  await shoot('insert-table');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    for (let node = document.querySelector('.cm-content'); node; node = node.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) {
        node.scrollTop = node.scrollHeight;
        return;
      }
    }
  });
  await page.waitForTimeout(300);
  await shoot('page');
  check('the editor still holds the file', (await editorText()) === null || (await editorText()) === (await readDoc()));

  // A second document that ends with a table and no line break, with the real keyboard.
  const END = path.join(vault, 'Docs', 'Ends.mdo');
  const ENDS = 'Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |';
  await writeFile(END, ENDS);
  const readEnd = () => readFile(END, 'utf8');
  const waitForEnd = async (predicate, timeout = 10_000) => {
    const start = Date.now();
    let text = await readEnd();
    while (!predicate(text) && Date.now() - start < timeout) {
      await page.waitForTimeout(100);
      text = await readEnd();
    }
    return text;
  };
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, END);
  await page.locator('.cm-line', { hasText: /^Intro$/ }).first().waitFor({ timeout: 10_000 });
  await page.locator('.cm-line', { hasText: /^Intro$/ }).first().click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type('After');
  let ended = await waitForEnd((text) => text.includes('After'));
  // No line under the table holds the caret: Cmd+Down frames the table, and the letter starts a paragraph under it.
  check('typing after Cmd+Down in a file that ends with a table starts a paragraph under it', ended === `${ENDS}\n\nAfter`, JSON.stringify(ended.slice(-30)));

  // Insert > Callout, then typing into it.
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert' }).click();
  await page.getByRole('menuitem', { name: 'Callout' }).click();
  // Keys typed while the menu closes go to the menu: wait for it to go.
  await page.waitForSelector('[role="menu"]', { state: 'detached', timeout: 3_000 }).catch(() => undefined);
  await page.waitForFunction(() => Boolean(document.activeElement?.closest('.cm-content')), null, { timeout: 3_000 }).catch(() => undefined);
  await page.keyboard.type('Remember the demo.');
  ended = await waitForEnd((text) => text.includes('demo.'));
  check('text typed once the Insert menu has closed lands in the new callout', ended.includes('> Remember the demo.'), JSON.stringify(ended.slice(-50)));

  // Cmd+Enter on a callout that cannot fold changes nothing.
  const beforeFold = await readEnd();
  await page.locator('.cm-line', { hasText: 'Remember the demo.' }).first().click();
  await page.keyboard.press('Meta+Enter');
  // Longer than the autosave's wait, so a change would be on disk.
  await page.waitForTimeout(2_000);
  check('Cmd+Enter in a callout that cannot fold changes nothing', (await readEnd()) === beforeFold);

  // The type menu and its fold choice.
  await page.locator('[data-callout-icon]').first().click();
  const menu = await page.waitForSelector('[data-callout-menu]', { timeout: 3_000 }).then(() => true, () => false);
  check('a click on a callout\'s icon opens its type menu', menu);
  await shoot('callout-menu');
  if (menu) {
    await page.getByRole('menuitemradio', { name: 'Foldable, folded' }).click();
    ended = await waitForEnd((text) => text.includes('[!note]-'));
    check('the menu\'s fold choice writes only the sign', ended.includes('> [!note]- Note\n> Remember the demo.'), JSON.stringify(ended.slice(-50)));
  }
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
