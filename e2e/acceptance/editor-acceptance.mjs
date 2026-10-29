// Disposable Electron acceptance for Markdown editing: open a note without
// writing it, type and autosave with frontmatter preserved, follow an
// external edit while clean, merge one while dirty, show both sides of a
// conflict, give an empty note the caret, and make a new note from the File
// menu. Own userData and temp vault; run from the repository root after the
// Vite bundles are built: see README.md here.
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, stat } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-editor-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-editor-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Notes'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const NOTE = `${vault}/Notes/brief.md`;
const EMPTY = `${vault}/Notes/empty.md`;
const FRONTMATTER = '---\r\ntags: [research]\r\nannotation: Keep me\r\n---\r\n';
const ORIGINAL = `${FRONTMATTER}# Brief\r\n\r\nFirst line.  \r\nSecond line, no newline at the end`;
await writeFile(NOTE, ORIGINAL);
await writeFile(EMPTY, '');
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

const open = (file) => page.evaluate((target) => {
  window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`;
}, file);
const editorText = () => page.locator('.cm-content').textContent();
const waitForState = async (state, timeout = 10_000) =>
  page.waitForFunction((expected) => document.querySelector('[data-testid="editor-save-state"]')?.getAttribute('data-state') === expected, state, { timeout });
const waitForFile = async (predicate, timeout = 10_000) => {
  const start = Date.now();
  let text = await readFile(NOTE, 'utf8');
  while (!predicate(text)) {
    if (Date.now() - start > timeout) return text;
    await page.waitForTimeout(100);
    text = await readFile(NOTE, 'utf8');
  }
  return text;
};

try {
  const before = (await stat(NOTE)).mtimeMs;
  await open(NOTE);
  const editor = page.getByTestId('markdown-editor');
  await editor.waitFor();
  check('opens the note without showing frontmatter', (await editorText()).includes('First line.') && !(await editorText()).includes('tags:'));
  check('opens at the top without focus', await page.evaluate(() => !document.activeElement?.closest('.cm-editor')));
  await editor.click();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(1200);
  check('opening, focusing and blurring writes nothing', (await readFile(NOTE, 'utf8')) === ORIGINAL && (await stat(NOTE)).mtimeMs === before);

  // Type at the end and let autosave run.
  await editor.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type('.');
  await waitForState('saved');
  const saved = await waitForFile((text) => text.endsWith('end.'));
  check('autosaves exactly the typed character', saved === `${ORIGINAL}.`, JSON.stringify(saved.slice(-40)));

  // Cmd+S flushes immediately.
  await page.keyboard.type(' Flushed.');
  await page.keyboard.press('Meta+s');
  const flushed = await waitForFile((text) => text.includes('Flushed.'), 3_000);
  check('Cmd+S saves right away', flushed.endsWith('end. Flushed.'));

  // An external edit while clean is applied in place.
  await waitForState('saved');
  await writeFile(NOTE, `${await readFile(NOTE, 'utf8')}\r\nAppended outside Opal.\r\n`);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('Appended outside Opal.'), null, { timeout: 10_000 });
  check('follows an external edit while clean', (await page.getByTestId('editor-save-state').getAttribute('data-state')) === 'clean');

  // An external edit on another line while dirty merges, and both are saved.
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.type(' Mine');
  await writeFile(NOTE, `${await readFile(NOTE, 'utf8')}Theirs at the end.\r\n`);
  const merged = await waitForFile((text) => text.includes('# Brief Mine') && text.includes('Theirs at the end.'));
  check('merges an external edit on another line into unsaved edits', merged.includes('# Brief Mine') && merged.includes('Theirs at the end.') && merged.startsWith(FRONTMATTER));

  // The same line changed on both sides: both are shown and Keep mine wins.
  await waitForState('saved');
  await page.keyboard.type(' again');
  await writeFile(NOTE, (await readFile(NOTE, 'utf8')).replace('# Brief Mine', '# Brief from disk'));
  await page.getByTestId('editor-conflict').waitFor({ timeout: 10_000 });
  check('conflict shows the disk side in the page', (await page.locator('.cm-deletedChunk').textContent()).includes('# Brief from disk'));
  check('the refused side stays on disk until a pick', (await readFile(NOTE, 'utf8')).includes('# Brief from disk'));
  await page.getByTestId('editor-conflict').getByRole('button', { name: 'Keep mine' }).click();
  const kept = await waitForFile((text) => text.includes('# Brief Mine again'));
  check('Keep mine saves the page text', kept.includes('# Brief Mine again') && kept.includes('Theirs at the end.') && kept.startsWith(FRONTMATTER));

  // An empty note gets the caret, so typing goes straight in.
  await open(EMPTY);
  await page.waitForFunction(() => document.activeElement?.closest('.cm-editor') !== null, null, { timeout: 10_000 });
  await page.keyboard.type('# Fresh note');
  await page.waitForTimeout(1500);
  check('an empty note takes typing at once and autosaves', (await readFile(EMPTY, 'utf8')) === '# Fresh note');

  // New note, from the File menu: it lands next to the open note and gets the caret.
  await app.evaluate(({ Menu }) => {
    for (const menu of Menu.getApplicationMenu()?.items ?? []) {
      const item = menu.submenu?.items.find((candidate) => candidate.label === 'New Note');
      if (item) return item.click();
    }
  });
  await page.waitForFunction(() => window.location.hash.includes('Untitled.md'), null, { timeout: 10_000 });
  check('New note creates Untitled.md and opens it', (await readdir(`${vault}/Notes`)).includes('Untitled.md'));
  await page.waitForFunction(() => document.activeElement?.closest('.cm-editor') !== null, null, { timeout: 10_000 });
  await page.keyboard.type('# Another note');
  await page.waitForTimeout(1500);
  check('a new note autosaves', (await readFile(`${vault}/Notes/Untitled.md`, 'utf8')) === '# Another note');
} catch (error) {
  check('flow threw', false, String(error));
}
check('no renderer errors', errors.length === 0, errors.join(' | '));
await app.close();
await rm(userData, { recursive: true, force: true });
await rm(vaultParent, { recursive: true, force: true });

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
