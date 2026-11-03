// Disposable Electron acceptance for code in documents: typing ```ts and
// Enter makes a block and the file holds exactly the typed bytes, Copy puts
// only the code on the (stubbed) clipboard, a Mermaid block draws an image,
// and screenshots of every state in e2e/fixtures/gallery/code.mdo, light and
// dark, for people to look at. Own userData and temp vault; run from the
// repository root after the Vite bundles are built (see README.md here):
//
//   node e2e/acceptance/mdo-code-acceptance.mjs [--out dir]
import { _electron as electron } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = path.resolve(outFlag !== -1 ? args[outFlag + 1] : path.join('e2e', 'out', 'mdo-code'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-code-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-code-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Docs'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const TYPING = path.join(vault, 'Docs', 'typing.mdo');
const GALLERY = path.join(vault, 'Docs', 'code.mdo');
const NOTE = path.join(vault, 'Docs', 'note.md');
const KEYS = path.join(vault, 'Docs', 'keys.mdo');
const EDGES = path.join(vault, 'Docs', 'edges.mdo');
const KEYS_TEXT = 'Top\n\n> ```py\n> def f():\n>     return 1\n> ```\n\nAfter words\n';
await writeFile(TYPING, 'Intro\n\nNext paragraph.\n');
await writeFile(KEYS, KEYS_TEXT);
await writeFile(EDGES, '```js\nlet a = 1;\n```');
await copyFile(path.join(PROJECT_ROOT, 'e2e', 'fixtures', 'gallery', 'code.mdo'), GALLERY);
await writeFile(NOTE, `# A note\n\nA drawn block scrolls sideways inside the column:\n\n\`\`\`ts\nconst wide = '${'a long line that keeps going '.repeat(8)}';\nexport const short = 1;\n\`\`\`\n\nAfter.\n`);
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
await mkdir(outDir, { recursive: true });

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1300, 1000));

const open = async (file) => {
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, file);
  await page.getByTestId('markdown-editor').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
};
/** The page's text as the editor holds it. */
const editorText = () => page.evaluate(() => document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString() ?? null);
const waitForFile = async (file, predicate, timeout = 10_000) => {
  const start = Date.now();
  let text = await readFile(file, 'utf8');
  while (!predicate(text) && Date.now() - start < timeout) {
    await page.waitForTimeout(100);
    text = await readFile(file, 'utf8');
  }
  return text;
};

async function setTheme(theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((resolved) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  }, theme);
}

/** Saves the part of the page around `locator` as `name`, light or dark. */
async function shot(name, locator, { above = 60, below = 80 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await locator.boundingBox();
  const editor = await page.locator('.opal-editor').first().boundingBox();
  if (!box || !editor) return;
  const clip = { x: editor.x, y: Math.max(editor.y, box.y - above), width: editor.width, height: Math.min(900, box.height + above + below) };
  await page.screenshot({ path: path.join(outDir, `${name}.png`), clip });
}

try {
  // Typing ```ts and Enter makes a block; the file holds exactly what was typed.
  await open(TYPING);
  await page.locator('.cm-line', { hasText: 'Intro' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```ts');
  const asText = await editorText();
  check('``` stays text until Enter', asText === 'Intro\n\\```ts\n\nNext paragraph.\n', JSON.stringify(asText));
  await page.keyboard.press('Enter');
  await page.keyboard.type('const a = 1;');
  await page.locator('.cm-line', { hasText: 'Next paragraph.' }).click();
  const expected = 'Intro\n```ts\nconst a = 1;\n```\n\nNext paragraph.\n';
  const saved = await waitForFile(TYPING, (text) => text === expected);
  check('Enter writes both fences and the file holds the typed code', saved === expected, JSON.stringify(saved));
  check('no fence shows on the page', !(await page.locator('.cm-content').textContent()).includes('```'));

  // Copy puts only the code on the clipboard; the page's clipboard write is stubbed.
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = async (text) => { window.__copied.push(text); };
  });
  await page.locator('.cm-code-head').first().hover();
  await page.locator('.cm-code-copy').first().click();
  await page.waitForTimeout(100);
  const copied = await page.evaluate(() => window.__copied);
  check('Copy puts only the code on the clipboard', copied.length === 1 && copied[0] === 'const a = 1;', JSON.stringify(copied));
  check('Copy shows Copied', (await page.locator('.cm-code-copy').first().textContent()) === 'Copied');

  // Keys in a quoted block, with the real keyboard.
  await open(KEYS);
  const codeLine = page.locator('.cm-code-line', { hasText: 'return 1' });
  const lineBox = await codeLine.boundingBox();
  await page.mouse.click(lineBox.x + lineBox.width - 4, lineBox.y + lineBox.height / 2);
  await page.keyboard.type('Z');
  check('a click in code puts the caret where it landed, and typing goes there', (await editorText()) === KEYS_TEXT.replace('return 1', 'return 1Z'), JSON.stringify(await editorText()));
  await page.keyboard.press('Enter');
  await page.keyboard.type('x = 2');
  check('Enter in quoted code keeps the quote marks and the indent', (await editorText()).includes('>     return 1Z\n>     x = 2\n> ```'), JSON.stringify(await editorText()));
  await page.keyboard.press('Meta+a');
  const selected = await page.evaluate(() => { const view = document.querySelector('.cm-content')?.cmTile?.root?.view; const { from, to } = view.state.selection.main; return view.state.sliceDoc(from, to); });
  check('Cmd+A in code selects the code first', selected === 'def f():\n>     return 1Z\n>     x = 2', JSON.stringify(selected));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('W');
  check('Escape leaves the block; Backspace on the blank line after it removes the line and goes back into the code', (await editorText()) === 'Top\n\n> ```py\n> def f():\n>     return 1Z\n>     x = 2W\n> ```\nAfter words\n', JSON.stringify(await editorText()));
  await page.locator('.cm-line', { hasText: 'After words' }).click({ position: { x: 2, y: 8 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('V');
  check('Backspace at the start of a text line after a block moves into the code and deletes nothing', (await editorText()) === 'Top\n\n> ```py\n> def f():\n>     return 1Z\n>     x = 2WV\n> ```\nAfter words\n', JSON.stringify(await editorText()));
  await page.locator('.cm-line', { hasText: 'After words' }).click({ position: { x: 20, y: 8 } });
  await page.keyboard.press('Meta+e');
  check('Cmd+E makes the word inline code', (await editorText()).endsWith('`After` words\n'), JSON.stringify(await editorText()));
  await page.locator('.cm-code-head').first().hover();
  await page.locator('.cm-code-label').first().click();
  await page.keyboard.type('sq');
  await page.keyboard.press('Enter');
  check('the language menu writes only the first word', (await editorText()).startsWith('Top\n\n> ```sql\n'), JSON.stringify(await editorText()));
  await page.locator('.cm-code-head').first().click({ position: { x: 300, y: 10 } });
  await page.waitForTimeout(150);
  const bar = await page.locator('[data-object-bar]').first().textContent().catch(() => '');
  check('a click on the header frames the block and shows its bar', /SQL/.test(bar ?? ''), JSON.stringify(bar));
  await page.keyboard.press('Escape');
  const keysSaved = await waitForFile(KEYS, (text) => text.includes('```sql') && text.includes('`After`'));
  check('the file holds exactly what the keys wrote', keysSaved === 'Top\n\n> ```sql\n> def f():\n>     return 1Z\n>     x = 2WV\n> ```\n`After` words\n', JSON.stringify(keysSaved));

  // A block that is the whole page: leaving it and typing at its edges.
  await open(EDGES);
  await page.locator('.cm-code-line', { hasText: 'let a' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  check('ArrowDown on a final block\'s last line writes nothing', (await editorText()) === '```js\nlet a = 1;\n```');
  await page.keyboard.type('Z');
  check('the first character typed after a final block brings its line break', (await editorText()) === '```js\nlet a = 1;\n```\nZ', JSON.stringify(await editorText()));
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.type('A');
  check('typing before a block that starts the page writes a line break first', (await editorText()) === 'A\n```js\nlet a = 1;\n```\nZ', JSON.stringify(await editorText()));
  await page.locator('.cm-code-line', { hasText: 'let a' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  check('Tab in code writes one indent', (await editorText()) === 'A\n```js\n    let a = 1;\n```\nZ', JSON.stringify(await editorText()));
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Alt+F10');
  check('Option+F10 in a block moves focus to its header', await page.evaluate(() => document.activeElement?.classList.contains('cm-code-label') ?? false));
  await page.keyboard.press('Escape');

  // The gallery document: every state, light and dark.
  await open(GALLERY);
  // Scroll until the Mermaid block is drawn, then wait for its picture.
  for (let step = 0; step < 20 && (await page.locator('img.cm-diagram-image').count()) === 0; step += 1) {
    await page.locator('.cm-scroller').first().evaluate((element) => { element.scrollTop += element.clientHeight / 2; });
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(() => (document.querySelector('img.cm-diagram-image')?.naturalWidth ?? 0) > 0, null, { timeout: 15_000 }).catch(() => undefined);
  const width = await page.evaluate(() => document.querySelector('img.cm-diagram-image')?.naturalWidth ?? 0);
  check('a Mermaid block draws an image', width > 0, `naturalWidth ${width}`);
  for (let step = 0; step < 10 && (await page.locator('.cm-diagram-step').count()) === 0; step += 1) {
    await page.locator('.cm-scroller').first().evaluate((element) => { element.scrollTop += element.clientHeight / 3; });
    await page.waitForTimeout(300);
  }
  const steps = await page.locator('.cm-diagram-step').allTextContents();
  check('a Pocket flowchart draws its chain', steps.join(' > ') === 'Recording > Transcript > Summary', steps.join(' > '));
  const diagram = page.locator('.cm-diagram').first();
  await diagram.click({ position: { x: 40, y: 60 } });
  await page.waitForTimeout(200);
  await shot('light-state-diagram-framed', diagram, { above: 20, below: 40 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const fenceShown = await page.locator('.cm-code-header .cm-diagram-modes').count();
  check('Enter on a framed diagram shows its code in place', fenceShown === 1);
  await shot('light-state-diagram-code', page.locator('.cm-code-header .cm-diagram-modes').first(), { above: 30, below: 520 });
  await page.locator('.cm-code-header .cm-diagram-segment', { hasText: 'Diagram' }).first().click();
  await page.waitForTimeout(300);
  check('the Diagram/Code switch writes nothing', (await readFile(GALLERY, 'utf8')) === (await readFile(path.join(PROJECT_ROOT, 'e2e', 'fixtures', 'gallery', 'code.mdo'), 'utf8')));
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    // The whole document, one window at a time.
    const scroller = page.locator('.cm-scroller').first();
    await scroller.evaluate((element) => { element.scrollTop = 0; });
    const editor = await page.locator('.opal-editor').first().boundingBox();
    for (let index = 0; index < 12; index += 1) {
      await page.waitForTimeout(200);
      if (editor) await page.screenshot({ path: path.join(outDir, `${theme}-page-${String(index).padStart(2, '0')}.png`), clip: editor });
      const moved = await scroller.evaluate((element) => {
        const before = element.scrollTop;
        element.scrollTop += element.clientHeight - 120;
        return element.scrollTop !== before;
      });
      if (!moved) break;
    }
    await scroller.evaluate((element) => { element.scrollTop = 0; });
    await page.waitForTimeout(200);
    const heads = page.locator('.cm-code-head');
    // Hover, caret and frame on the first block.
    await heads.first().hover();
    await shot(`${theme}-state-hover`, heads.first(), { above: 20, below: 200 });
    await page.locator('.cm-code-line:not(.cm-code-head)').first().click();
    await shot(`${theme}-state-caret`, heads.first(), { above: 20, below: 200 });
    await heads.first().locator('.cm-code-label').click({ position: { x: 2, y: 2 } }).catch(() => undefined);
    await page.waitForTimeout(150);
    await shot(`${theme}-state-framed`, heads.first(), { above: 20, below: 260 });
    await page.keyboard.press('Escape');
    // The language menu, searching.
    await heads.first().hover();
    await heads.first().locator('.cm-code-label').click();
    await page.keyboard.type('py');
    await page.waitForTimeout(150);
    await shot(`${theme}-state-language-menu`, heads.first(), { above: 20, below: 320 });
    await page.keyboard.press('Escape');
    const showAll = page.locator('.cm-code-show-all').first();
    if (await showAll.count()) await shot(`${theme}-state-collapsed`, showAll, { above: 260, below: 40 });
    const end = page.locator('.cm-code-open-end');
    if (await end.count()) await shot(`${theme}-state-unclosed`, end, { above: 120, below: 40 });
  }
  // Show all on a long block shows its lines and writes nothing.
  for (let step = 0; step < 20 && (await page.locator('.cm-code-show-all').count()) === 0; step += 1) {
    await page.locator('.cm-scroller').first().evaluate((element) => { element.scrollTop += element.clientHeight / 2; });
    await page.waitForTimeout(200);
  }
  if (await page.locator('.cm-code-show-all').count()) {
    await page.locator('.cm-code-show-all').first().click();
    await page.waitForTimeout(200);
    check('Show all shows a long block\'s lines', (await page.locator('.cm-code-show-all').count()) === 0 && (await page.locator('.cm-code-line', { hasText: '"line50"' }).count()) === 1);
  }
  // A note keeps the drawn block, highlighted, scrolling sideways inside the column.
  await open(NOTE);
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    await shot(`${theme}-note-block`, page.locator('.cm-md-codeblock-widget').first(), { above: 80, below: 60 });
  }
  const fits = await page.evaluate(() => {
    const box = document.querySelector('.cm-md-codeblock-box');
    const content = document.querySelector('.cm-content');
    if (!box || !content) return null;
    return { scrolls: box.scrollWidth > box.clientWidth, inside: box.getBoundingClientRect().right <= content.getBoundingClientRect().right + 1, coloured: Boolean(box.querySelector('.cm-code-keyword')) };
  });
  check('a note\'s block scrolls sideways inside the column and is highlighted', Boolean(fits?.scrolls && fits.inside && fits.coloured), JSON.stringify(fits));
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  check('the run finished', false, String(error));
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
  await rm(vaultParent, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(`${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length} of ${results.length} checks; screenshots in ${outDir}`);
process.exit(failed.length === 0 ? 0 : 1);
