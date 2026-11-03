// Disposable Electron acceptance for typing in a document, with the real
// keyboard: type 2*3*4, move by Option+Arrow across bold and a link, take a
// word out with Option+Backspace, select a list item's text with
// Shift+Cmd+Left and type over it, and Find and Replace a word that also
// sits in a link's address and a wiki link's target. Checks the saved
// bytes, and saves light and dark screenshots for review (never compared).
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

  // Find and Replace All: "plan" in visible text only.
  await caretAt('# Typing', 0);
  await page.keyboard.press('Meta+f');
  const search = page.locator('.cm-search input[name="search"]');
  await search.waitFor({ timeout: 5_000 });
  await search.fill('plan');
  await page.locator('.cm-search input[name="replace"]').fill('roadmap');
  await shoot('typing-find');
  await page.locator('.cm-search button[name="replaceAll"]').click();
  await page.waitForTimeout(200);
  const replaced = await text();
  check('Replace All changes the link text and the sentence', replaced.includes('[a roadmap link](https://example.com/plan)') && replaced.includes('The roadmap is in'), JSON.stringify(replaced.split('\n')[8]));
  check('Replace All leaves the link address, the wiki link target and the bare URL', replaced.includes('(https://example.com/plan)') && replaced.includes('[[Plan]]') && replaced.includes('https://plan.example.com/plan'));
  await page.keyboard.press('Escape');

  await page.keyboard.press('Meta+s');
  const bytes = await saved((written) => written.includes('roadmap'));
  check('the file holds what the page shows', bytes === replaced, JSON.stringify(bytes));

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
