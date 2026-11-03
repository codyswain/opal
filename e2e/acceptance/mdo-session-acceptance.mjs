// Disposable Electron acceptance for one realistic session in a new
// document: Cmd+N, a heading and a paragraph, Cmd+B on a word, a numbered
// list nested with Tab and Shift+Tab, Insert > Table with a typed header,
// a code block from ```ts and Enter, an inline formula closed by a typed $,
// a display formula from $$ and Enter, a dropped picture, PDF and deck,
// Show as and Size from the object bar, Find and Replace All, and undo back
// through the last steps. After every step it checks the file's bytes on
// disk. Saves light and dark screenshots at the end for people to look at;
// nothing compares them. Own userData and temp vault; run from the
// repository root after the Vite bundles are built (see README.md here):
//
//   node e2e/acceptance/mdo-session-acceptance.mjs [--shots dir]
import { _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { pdf, png } from '../fixtures/gallery/files.setup.mjs';

const PROJECT_ROOT = process.cwd();
const args = process.argv.slice(2);
const shotsFlag = args.indexOf('--shots');
const shotsDir = path.resolve(shotsFlag !== -1 ? args[shotsFlag + 1] : path.join('e2e', 'out', 'session'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-session-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-session-vault-'));
await mkdir(path.join(vaultParent, 'Vault', '.opal'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
await mkdir(path.join(vault, '.git'), { recursive: true });
await writeFile(path.join(vault, '.opal/files.json'), JSON.stringify({ version: 1, folder: 'Library/files', store: 'git-lfs' }));
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
await mkdir(shotsDir, { recursive: true });
const DOC = path.join(vault, 'Untitled.mdo');

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
await app.evaluate(({ shell }) => {
  shell.openPath = async () => '';
  shell.showItemInFolder = () => undefined;
});
// A run that stops answering fails rather than holding the Electron lock.
const watchdog = setTimeout(() => {
  console.log('FAIL the run stopped answering after 5 minutes');
  void app.close().finally(() => process.exit(1));
}, 300_000);
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

const text = () => page.evaluate(() => document.querySelector('.cm-content')?.cmTile.root.view.state.doc.toString() ?? null);
const readDoc = () => readFile(DOC, 'utf8').catch(() => null);
const shown = () => page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '');

/** Waits until the file on disk matches `want` (bytes or a test), saving once if autosave is slow. */
async function onDisk(want, timeout = 8_000) {
  const matches = (bytes) => bytes !== null && (typeof want === 'function' ? want(bytes) : bytes === want);
  const start = Date.now();
  let bytes = await readDoc();
  let saved = false;
  while (!matches(bytes) && Date.now() - start < timeout) {
    if (!saved && Date.now() - start > timeout / 2) {
      saved = true;
      await page.keyboard.press('Meta+s');
    }
    await page.waitForTimeout(150);
    bytes = await readDoc();
  }
  return bytes;
}

let step = 0;
/** Runs one edit, then checks the file's bytes. `want` is the whole file, or a test of it. */
async function edit(name, act, want) {
  step += 1;
  await act();
  const bytes = await onDisk(want);
  const ok = bytes !== null && (typeof want === 'function' ? want(bytes) : bytes === want);
  check(`${String(step).padStart(2, '0')} ${name}`, ok, ok ? '' : `file is ${JSON.stringify(bytes)}${typeof want === 'string' ? `, wanted ${JSON.stringify(want)}` : ''}`);
  return bytes ?? '';
}

const type = (keys) => page.keyboard.type(keys, { delay: 25 });
const press = async (...keys) => {
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(40);
  }
};

/** The centre of `word`'s first appearance in the page's text, for a real double-click. */
const wordAt = (word) => page.evaluate((find) => {
  const walker = document.createTreeWalker(document.querySelector('.cm-content'), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent.search(new RegExp(`\\b${find}\\b`));
    if (at === -1) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + find.length);
    const box = range.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }
  return null;
}, word);

/** Drops one file at the bottom of the page, below everything on it, as from Finder. */
async function drop(file) {
  await page.evaluate((one) => {
    const content = document.querySelector('.cm-content');
    const box = content.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(one.bytes)], one.name, { type: one.type }));
    content.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: box.left + 10, clientY: box.bottom - 4 }));
  }, file);
}

async function setTheme(theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((resolved) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  }, theme);
  await page.waitForTimeout(300);
}

/** The editor, a screen at a time from the top, light and dark. */
async function pageShots() {
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    await page.evaluate(() => { document.querySelector('.cm-scroller').scrollTop = 0; });
    for (let part = 1; part <= 6; part += 1) {
      await page.waitForTimeout(700);
      await page.locator('.opal-editor').first().screenshot({ path: path.join(shotsDir, `session-${theme}-${part}.png`) });
      const end = await page.evaluate(() => {
        const scroller = document.querySelector('.cm-scroller');
        const before = scroller.scrollTop;
        scroller.scrollTop += scroller.clientHeight - 80;
        return scroller.scrollTop === before;
      });
      if (end) break;
    }
  }
  await setTheme('light');
}

const FILE = (stem, ext) => new RegExp(`Library/files/\\d{4}-\\d{2}/${stem}\\.[0-9a-f]{8}\\.${ext}`);

try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 1000));
  await page.getByTestId('workspace-sidebar').waitFor({ timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(800);

  // 1. File > New Document (Cmd+N, a menu accelerator) makes a new, empty document and opens it.
  let doc = await edit('File > New Document makes an empty document', async () => {
    await app.evaluate(({ Menu }) => {
      const find = (items) => items.flatMap((item) => [item, ...(item.submenu ? find(item.submenu.items) : [])]);
      find(Menu.getApplicationMenu().items).find((entry) => entry.label === 'New Document').click();
    });
    await page.getByTestId('markdown-editor').first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(600);
    await page.locator('.cm-content').first().click();
  }, '');

  // 2 and 3. A heading and a paragraph.
  doc = await edit('a typed "# " makes a heading', () => type('# Weekly plan'), '# Weekly plan');
  doc = await edit('Enter, then a paragraph', async () => {
    await press('Enter');
    await type('The team ships the new editor this week.');
  }, '# Weekly plan\nThe team ships the new editor this week.');

  // 4. A double-click on a word and Cmd+B.
  doc = await edit('a double-click on "new" and Cmd+B bold the word', async () => {
    const at = await wordAt('new');
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForTimeout(150);
    await press('Meta+b');
  }, '# Weekly plan\nThe team ships the **new** editor this week.');

  // 5 to 9. A numbered list, nested with Tab, back out with Shift+Tab, ended with a second Enter.
  const intro = '# Weekly plan\nThe team ships the **new** editor this week.';
  doc = await edit('a numbered list starts from "1. "', async () => {
    await press('Meta+ArrowDown', 'Enter');
    await type('1. Draft the outline');
  }, `${intro}\n1. Draft the outline`);
  doc = await edit('Enter continues the list at 2', async () => {
    await press('Enter');
    await type('Write the tests');
  }, `${intro}\n1. Draft the outline\n2. Write the tests`);
  doc = await edit('Enter and Tab nest the next item under 2', async () => {
    await press('Enter', 'Tab');
    await type('Unit tests');
  }, (bytes) => /\n2\. Write the tests\n[ \t]+\d+\. Unit tests$/.test(bytes) && bytes.startsWith(`${intro}\n1. Draft the outline\n`));
  const nested = doc;
  doc = await edit('Enter and Shift+Tab bring the next item back out', async () => {
    await press('Enter', 'Shift+Tab');
    await type('Ship on Friday');
  }, (bytes) => bytes.startsWith(nested) && /\n\d+\. Ship on Friday$/.test(bytes.slice(nested.length)));
  const listed = doc;
  doc = await edit('Enter twice ends the list, and a paragraph follows', async () => {
    await press('Enter', 'Enter');
    await type('Owners are below.');
  }, (bytes) => bytes.startsWith(listed) && /\n\n?Owners are below\.$/.test(bytes.slice(listed.length)));

  // 10 and 11. Insert > Table, then a header typed into its first cell.
  const beforeTable = doc;
  doc = await edit('Insert > Table writes a 3 by 3 table under the paragraph', async () => {
    await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Insert' }).click();
    await page.getByRole('menuitem', { name: 'Table' }).click();
  }, `${beforeTable}\n\n| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n`);
  doc = await edit('typing goes into the first header cell', () => type('Owner'), `${beforeTable}\n\n| Owner | Column 2 | Column 3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n`);
  const tabled = doc;

  // 12. Escape, then a paragraph under the table keeps a blank line above it.
  doc = await edit('a paragraph typed under the table keeps a blank line above it', async () => {
    await press('Escape');
    await page.waitForTimeout(200);
    await page.locator('.cm-content').first().focus();
    await press('Meta+ArrowDown');
    await type('Code for the release:');
  }, (bytes) => bytes === `${tabled}\nCode for the release:` || bytes === `${tabled}\n\nCode for the release:`);
  const beforeCode = doc;

  // 13 and 14. ```ts and Enter make a code block; the code goes in it.
  doc = await edit('```ts and Enter make a code block with both fences', async () => {
    await press('Enter');
    await type('```ts');
    await press('Enter');
  }, (bytes) => bytes.startsWith(`${beforeCode}\n\`\`\`ts\n`) && bytes.endsWith('```'));
  doc = await edit('code typed in the block lands between the fences, unescaped', () => type('const answer = 42 * 2;'), (bytes) => bytes.includes('```ts\nconst answer = 42 * 2;\n```'));
  const coded = doc;

  // 15. Cmd+Down leaves the block; an inline formula closes on its typed $.
  doc = await edit('a typed closing $ makes an inline formula', async () => {
    await press('Meta+ArrowDown');
    await type('Area is $\\pi r^2$ for a circle.');
  }, (bytes) => bytes.startsWith(coded) && /```\n\n?Area is \$\\pi r\^2\$ for a circle\.$/.test(bytes));
  const inline = await page.locator('.cm-math').count();
  check('the inline formula draws with KaTeX', inline >= 1 && await page.locator('.cm-math .katex').count() >= 1, `${inline} formulas`);

  // 16. $$ and Enter open the popover; Done writes a display block.
  const beforeDisplay = doc;
  doc = await edit('$$ and Enter open the formula popover, and Done writes a display block', async () => {
    await press('Enter');
    await type('$$');
    await press('Enter');
    const popover = page.getByTestId('math-popover');
    await popover.waitFor({ timeout: 5_000 });
    await popover.getByRole('textbox', { name: 'TeX' }).pressSequentially('E = mc^2', { delay: 25 });
    await popover.getByRole('button', { name: 'Done' }).click();
    await popover.waitFor({ state: 'detached', timeout: 5_000 });
  }, (bytes) => bytes.startsWith(beforeDisplay) && bytes.slice(beforeDisplay.length).replace(/^\n+/, '').startsWith('$$\nE = mc^2\n$$'));
  check('the display formula draws centred', await page.locator('.cm-math-display, .cm-math[data-display]').count() >= 1 || await page.locator('.katex-display').count() >= 1);

  // 17 to 19. A picture, a PDF and a deck dropped at the end.
  await press('Meta+ArrowDown');
  const beforeDrops = await text();
  doc = await edit('a dropped picture goes in as a preview', () => drop({ name: 'Chart.png', type: 'image/png', bytes: [...png(320, 180, (x) => [Math.round((x / 320) * 200) + 30, 255])] }), (bytes) => bytes.startsWith(beforeDrops.trimEnd()) && new RegExp(`\\n!\\[\\[${FILE('chart', 'png').source}(\\|\\d+)?\\]\\]$`).test(bytes));
  const picture = doc;
  doc = await edit('a dropped PDF goes in as a preview with its name', () => drop({ name: 'Q3 numbers.pdf', type: 'application/pdf', bytes: [...pdf(['Q3 numbers', 'Detail'])] }), (bytes) => bytes.startsWith(picture) && new RegExp(`\\n!\\[\\[${FILE('q3-numbers', 'pdf').source}\\|Q3 numbers\\.pdf\\]\\]$`).test(bytes));
  const withPdf = doc;
  doc = await edit('a dropped deck goes in as a card link with its name', () => drop({ name: 'Pitch deck.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes: [...Buffer.from('PK\u0003\u0004 deck', 'latin1')] }), (bytes) => bytes.startsWith(withPdf) && new RegExp(`\\n\\[\\[${FILE('pitch-deck', 'pptx').source}\\|Pitch deck\\.pptx\\]\\]$`).test(bytes));
  const dropped = doc;
  const pdfLine = dropped.split('\n').find((line) => line.includes('.pdf|'));
  const pictureLine = dropped.split('\n').find((line) => line.includes('.png'));
  await page.waitForTimeout(1200);
  check('the deck shows as a card with its kind', (await page.locator('.cm-file-card', { hasText: 'PowerPoint' }).count()) === 1);
  check('the PDF shows as a preview with its footer', (await page.locator('.cm-file-pdf').count()) === 1);

  // 20. Show as > Card on the PDF.
  const bar = page.locator('[data-object-bar]');
  doc = await edit('Show as > Card turns the PDF preview into a card link', async () => {
    await page.locator('.cm-file-pdf').first().click();
    await bar.waitFor({ timeout: 5_000 });
    await bar.getByRole('button', { name: 'Show as' }).click();
    await page.getByRole('menuitem', { name: 'Card' }).click();
  }, dropped.replace(pdfLine, pdfLine.slice(1)));
  const carded = doc;
  check('the PDF now draws as a card', (await page.locator('.cm-file-card', { hasText: 'PDF' }).count()) === 1);

  // 21. Size > Small on the picture.
  doc = await edit('Size > Small writes the picture\'s width', async () => {
    await press('Escape');
    await page.locator('.cm-md-image img').first().click();
    await bar.waitFor({ timeout: 5_000 });
    await bar.getByRole('button', { name: 'Size' }).click();
    await page.getByRole('menuitem', { name: 'Small' }).click();
  }, carded.replace(pictureLine, pictureLine.replace(/(\|\d+)?\]\]$/, '|240]]')));
  const sized = doc;

  // 22. Find and Replace All of a word in two list items.
  doc = await edit('Replace All turns "tests" into "checks" in the visible text', async () => {
    await press('Escape');
    await page.locator('.cm-content').first().focus();
    await press('Meta+f');
    const search = page.locator('.cm-search input[name="search"]');
    await search.waitFor({ timeout: 5_000 });
    await search.fill('tests');
    await page.locator('.cm-search input[name="replace"]').fill('checks');
    await page.locator('.cm-search button[name="replaceAll"]').click();
    await page.waitForTimeout(300);
  }, sized.replace('Write the tests', 'Write the checks').replace('Unit tests', 'Unit checks'));
  // The status message names only matches Replace kept; with none kept there is none.
  const status = await page.getByText(/^Replaced \d+ of \d+\./).first().textContent({ timeout: 1_000 }).catch(() => null);
  check('Replace All with nothing kept shows no kept-matches message', status === null, String(status));

  // 23 to 25. Undo back through Replace All, Size and Show as.
  await press('Escape');
  await page.locator('.cm-content').first().focus();
  doc = await edit('Cmd+Z takes back Replace All in one step', () => press('Meta+z'), sized);
  doc = await edit('Cmd+Z takes back the size', () => press('Meta+z'), carded);
  doc = await edit('Cmd+Z takes back Show as', () => press('Meta+z'), dropped);
  doc = await edit('Shift+Cmd+Z puts Show as back', () => press('Meta+Shift+z'), carded);

  // 26. Cmd+Down frames the deck card that ends the page, and Backspace removes it.
  doc = await edit('Cmd+Down frames the deck card at the page\'s end and changes nothing', () => press('Meta+ArrowDown'), (bytes) => bytes === carded || bytes === `${carded}\n`);
  await page.waitForTimeout(300);
  check('the framed card shows the bar', await bar.count() === 1);
  doc = await edit('Backspace removes the framed card', () => press('Backspace'), (bytes) => !bytes.includes('pitch-deck') && bytes.startsWith(carded.slice(0, carded.lastIndexOf('\n'))));
  doc = await edit('Cmd+Z brings the card back', () => press('Meta+z'), (bytes) => bytes.includes('pitch-deck') && bytes.startsWith(carded));

  // The page shows no Markdown, and the file holds what the page holds.
  const visible = await shown();
  check('the page shows no Markdown marks', !/\*\*|```|\$\$|!\[\[|\]\]/.test(visible), visible.match(/\*\*|```|\$\$|!\[\[|\]\]/)?.[0] ?? '');
  await press('Meta+s');
  const final = await onDisk(await text());
  check('the file holds what the page holds', final === (await text()));
  await writeFile(path.join(shotsDir, 'session.mdo.txt'), final ?? '');

  await press('Escape');
  await page.evaluate(() => document.activeElement?.blur());
  await pageShots();
} catch (error) {
  check('the run finished', false, String(error));
} finally {
  clearTimeout(watchdog);
  await app.close();
  await rm(userData, { recursive: true, force: true });
  await rm(vaultParent, { recursive: true, force: true });
}

check('no page errors', errors.length === 0, errors.join(' | '));
const failed = results.filter((result) => !result.ok).length;
console.log(`${failed === 0 ? 'PASS' : 'FAIL'} ${results.length - failed} of ${results.length} checks; screenshots in ${shotsDir}`);
process.exit(failed === 0 ? 0 : 1);
