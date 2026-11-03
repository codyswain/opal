// Disposable Electron acceptance for math in documents: formulas draw with
// KaTeX's fonts, a click opens the popover, typing writes live, closing is
// one undo step, Backspace after an inline formula takes it whole, money
// stays text, and nothing on the page carries a colour. Saves light and dark
// screenshots of the page and the open popover for people to look at; they
// are never compared. Own userData and temp vault; run from the repository
// root after the Vite bundles are built (see README.md here):
//
//   node e2e/acceptance/mdo-math-acceptance.mjs [--out dir]
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = path.resolve(outFlag !== -1 ? args[outFlag + 1] : process.env.OPAL_MATH_SHOTS ?? path.join('e2e', 'out', 'math'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const ORIGINAL = [
  '# Physics',
  '',
  'Energy $E=mc^2$ and the product $a*b*c$ end here.',
  '',
  '$$',
  '\\int_0^1 x^2\\,dx = \\frac{1}{3}',
  '$$',
  '',
  'Money stays text: $5 and $10, $5M-$10M.',
  '',
  'Broken $\\frac{1}{$ shows its source.',
  '',
  '| Quantity | Formula |',
  '|---|---|',
  '| Area | $\\pi r^2$ |',
  '',
].join('\n');

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-math-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-math-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Notes'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const DOC = `${vault}/Notes/physics.mdo`;
await writeFile(DOC, ORIGINAL);
const GALLERY = `${vault}/Notes/math.mdo`;
await writeFile(GALLERY, await readFile(path.join(PROJECT_ROOT, 'e2e', 'fixtures', 'gallery', 'math.mdo'), 'utf8'));
const IME = `${vault}/Notes/ime.mdo`;
const IME_TEXT = 'Energy $E=mc^2$ and more.\n\n$x$ starts this line.\n\nThis line ends with $y$\n';
await writeFile(IME, IME_TEXT);
const LONG_TEX = 'f(x) = a_0 + a_1 x + a_2 x^2 + a_3 x^3 + a_4 x^4 + a_5 x^5 + a_6 x^6 + a_7 x^7 + a_8 x^8 + a_9 x^9 + a_{10} x^{10} + a_{11} x^{11} + a_{12} x^{12}';
const LONG = `${vault}/Notes/long.mdo`;
const filler = (from, count) => Array.from({ length: count }, (_, index) => `Filler line ${from + index} with enough words to scroll the page down a little.\n`);
const LONG_TEXT = [
  '# Long', '',
  ...filler(0, 3),
  'Energy $E=mc^2$ sits a little way down.', '',
  `Long $${LONG_TEX}$ here.`, '',
  '$\\gdef\\R{\\mathbb{R}}$ defines R. Then $\\R^n$ inline.', '',
  ...filler(3, 45),
].join('\n');
await writeFile(LONG, LONG_TEXT);
const NOTE = `${vault}/Notes/math-note.md`;
await writeFile(NOTE, await readFile(path.join(PROJECT_ROOT, 'e2e', 'fixtures', 'gallery', 'math.mdo'), 'utf8'));
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
await mkdir(outDir, { recursive: true });

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 900));

const waitForFile = async (predicate, timeout = 10_000) => {
  const start = Date.now();
  let text = await readFile(DOC, 'utf8');
  while (!predicate(text)) {
    if (Date.now() - start > timeout) return text;
    await page.waitForTimeout(100);
    text = await readFile(DOC, 'utf8');
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
  await page.waitForTimeout(150);
}

/** Saves the editor, or with `window` the whole window so a popover beside the page shows too, light and dark. */
async function shoot(name, { window = false } = {}) {
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    const file = path.join(outDir, `${name}-${theme}.png`);
    if (window) await page.screenshot({ path: file });
    else await page.locator('.opal-editor').first().screenshot({ path: file });
  }
  await setTheme('light');
}

const formula = (tex) => page.locator(`.cm-math[aria-label="${tex.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).first();

try {
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, DOC);
  const editor = page.getByTestId('markdown-editor');
  await editor.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);

  const drawn = await page.evaluate(() => [...document.querySelectorAll('.cm-math')].map((element) => element.getAttribute('aria-label')));
  check('draws inline, display, error and table-cell formulas', ['E=mc^2', 'a*b*c', '\\int_0^1 x^2\\,dx = \\frac{1}{3}', '\\frac{1}{', '\\pi r^2'].every((tex) => drawn.includes(tex)), JSON.stringify(drawn));
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((font) => font.family.includes('KaTeX') && font.status === 'loaded').map((font) => font.family);
  });
  check('loads KaTeX\'s fonts from the app, offline', fonts.includes('KaTeX_Main'), fonts.join(', '));
  const text = await page.locator('.cm-content').textContent();
  check('money stays text', text.includes('$5 and $10, $5M-$10M'));
  const error = await page.evaluate(() => {
    const element = document.querySelector('.cm-math-error');
    return element ? { title: element.getAttribute('title'), colour: getComputedStyle(element).color } : null;
  });
  check('shows broken TeX as muted source with the message', Boolean(error?.title), JSON.stringify(error));
  const hued = await page.evaluate(() => [...document.querySelectorAll('.cm-math, .cm-math *')].map((element) => getComputedStyle(element).color)
    .filter((colour) => { const [r, g, b] = colour.match(/\d+/g).map(Number); return Math.max(r, g, b) - Math.min(r, g, b) > 0; }));
  check('draws formulas in grey only', hued.length === 0, hued.slice(0, 3).join(' '));
  await shoot('math-page');

  // A click opens the popover; typing writes live; Escape closes as one undo step.
  await formula('E=mc^2').click();
  const popover = page.getByTestId('math-popover');
  await popover.waitFor({ timeout: 5_000 });
  const field = popover.getByRole('textbox', { name: 'TeX' });
  check('a click opens the popover with the formula\'s TeX', (await field.inputValue()) === 'E=mc^2');
  await field.press('End');
  await field.pressSequentially('+1', { delay: 120 });
  await page.waitForTimeout(600);
  await field.pressSequentially('0', { delay: 50 });
  const live = await waitForFile((written) => written.includes('$E=mc^2+10$'));
  check('writes the TeX as it is typed', live.includes('Energy $E=mc^2+10$ and'), JSON.stringify(live.split('\n')[2]));
  await field.press('End');
  await field.pressSequentially('\\frac{', { delay: 30 });
  await page.waitForTimeout(200);
  const kept = await page.evaluate(() => document.querySelector('.cm-math')?.getAttribute('aria-label'));
  check('keeps the last formula that rendered while the TeX is incomplete', kept.startsWith('E=mc^2+10') && !kept.includes('frac'), kept);
  await shoot('math-popover-error', { window: true });
  for (let index = 0; index < 6; index += 1) await field.press('Backspace');
  await page.waitForTimeout(200);
  await shoot('math-popover', { window: true });
  await field.press('Escape');
  await popover.waitFor({ state: 'detached', timeout: 5_000 });
  const closed = await waitForFile((written) => written.includes('$E=mc^2+10$') && !written.includes('\\frac{$'));
  check('closing keeps what was written', closed.includes('Energy $E=mc^2+10$ and'));
  const caret = await page.evaluate(() => {
    const selection = window.getSelection();
    return selection?.anchorNode?.parentElement?.closest('.cm-line')?.textContent ?? '';
  });
  check('closing puts the caret on the formula\'s line', caret.startsWith('Energy'), JSON.stringify(caret.slice(0, 30)));
  await page.keyboard.press('Meta+z');
  const undone = await waitForFile((written) => written === ORIGINAL);
  check('one Cmd+Z brings the original bytes back', undone === ORIGINAL);

  // Backspace after an inline formula takes it whole.
  await formula('a*b*c').click();
  await popover.waitFor({ timeout: 5_000 });
  await page.getByTestId('math-popover').getByRole('button', { name: 'Done' }).click();
  await popover.waitFor({ state: 'detached', timeout: 5_000 });
  await page.keyboard.press('Backspace');
  const gone = await waitForFile((written) => !written.includes('$a*b*c$'));
  check('Backspace after $a*b*c$ takes the whole formula, never $ac$', gone.includes('the product  end here.') && !gone.includes('$ac$'), JSON.stringify(gone.split('\n')[2]));
  await page.keyboard.press('Meta+z');
  await waitForFile((written) => written === ORIGINAL);

  // A click on a formula in a table cell opens its popover too.
  await page.locator('td .cm-math').first().click();
  await popover.waitFor({ timeout: 5_000 });
  check('a click on a formula in a table cell opens its popover', (await page.getByTestId('math-popover').getByRole('textbox', { name: 'TeX' }).inputValue()) === '\\pi r^2');
  await shoot('math-popover-table', { window: true });
  await page.getByTestId('math-popover').getByRole('textbox', { name: 'TeX' }).press('Escape');
  await popover.waitFor({ state: 'detached', timeout: 5_000 });
  check('closing an unchanged formula writes nothing', (await readFile(DOC, 'utf8')) === ORIGINAL);

  // ⇧⌘E beside a formula opens it; on an empty line it starts a display block, written on the first key.
  await page.locator('.cm-line', { hasText: 'Energy' }).click({ position: { x: 3, y: 5 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  for (let index = 0; index < 'end here.'.length + 1; index += 1) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Meta+Shift+E');
  await popover.waitFor({ timeout: 5_000 });
  check('⇧⌘E beside a formula opens it', (await page.getByTestId('math-popover').getByRole('textbox', { name: 'TeX' }).inputValue()) === 'a*b*c');
  await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'detached', timeout: 5_000 });
  await page.locator('.cm-line', { hasText: 'Broken' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Meta+Shift+E');
  await popover.waitFor({ timeout: 5_000 });
  const untouched = await readFile(DOC, 'utf8');
  check('⇧⌘E on an empty line writes nothing until the first key', !untouched.includes('$$\n\n$$') && !untouched.includes('\\sum'));
  await page.getByTestId('math-popover').getByRole('textbox', { name: 'TeX' }).pressSequentially('\\sum_{k=1}^n k', { delay: 20 });
  await shoot('math-new-block', { window: true });
  await page.getByTestId('math-popover').getByRole('button', { name: 'Done' }).click();
  await popover.waitFor({ state: 'detached', timeout: 5_000 });
  const block = await waitForFile((written) => written.includes('$$\n\\sum_{k=1}^n k\n$$'));
  check('the new display block is written as $$, the TeX and $$', block.includes('$$\n\\sum_{k=1}^n k\n$$'), JSON.stringify(block.slice(block.indexOf('Broken'), block.indexOf('Broken') + 80)));
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  await waitForFile((written) => written === ORIGINAL, 3_000);

  // Backspace under a display block frames it and shows its bar; Escape leaves it as it was.
  await page.locator('.cm-line', { hasText: 'Money stays text' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  const framed = await page.evaluate(() => Boolean(document.querySelector('[data-object-framed]')) && Boolean(document.querySelector('[data-object-bar]')));
  check('Backspace under a display block frames it and shows its bar', framed);
  await shoot('math-framed', { window: true });
  await page.keyboard.press('Escape');
  check('a frame changes no bytes', (await readFile(DOC, 'utf8')) === ORIGINAL);

  // Insert > Equation in the toolbar opens the popover at the caret, with the field focused.
  await page.locator('.cm-line', { hasText: 'Money stays text' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Sum ');
  await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Insert' }).click();
  await page.getByRole('menuitem', { name: /Equation/ }).click();
  await popover.waitFor({ timeout: 5_000 });
  await page.waitForTimeout(200);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check('Insert > Equation opens the popover with its field focused', focused === 'TeX', String(focused));
  await page.keyboard.type('x+y');
  await page.keyboard.press('Enter');
  await popover.waitFor({ state: 'detached', timeout: 5_000 });
  const inserted = await waitForFile((written) => written.includes('Sum $x+y$'));
  check('Insert > Equation writes an inline formula at the caret', inserted.includes('$5M-$10M. Sum $x+y$'), JSON.stringify(inserted.split('\n')[8]));
  for (let index = 0; index < 3; index += 1) await page.keyboard.press('Meta+z');
  await waitForFile((written) => written === ORIGINAL, 3_000);
  check('undo after inserting goes back to the original bytes', (await readFile(DOC, 'utf8')) === ORIGINAL);

  // An edit from elsewhere to the open formula shows in the field; the popover follows it.
  await formula('E=mc^2').click();
  await popover.waitFor({ timeout: 5_000 });
  await writeFile(DOC, ORIGINAL.replace('$E=mc^2$', '$E=mc^3$'));
  await page.waitForFunction(() => document.querySelector('[data-testid="math-popover"] textarea')?.value === 'E=mc^3', null, { timeout: 8_000 }).catch(() => undefined);
  check('an edit from elsewhere shows in the open popover', (await page.getByTestId('math-popover').getByRole('textbox', { name: 'TeX' }).inputValue()) === 'E=mc^3');
  await page.getByTestId('math-popover').getByRole('textbox', { name: 'TeX' }).press('Escape');
  await popover.waitFor({ state: 'detached', timeout: 5_000 });
  await writeFile(DOC, ORIGINAL);
  await page.waitForFunction(() => document.querySelector('.cm-math')?.getAttribute('aria-label') === 'E=mc^2', null, { timeout: 8_000 }).catch(() => undefined);
  check('the page follows the file back', (await page.evaluate(() => document.querySelector('.cm-math')?.getAttribute('aria-label'))) === 'E=mc^2');

  // $$ then Enter starts a block and opens its popover; Backspace in the empty field puts the $$ back.
  await page.locator('.cm-line', { hasText: 'Broken' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('$$');
  await page.keyboard.press('Enter');
  await popover.waitFor({ timeout: 5_000 });
  const opened = await waitForFile((written) => written.includes('shows its source.\n\n$$\n\n$$'));
  check('$$ then Enter writes $$, an empty line and $$, and opens the popover', opened.includes('shows its source.\n\n$$\n\n$$'), JSON.stringify(opened.slice(opened.indexOf('Broken'), opened.indexOf('Broken') + 60)));
  await page.getByTestId('math-popover').getByRole('textbox', { name: 'TeX' }).press('Backspace');
  await popover.waitFor({ state: 'detached', timeout: 5_000 });
  const restored = await waitForFile((written) => written.includes('shows its source.\n\n$$\n') && !written.includes('$$\n\n$$'));
  check('Backspace right after puts $$ back as text', restored.includes('shows its source.\n\n$$\n'), JSON.stringify(restored.slice(restored.indexOf('Broken'), restored.indexOf('Broken') + 60)));
  for (let index = 0; index < 4; index += 1) await page.keyboard.press('Meta+z');
  await waitForFile((written) => written === ORIGINAL, 3_000);
  check('undo goes back to the original bytes after the $$ block', (await readFile(DOC, 'utf8')) === ORIGINAL);

  // Typing a formula in a document: it renders on the closing $, and Backspace then takes only that $.
  await page.locator('.cm-line', { hasText: 'Money stays text' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Area $\\pi r^2$', { delay: 20 });
  await page.waitForTimeout(200);
  const typedDrawn = await page.evaluate(() => [...document.querySelectorAll('.cm-math')].some((element) => element.getAttribute('aria-label') === '\\pi r^2' && !element.closest('table')));
  check('a typed closing $ renders the formula', typedDrawn);
  await page.keyboard.press('Backspace');
  const reopened = await waitForFile((written) => written.includes('Area $\\pi r^2\n') || written.includes('Area $\\pi r^2\r'));
  check('Backspace right after takes only the $', reopened.includes('$5M-$10M. Area $\\pi r^2\n'), JSON.stringify(reopened.split('\n')[8]));
  await shoot('math-typed');

  // Input methods beside inline formulas: the composed text lands where a typed letter would.
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, IME);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('starts this line'), null, { timeout: 15_000 });
  await page.waitForTimeout(400);
  const cdp = await page.context().newCDPSession(page);
  const compose = async (text) => {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await page.waitForTimeout(60);
    await cdp.send('Input.insertText', { text });
    await page.waitForTimeout(150);
  };
  const readIme = () => readFile(IME, 'utf8');
  const waitIme = async (predicate) => {
    const start = Date.now();
    let text = await readIme();
    while (!predicate(text) && Date.now() - start < 5_000) { await page.waitForTimeout(100); text = await readIme(); }
    return text;
  };
  const cells = [
    ['after an inline formula', async () => { await page.locator('.cm-line', { hasText: 'Energy' }).click(); await page.keyboard.press('End'); for (let i = 0; i < ' and more.'.length; i += 1) await page.keyboard.press('ArrowLeft'); }, 'か', (text) => text.includes('Energy $E=mc^2$か and more.')],
    ['before an inline formula', async () => { await page.locator('.cm-line', { hasText: 'Energy' }).click(); await page.keyboard.press('Home'); for (let i = 0; i < 'Energy '.length; i += 1) await page.keyboard.press('ArrowRight'); }, 'き', (text) => text.includes('Energy き$E=mc^2$')],
    ['at a line start, before a formula', async () => { await page.locator('.cm-line', { hasText: 'starts this line' }).click(); await page.keyboard.press('Home'); }, 'く', (text) => text.includes('\nく$x$ starts this line.')],
    ['at a line end, after a formula', async () => { await page.locator('.cm-line', { hasText: 'ends with' }).click(); await page.keyboard.press('End'); }, 'け', (text) => text.includes('ends with $y$け')],
  ];
  for (const [name, place, text, ok] of cells) {
    await place();
    await compose(text);
    const written = await waitIme(ok);
    check(`input method text lands ${name}`, ok(written), JSON.stringify(written));
  }
  const formulasKept = await page.evaluate(() => [...document.querySelectorAll('.cm-math')].map((element) => element.getAttribute('aria-label')).join(' '));
  check('input methods leave the formulas whole', formulasKept === 'E=mc^2 x y', formulasKept);

  // A longer page: the edited formula shows as selected, the popover moves with the page, a click on the page keeps its caret,
  // long TeX fits the column and the field, and a macro definition shows as its source.
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, LONG);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('sits a little way down'), null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  await formula('E=mc^2').click();
  await popover.waitFor({ timeout: 5_000 });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  const selected = await page.evaluate(() => {
    const drawn = document.querySelector('.cm-content .cm-math[aria-label="E=mc^2"]');
    return Boolean(drawn?.parentElement?.classList.contains('cm-math-editing')) && getComputedStyle(drawn).boxShadow !== 'none';
  });
  check('the formula the popover edits shows as selected', selected);
  const sunken = await page.evaluate(() => getComputedStyle(document.querySelector('.opal-math-preview')).backgroundColor);
  check('the preview sits in a grey box', sunken !== 'rgba(0, 0, 0, 0)', sunken);
  // The popover sits under the formula, or above it near the window's bottom edge.
  const tops = () => page.evaluate(() => {
    const box = document.querySelector('[data-testid="math-popover"]')?.getBoundingClientRect();
    const drawn = document.querySelector('.cm-content .cm-math[aria-label="E=mc^2"]')?.getBoundingClientRect();
    if (!box || !drawn) return null;
    return { formula: drawn.top, attached: Math.abs(box.top - drawn.bottom - 6) < 3 || Math.abs(drawn.top - box.bottom - 6) < 3 };
  });
  const before = await tops();
  await page.evaluate(() => { document.querySelector('.cm-scroller').scrollTop += 120; });
  await page.waitForTimeout(400);
  const after = await tops();
  check('the popover moves with the page as it scrolls', Boolean(before?.attached && after?.attached && Math.abs(after.formula - before.formula + 120) < 2), JSON.stringify({ before, after }));
  await shoot('math-popover-scrolled', { window: true });
  await page.locator('.cm-line', { hasText: 'Filler line 4 ' }).click({ position: { x: 450, y: 8 } });
  await popover.waitFor({ state: 'detached', timeout: 5_000 });
  await page.keyboard.type('Z');
  const readLong = () => readFile(LONG, 'utf8');
  let typedZ = await readLong();
  for (let tries = 0; tries < 50 && !typedZ.includes('Z'); tries += 1) { await page.waitForTimeout(100); typedZ = await readLong(); }
  const zLine = typedZ.split('\n').find((line) => line.includes('Z')) ?? '';
  check('a click on the page while the popover is open keeps the caret where it lands', zLine.startsWith('Filler line 4 '), JSON.stringify(zLine));
  await page.keyboard.press('Meta+z');
  await page.evaluate(() => { document.querySelector('.cm-scroller').scrollTop = 0; });
  await page.waitForTimeout(300);
  const fits = await page.evaluate(() => {
    const drawn = [...document.querySelectorAll('.cm-content .cm-math')].find((element) => element.getAttribute('aria-label')?.startsWith('f(x)'));
    const content = document.querySelector('.cm-content').getBoundingClientRect();
    if (!drawn) return 'missing';
    const box = drawn.getBoundingClientRect();
    return box.right <= content.right + 1 && drawn.scrollWidth <= drawn.clientWidth + 1 ? 'fits' : JSON.stringify({ right: box.right, content: content.right, scroll: drawn.scrollWidth, client: drawn.clientWidth });
  });
  check('a long inline formula fits the column', fits === 'fits', fits);
  const definition = await page.evaluate(() => {
    const drawn = document.querySelector('.cm-content .cm-math-empty');
    const box = drawn?.getBoundingClientRect();
    return box ? { width: box.width, text: drawn.textContent } : null;
  });
  check('a macro definition shows as its source', Boolean(definition && definition.width > 0 && definition.text.includes('\\gdef')), JSON.stringify(definition));
  await shoot('math-long');
  await formula(LONG_TEX).click();
  await popover.waitFor({ timeout: 5_000 });
  const longField = await page.evaluate(() => {
    const field = document.querySelector('.opal-math-field');
    return { value: field.value.slice(0, 4), client: field.clientHeight, scroll: field.scrollHeight };
  });
  check('the TeX field shows all of long TeX', longField.value === 'f(x)' && longField.client >= longField.scroll - 1, JSON.stringify(longField));
  await shoot('math-popover-long', { window: true });
  await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'detached', timeout: 5_000 });

  // The gallery fixture, top and bottom, for people to look at: chemistry, money, lists, callouts and tables sit below the fold.
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, GALLERY);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('Inline formulas'), null, { timeout: 15_000 });
  await page.waitForTimeout(800);
  await shoot('math-gallery-top');
  await page.evaluate(() => { const scroller = document.querySelector('.cm-scroller'); if (scroller) scroller.scrollTop = scroller.scrollHeight; });
  await page.waitForTimeout(500);
  const chemistry = await page.evaluate(() => [...document.querySelectorAll('.cm-math')].some((element) => element.getAttribute('aria-label')?.startsWith('\\ce') && !element.classList.contains('cm-math-error')));
  check('loads mhchem and draws \\ce', chemistry);
  await shoot('math-gallery-bottom');

  // A note shows a formula's TeX while the caret is in it, and a block's source lines with the formula drawn under them.
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, NOTE);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('Inline formulas'), null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  await formula('E=mc^2').click();
  await page.waitForTimeout(200);
  const source = await page.evaluate(() => document.querySelector('.cm-math-source')?.textContent ?? '');
  check('a note shows a formula\'s TeX while the caret is in it', source === '$E=mc^2$', source);
  await page.locator('.cm-math-block').first().click();
  await page.waitForTimeout(200);
  const lines = await page.evaluate(() => document.querySelectorAll('.cm-math-source-line').length);
  check('a note shows a block\'s source lines with the formula drawn under them', lines >= 3, String(lines));
  await shoot('math-note-source');
} catch (error) {
  check('runs without an exception', false, String(error));
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
  await rm(vaultParent, { recursive: true, force: true });
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((result) => !result.ok);
console.log(`${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length} of ${results.length} checks; screenshots in ${outDir}`);
process.exit(failed.length === 0 ? 0 : 1);
