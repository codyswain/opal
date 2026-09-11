// Disposable Electron acceptance for Markdown editing: open a note, type,
// autosave with frontmatter preserved, follow an external edit while clean,
// conflict while dirty, new note. Own userData and temp vault; run from the
// repository root after the Vite bundles are built: see README.md here.
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'fs/promises';
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
const FRONTMATTER = '---\ntags: [research]\nannotation: Keep me\n---\n';
await writeFile(NOTE, `${FRONTMATTER}# Brief\n\nFirst line.\n`);
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

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
  await page.evaluate((dir) => { window.location.hash = `#/files?mode=browse&dir=${encodeURIComponent(dir)}`; }, `${vault}/Notes`);
  await page.getByTestId(`disk-folder-entry-${NOTE}`).dblclick();
  const editor = page.getByTestId('markdown-editor');
  await editor.waitFor();
  check('opens the note without showing frontmatter', (await editor.textContent()).includes('First line.') && !(await editor.textContent()).includes('tags:'));
  check('starts clean', (await page.getByTestId('editor-save-state').getAttribute('data-state')) === 'clean');

  // Type at the end and let autosave run.
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second line from the editor.');
  await waitForState('saved');
  const saved = await waitForFile((text) => text.includes('Second line from the editor.'));
  check('autosaves the body', saved.includes('Second line from the editor.'), saved.slice(0, 80));
  check('preserves the frontmatter bytes', saved.startsWith(FRONTMATTER));
  check('preserves the earlier text', saved.includes('First line.'));

  // Cmd+S flushes immediately.
  await page.keyboard.type(' Flushed.');
  await page.keyboard.press('Meta+s');
  const flushed = await waitForFile((text) => text.includes('Flushed.'), 3_000);
  check('Cmd+S saves right away', flushed.includes('Flushed.'));

  // An external edit while clean is picked up silently.
  await waitForState('saved');
  await writeFile(NOTE, `${FRONTMATTER}# Brief\n\nReplaced outside Opal.\n`);
  await page.waitForFunction(() => document.querySelector('[data-testid="markdown-editor"]')?.textContent?.includes('Replaced outside Opal.'), null, { timeout: 10_000 });
  check('follows an external edit while clean', (await page.getByTestId('editor-save-state').getAttribute('data-state')) === 'clean');

  // A dirty editor turns an external edit into a conflict; both states survive.
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Mine.');
  await writeFile(NOTE, `${FRONTMATTER}# Brief\n\nSomeone else won.\n`);
  await page.waitForTimeout(100);
  await page.keyboard.press('Meta+s');
  await page.getByTestId('editor-conflict').waitFor({ timeout: 10_000 });
  check('conflict detected on save', true);
  check('external file untouched by the refused save', (await readFile(NOTE, 'utf8')).includes('Someone else won.'));
  check('editor keeps the local text', (await editor.textContent()).includes('Mine.'));
  await page.getByRole('button', { name: 'Keep mine' }).click();
  const kept = await waitForFile((text) => text.includes('Mine.'));
  check('Keep mine overwrites with the editor text', kept.includes('Mine.') && kept.startsWith(FRONTMATTER));

  // New note.
  await page.getByRole('button', { name: 'Return to folder' }).click();
  await page.getByTestId('toolbar-new-note').click();
  await page.getByTestId('markdown-editor').waitFor();
  const files = (await readdir(`${vault}/Notes`)).sort();
  check('New note creates Untitled.md and opens it', files.includes('Untitled.md') && (await page.evaluate(() => window.location.hash)).includes('Untitled.md'));
  await page.keyboard.type('# Fresh note');
  await waitForState('saved');
  check('a new note autosaves', (await readFile(`${vault}/Notes/Untitled.md`, 'utf8')).includes('# Fresh note'));
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
