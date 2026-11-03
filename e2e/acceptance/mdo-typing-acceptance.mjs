// Disposable Electron acceptance for typing in a document, with the real
// keyboard: type 2*3*4, a wiki link and 3.14, move by Option+Arrow across
// bold and a link, take a word out with Option+Backspace, select a list
// item's text with Shift+Cmd+Left and type over it, and Find and Replace a
// word that also sits in a link's address and a wiki link's target, with
// the Find bar over the page. Checks the saved bytes, and saves light and
// dark screenshots for review (never compared).
// Own userData and temp vault; run from the repository root after the Vite
// bundles are built: see README.md here.
//
//   node e2e/acceptance/mdo-typing-acceptance.mjs [--shots dir]
import { _electron as electron } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const args = process.argv.slice(2);
const shotsFlag = args.indexOf('--shots');
const shotsDir = path.resolve(shotsFlag !== -1 ? args[shotsFlag + 1] : path.join('e2e', 'out', 'typing'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const BODY = [
  '# Typing',
  '',
  'Math: ',
  '',
  'Move **bold words** and [a plan link](https://example.com/plan) here.',
  '',
  '- first item text',
  '',
  'The plan is in [[Plan]] and at https://plan.example.com/plan today.',
  '',
  'Typed: ',
  '',
].join('\n');

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-typing-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-typing-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Notes'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const DOC = `${vault}/Notes/typing.mdo`;
await writeFile(DOC, BODY);
await writeFile(path.join(vault, 'Notes', 'Plan.md'), '# Plan\n');
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
await mkdir(shotsDir, { recursive: true });

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

const view = (body) => page.evaluate(body);
const text = () => view(() => document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
/** Puts the caret at `offset` characters into the first line holding `needle`, or at its end. */
const caretAt = (needle, offset = null) => page.evaluate(({ needle: find, offset: at }) => {
  const editor = document.querySelector('.cm-content').cmTile.root.view;
  const doc = editor.state.doc.toString();
  const start = doc.indexOf(find);
  editor.focus();
  editor.dispatch({ selection: { anchor: at === null ? start + find.length : start + at }, userEvent: 'select' });
}, { needle, offset });
const shown = () => page.evaluate(() => {
  const editor = document.querySelector('.cm-content').cmTile.root.view;
  const { head } = editor.state.selection.main;
  const line = editor.state.doc.lineAt(head);
  return { head, before: editor.state.sliceDoc(line.from, head) };
});
const saved = async (predicate, timeout = 8_000) => {
  const start = Date.now();
  let bytes = await readFile(DOC, 'utf8');
  while (!predicate(bytes) && Date.now() - start < timeout) {
    await page.waitForTimeout(150);
    bytes = await readFile(DOC, 'utf8');
  }
  return bytes;
};

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
    await page.screenshot({ path: path.join(shotsDir, `${name}-${theme}.png`) });
  }
  await setTheme('light');
}

try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 760));
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, DOC);
  await page.getByTestId('markdown-editor').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);

  // 2*3*4 shows as typed and is written with the closing star escaped.
  await caretAt('Math: ');
  await page.keyboard.type('2*3*4', { delay: 30 });
  check('2*3*4 shows as typed', (await text()).includes('Math: 2*3\\*4'), JSON.stringify((await text()).split('\n')[2]));

  // A wiki link typed by hand keeps its brackets, and a number with a decimal point at a line start keeps its bytes.
  await caretAt('Typed: ');
  await page.keyboard.type('[[Plan]] and', { delay: 30 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('3.14 is pi', { delay: 30 });
  check('a typed wiki link and 3.14 keep their bytes', (await text()).includes('Typed: [[Plan]] and\n3.14 is pi'), JSON.stringify((await text()).split('\n').slice(10, 12)));

  // Option+Right moves one visible word at a time across bold and a link.
  await caretAt('Move ', 0);
  const stops = [];
  for (let press = 0; press < 6; press += 1) {
    await page.keyboard.press('Alt+ArrowRight');
    stops.push(await view(() => {
      const editor = document.querySelector('.cm-content').cmTile.root.view;
      const { head } = editor.state.selection.main;
      return editor.state.sliceDoc(editor.state.doc.lineAt(head).from, head).replace(/\*\*|\[|\]\([^)]*\)/g, '');
    }));
  }
  check('Option+Right stops after each visible word', stops.join(' | ') === 'Move | Move bold | Move bold words | Move bold words and | Move bold words and a | Move bold words and a plan', stops.join(' | '));
  await page.keyboard.press('Alt+ArrowLeft');
  await page.keyboard.press('Alt+ArrowLeft');
  check('Option+Left goes back by visible words', (await shown()).before.replace(/\*\*|\[|\]\([^)]*\)/g, '') === 'Move bold words and ');

  // Option+Backspace after "words" keeps the bold marks on "bold".
  await caretAt('bold words', 10);
  await page.keyboard.press('Alt+Backspace');
  check('Option+Backspace keeps the marks on what is left', (await text()).includes('Move **bold**  and'), JSON.stringify((await text()).split('\n')[4]));

  // Shift+Cmd+Left then typing keeps the bullet.
  await caretAt('first item text');
  await page.keyboard.press('Meta+Shift+ArrowLeft');
  await page.keyboard.type('replaced', { delay: 20 });
  check('Shift+Cmd+Left then typing keeps the bullet', (await text()).includes('\n- replaced\n'), JSON.stringify((await text()).split('\n')[6]));
  await shoot('typing-page');

  // Enter inside bold keeps both halves bold.
  await page.evaluate(() => {
    const editor = document.querySelector('.cm-content').cmTile.root.view;
    const end = editor.state.doc.length;
    editor.dispatch({ changes: { from: end, insert: '\n**split here**\n' } });
  });
  await caretAt('**split', 7);
  await page.keyboard.press('Enter');
  check('Enter inside bold keeps both halves bold', (await text()).includes('**split**\n**here**'), JSON.stringify((await text()).slice(-24)));

  // The first undo after "# " shows the mark as text, from Cmd+Z and from Edit > Undo alike.
  // Edit > Undo is the menu's undo role, which runs the page's undo command, as webContents.undo() does.
  const undoFromMenu = () => app.evaluate(({ Menu, BrowserWindow }) => {
    const find = (items) => items.flatMap((item) => [item, ...(item.submenu ? find(item.submenu.items) : [])]);
    if (!find(Menu.getApplicationMenu().items).some((item) => item.role === 'undo')) throw new Error('no Edit > Undo');
    BrowserWindow.getAllWindows()[0].webContents.undo();
  });
  for (const [name, undo] of [['Cmd+Z', () => page.keyboard.press('Meta+z')], ['Edit > Undo', undoFromMenu]]) {
    await page.evaluate(() => {
      const editor = document.querySelector('.cm-content').cmTile.root.view;
      const end = editor.state.doc.length;
      editor.dispatch({ changes: { from: end, insert: '\n' }, selection: { anchor: end + 1 } });
    });
    await page.waitForTimeout(600);
    await page.keyboard.type('# ', { delay: 30 });
    const formatted = (await text()).endsWith('\n# ');
    await undo();
    await page.waitForTimeout(150);
    check(`${name} right after "# " shows the mark as text`, formatted && (await text()).endsWith('\n\\# '), JSON.stringify((await text()).slice(-8)));
    await undo();
    await page.waitForTimeout(150);
    check(`a second ${name} takes the typing back`, (await text()).endsWith('\n'), JSON.stringify((await text()).slice(-8)));
  }

  // Find and Replace All: "plan" in visible text only.
  await caretAt('# Typing', 0);
  const titleTop = () => page.evaluate(() => document.querySelector('.cm-content .cm-line')?.getBoundingClientRect().top ?? null);
  const beforeFind = await titleTop();
  await page.keyboard.press('Meta+f');
  const search = page.locator('.cm-search input[name="search"]');
  await search.waitFor({ timeout: 5_000 });
  const afterFind = await titleTop();
  check('opening Find moves nothing on the page', beforeFind !== null && afterFind !== null && Math.abs(afterFind - beforeFind) < 1, `${beforeFind} then ${afterFind}`);
  await search.fill('plan');
  await page.locator('.cm-search input[name="replace"]').fill('roadmap');
  await shoot('typing-find');
  await page.locator('.cm-search button[name="replaceAll"]').click();
  await page.waitForTimeout(300);
  const kept = await page.evaluate(() => document.querySelectorAll('.cm-content .opal-searchKept').length);
  const status = await page.getByText(/^Replaced \d+ of \d+\./).first().textContent({ timeout: 3_000 }).catch(() => null);
  // The bare URL's two matches are drawn apart; a wiki link is one object in a document, with no match drawn inside it.
  check('matches Replace kept are drawn apart, and a status message counts them', kept >= 2 && /^Replaced 2 of \d+\./.test(status ?? ''), `${kept} kept; ${status}`);
  await shoot('typing-replaced');
  const replaced = await text();
  check('Replace All changes the link text and the sentence', replaced.includes('[a roadmap link](https://example.com/plan)') && replaced.includes('The roadmap is in'), JSON.stringify(replaced.split('\n')[8]));
  check('Replace All leaves the link address, the wiki link target and the bare URL', replaced.includes('(https://example.com/plan)') && replaced.includes('[[Plan]]') && replaced.includes('https://plan.example.com/plan'));

  // A match that starts in plain text and ends inside bold, then Cmd+Z and Shift+Cmd+Z with focus on the bar's button.
  await page.evaluate(() => {
    const editor = document.querySelector('.cm-content').cmTile.root.view;
    const end = editor.state.doc.length;
    editor.dispatch({ changes: { from: end, insert: 'Intro with **bold words**, more.\n' } });
  });
  await search.fill('with bold');
  await page.locator('.cm-search input[name="replace"]').fill('with Strong');
  await page.waitForTimeout(200);
  const count = await page.locator('.cm-search .opal-searchCount').textContent();
  check('the Find bar counts the matches', count === '1 match', JSON.stringify(count));
  await page.locator('.cm-search button[name="replaceAll"]').click();
  await page.waitForTimeout(200);
  check('Replace All across a bold opener keeps the rest bold with no stars', (await text()).includes('Intro with Strong **words**, more.'), JSON.stringify((await text()).split('\n').at(-2)));
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(200);
  check('Cmd+Z on the Replace all button undoes the replace', (await text()).includes('Intro with **bold words**, more.'), JSON.stringify((await text()).split('\n').at(-2)));
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForTimeout(200);
  check('Shift+Cmd+Z there redoes it', (await text()).includes('Intro with Strong **words**, more.'), JSON.stringify((await text()).split('\n').at(-2)));

  // The options are toggles reached by Tab, with a focus ring, toggled by Space.
  await search.fill('');
  await search.focus();
  for (let index = 0; index < 4; index += 1) await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const active = document.activeElement;
    const label = active?.closest('label');
    return { name: active?.getAttribute('name'), outline: label ? getComputedStyle(label).outlineStyle : null };
  });
  await page.keyboard.press('Space');
  const toggled = await page.evaluate(() => document.querySelector('.cm-search input[name="case"]').checked);
  check('Tab reaches Match case, which shows a focus ring and toggles with Space', focused.name === 'case' && focused.outline === 'solid' && toggled, JSON.stringify({ ...focused, toggled }));
  await search.fill('plan');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  for (let index = 0; index < 3; index += 1) await page.keyboard.press('Tab');
  await shoot('typing-find-toggles');
  await page.locator('.cm-search input[name="case"]').uncheck();
  await page.keyboard.press('Escape');

  // Edit > Paste and Match Style is the page's command, so a click pastes literally too.
  const pasteItem = await app.evaluate(({ Menu }) => {
    const find = (items) => items.flatMap((item) => [item, ...(item.submenu ? find(item.submenu.items) : [])]);
    const item = find(Menu.getApplicationMenu().items).find((entry) => entry.label === 'Paste and Match Style');
    return item ? { role: item.role ?? null, accelerator: item.accelerator ?? null } : null;
  });
  check('Edit > Paste and Match Style runs the page\'s literal paste', pasteItem !== null && !pasteItem.role && pasteItem.accelerator === 'CmdOrCtrl+Shift+V', JSON.stringify(pasteItem));
  // A click on the item, with the page's clipboard read stubbed so the system clipboard is never read or written.
  await page.evaluate(() => {
    const editor = document.querySelector('.cm-content').cmTile.root.view;
    const end = editor.state.doc.length;
    editor.dispatch({ changes: { from: end, insert: '\nPasted: ' }, selection: { anchor: end + 9 } });
    editor.focus();
    Object.defineProperty(navigator.clipboard, 'readText', { configurable: true, value: async () => '**x** and _y_' });
  });
  await app.evaluate(({ Menu }) => {
    const find = (items) => items.flatMap((item) => [item, ...(item.submenu ? find(item.submenu.items) : [])]);
    find(Menu.getApplicationMenu().items).find((entry) => entry.label === 'Paste and Match Style').click();
  });
  await page.waitForTimeout(400);
  const pasted = (await text()).split('\n').find((line) => line.startsWith('Pasted: '));
  check('a click on Paste and Match Style pastes literally, once', pasted === 'Pasted: \\*\\*x\\*\\* and \\_y\\_', JSON.stringify(pasted));

  const final = await text();
  await page.keyboard.press('Meta+s');
  const bytes = await saved((written) => written === final);
  check('the file holds what the page shows', bytes === final && final.startsWith(replaced), JSON.stringify(bytes.slice(0, 120)));

  // The gallery fixture's lower half, with a selection so the footer counts its words.
  const fixture = `${vault}/Notes/typing-gallery.mdo`;
  await copyFile(path.join(PROJECT_ROOT, 'e2e', 'fixtures', 'gallery', 'typing.mdo'), fixture);
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, fixture);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('Links over half-bold text'), null, { timeout: 15_000 });
  await caretAt('**b**[**old** t]', 0);
  await page.evaluate(() => {
    const editor = document.querySelector('.cm-content').cmTile.root.view;
    const doc = editor.state.doc.toString();
    const from = doc.indexOf('A [plan link]');
    editor.dispatch({ selection: { anchor: from, head: doc.indexOf(':', from) }, scrollIntoView: true });
  });
  await page.waitForTimeout(500);
  const footer = await page.locator('[data-properties-toggle]').first().textContent();
  check('the footer counts the selected words', /^\d+ of \d+ words$/.test(footer ?? ''), footer ?? '');
  await page.evaluate(() => { for (const scroller of document.querySelectorAll('.cm-scroller')) scroller.scrollTop = scroller.scrollHeight; });
  await page.waitForTimeout(300);
  await shoot('typing-fixture-end');
} catch (error) {
  check('runs', false, String(error));
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
  await rm(vaultParent, { recursive: true, force: true });
}

if (errors.length > 0) check('no page errors', false, errors.join(' | '));
const failed = results.filter((result) => !result.ok).length;
console.log(`${failed === 0 ? 'PASS' : 'FAIL'} ${results.length - failed} of ${results.length} checks; screenshots in ${shotsDir}`);
process.exit(failed === 0 ? 0 : 1);
