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
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-code-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-code-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Docs'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const TYPING = path.join(vault, 'Docs', 'typing.mdo');
const GALLERY = path.join(vault, 'Docs', 'code.mdo');
await writeFile(TYPING, 'Intro\n\nNext paragraph.\n');
await copyFile(path.join(PROJECT_ROOT, 'e2e', 'fixtures', 'gallery', 'code.mdo'), GALLERY);
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
