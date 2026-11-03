// Disposable Electron acceptance for files in documents: chips, cards and
// previews drawn from e2e/fixtures/gallery/files.mdo, every failure state,
// captions from the investor update's forms, a movie seeking to its end,
// the object bar, a drop of a PDF, a movie and a deck, input methods next to
// a chip, and no web loads. Own userData and temp vault; thumbnails come
// from macOS as in the app. Run from the repository root after the Vite
// bundles are built (see README.md here):
//
//   node e2e/acceptance/mdo-files-acceptance.mjs [--shots dir]
//
// --shots saves the fixture light and dark at 700 and 420 pixels, and the
// bar on a card, for people to look at; nothing compares them.
import { _electron as electron } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import setup, { pdf } from '../fixtures/gallery/files.setup.mjs';

const PROJECT_ROOT = process.cwd();
const args = process.argv.slice(2);
const shotsFlag = args.indexOf('--shots');
const shotsDir = shotsFlag !== -1 ? path.resolve(args[shotsFlag + 1]) : null;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-mdo-files-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-mdo-files-vault-'));
await mkdir(path.join(vaultParent, 'Vault/Gallery'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const gallery = path.join(vault, 'Gallery');
await copyFile(path.join(PROJECT_ROOT, 'e2e/fixtures/gallery/files.mdo'), path.join(gallery, 'files.mdo'));
const made = await setup(vault, gallery);
if (!made.movie) console.log('SKIP movie checks: ffmpeg could not make a test movie');
await writeFile(path.join(gallery, 'Drop.mdo'), 'Intro\n');
const CHIP = '[[Library/files/2026-11/gob-deck.a3f9c2e1.pptx|deck]]';
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
if (shotsDir) await mkdir(shotsDir, { recursive: true });

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
// Open in an app, Quick Look and Finder are stubbed, so nothing outside the window opens.
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
const webRequests = [];
page.on('request', (request) => { if (/^https?:/i.test(request.url()) && !request.url().startsWith('http://localhost')) webRequests.push(request.url()); });

async function open(file) {
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, file);
  await page.getByTestId('markdown-editor').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
}

async function sizeWindow(width, height) {
  const setContent = (w, h) => app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.w, size.h), { w, h });
  await setContent(width + 600, height);
  await page.waitForTimeout(150);
  const chrome = await page.evaluate(() => window.innerWidth - (document.querySelector('.opal-editor')?.getBoundingClientRect().width ?? window.innerWidth));
  await setContent(Math.round(width + chrome), height);
  await page.evaluate((w) => { for (const editor of document.querySelectorAll('.opal-editor')) editor.style.maxWidth = `${w}px`; }, width);
  await page.waitForTimeout(300);
}

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

const HEIGHT = 1400;

/** Scrolls the page from its top to its end, gathering the text of every element each selector matches, since CodeMirror draws only the lines in view. */
async function scan(selectors) {
  const found = Object.fromEntries(selectors.map((selector) => [selector, new Set()]));
  await page.evaluate(() => { document.querySelector('.cm-scroller').scrollTop = 0; });
  for (let step = 0; step < 60; step += 1) {
    await page.waitForTimeout(700);
    const seen = await page.evaluate((list) => Object.fromEntries(list.map((selector) => [selector, [...document.querySelectorAll(selector)].map((node) => node.textContent ?? '')])), selectors);
    for (const selector of selectors) for (const value of seen[selector]) found[selector].add(value);
    const end = await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller');
      const before = scroller.scrollTop;
      scroller.scrollTop += scroller.clientHeight * 0.7;
      return scroller.scrollTop === before;
    });
    if (end) break;
  }
  return Object.fromEntries(selectors.map((selector) => [selector, [...found[selector]]]));
}

/** Scrolls until `selector` is drawn, then brings it into view. */
async function reach(selector) {
  await page.evaluate(() => { document.querySelector('.cm-scroller').scrollTop = 0; });
  for (let step = 0; step < 60; step += 1) {
    await page.waitForTimeout(500);
    const there = await page.evaluate((target) => {
      const node = document.querySelector(target);
      if (node) node.scrollIntoView({ block: 'center' });
      return Boolean(node);
    }, selector);
    if (there) {
      await page.waitForTimeout(500);
      return true;
    }
    const end = await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller');
      const before = scroller.scrollTop;
      scroller.scrollTop += scroller.clientHeight * 0.7;
      return scroller.scrollTop === before;
    });
    if (end) return false;
  }
  return false;
}

/** Screenshots of the whole page, a window's height at a time. */
async function pageShots(prefix) {
  await page.evaluate(() => { document.querySelector('.cm-scroller').scrollTop = 0; });
  for (let index = 1; index <= 12; index += 1) {
    await page.waitForTimeout(900);
    await page.locator('.opal-editor').first().screenshot({ path: path.join(shotsDir, `${prefix}-${index}.png`) });
    const end = await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller');
      const before = scroller.scrollTop;
      scroller.scrollTop += scroller.clientHeight * 0.85;
      return scroller.scrollTop === before;
    });
    if (end) break;
  }
}

try {
  await sizeWindow(700, HEIGHT);
  await open(path.join(gallery, 'files.mdo'));
  await page.waitForTimeout(1000);
  const seen = await scan(['.cm-file-chip', '.cm-file-chip.cm-file-unresolved', '[data-wiki-name]', '.cm-file-card', '.cm-file-pdf-footer', '.cm-file-caption']);
  const chips = seen['.cm-file-chip'];
  const cards = seen['.cm-file-card'];

  check('file links in text draw as chips with their names', chips.length >= 4 && chips.some((chip) => chip.includes('Q3 report')) && chips.some((chip) => chip.includes('the demo')), chips.join(' | '));
  check('a chip for a file that is gone is faded and dashed, and only that one', seen['.cm-file-chip.cm-file-unresolved'].length === 1, seen['.cm-file-chip.cm-file-unresolved'].join(' | '));
  const notes = seen['[data-wiki-name]'];
  check('wiki links to notes read as the note\'s name and heading', notes.includes('Roadmap') && notes.includes('Roadmap › Goals'), notes.join(' | '));
  for (const [label, kind] of [['the deck', 'PowerPoint'], ['the model', 'STL model'], ['the archive', 'ZIP archive'], ['the table', 'CSV'], ['the drawing', 'Excalidraw drawing'], ['the YouTube page', 'YouTube video']]) {
    check(`${label} draws as a card with its kind`, cards.some((card) => card.includes(kind)));
  }
  check('names show without the stored hash', !cards.join(' ').includes('a3f9c2e1') && !chips.join(' ').includes('a3f9c2e1'));
  for (const [label, words] of [['a file still on the Mini says so and offers Get from Mini', ['Not downloaded yet', 'Get from Mini']], ['a moved file says Moved and offers Update link', ['Moved', 'Update link']], ['a gone file offers Locate… and Remove', ['File not found', 'Locate…', 'Remove']], ['a video Opal can\'t play says so and offers the app', ["Can't play this video in Opal"]]]) {
    check(label, cards.some((card) => words.every((word) => card.includes(word))), cards.filter((card) => card.includes(words[0])).join(' | '));
  }
  check('a PDF previews with its pages and size in the footer', seen['.cm-file-pdf-footer'].some((line) => line.includes('3 pages')), seen['.cm-file-pdf-footer'].join(' | '));
  const captions = seen['.cm-file-caption'];
  check('the investor update\'s alt text shows as captions', ['SF box-assembly rigs, with two rigs shown', 'Bit', 'Autonomous policy rollout'].every((caption) => captions.includes(caption)), captions.join(' | '));

  await reach('.cm-file-pdf');
  const pdfShown = await page.waitForSelector('.cm-file-pdf-image', { timeout: 20_000 }).then(() => true, () => false);
  check('a PDF previews as its first page, drawn by macOS', pdfShown);

  await reach('.cm-md-image img[src*="diagram"]');
  const picture = await page.evaluate(() => {
    const image = document.querySelector('.cm-md-image img[src*="diagram"]');
    return image ? { width: image.naturalWidth, shown: Math.round(image.getBoundingClientRect().width) } : null;
  });
  check('an image embed draws at its written width', picture?.width === 640 && picture.shown === 480, JSON.stringify(picture));

  if (made.movie) {
    await reach('.cm-file-video video');
    const seeked = await page.evaluate(async () => {
      const video = document.querySelector('.cm-file-video video');
      if (!video) return 'no video';
      if (video.readyState < 1) await new Promise((resolve) => { video.addEventListener('loadedmetadata', resolve, { once: true }); setTimeout(resolve, 8000); });
      return new Promise((resolve) => {
        video.addEventListener('seeked', () => resolve(video.currentTime), { once: true });
        video.currentTime = Math.max(0, video.duration - 0.1);
        setTimeout(() => resolve('timeout'), 8000);
      });
    });
    check('a movie plays from the vault and seeks to its end', typeof seeked === 'number' && seeked > 2.5, String(seeked));
    const shape = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-file-video')).aspectRatio);
    check('a movie\'s box has its own shape before it loads', /640 \/ 360/.test(shape), shape);
  }
  if (made.audio) {
    await reach('.cm-file-audio audio');
    const audio = await page.evaluate(async () => {
      const element = document.querySelector('.cm-file-audio audio');
      if (!element) return null;
      if (element.readyState < 1) await new Promise((resolve) => { element.addEventListener('loadedmetadata', resolve, { once: true }); setTimeout(resolve, 5000); });
      return element.duration;
    });
    check('a voice memo plays in a one-line player', typeof audio === 'number' && audio > 3, String(audio));
  }

  const sources = await page.evaluate(() => [...document.querySelectorAll('.cm-content [src]')].map((node) => node.getAttribute('src')));
  check('the page loads nothing from the web while it draws', sources.every((source) => !/^https?:/i.test(source)) && webRequests.length === 0, webRequests.join(' | '));

  if (shotsDir) {
    for (const theme of ['light', 'dark']) {
      await setTheme(theme);
      for (const width of [700, 420]) {
        await sizeWindow(width, HEIGHT);
        await pageShots(`files-${theme}-${width}`);
      }
    }
    await setTheme('light');
    await sizeWindow(700, HEIGHT);
  }

  // The bar: a click on the deck card frames it and shows where it points, then its actions.
  await reach('.cm-file-card');
  const card = page.locator('.cm-file-card', { hasText: 'Gob deck.pptx' }).first();
  await card.click();
  const bar = page.locator('[data-object-bar]');
  const barShown = await bar.waitFor({ timeout: 5000 }).then(() => true, () => false);
  const barText = barShown ? await bar.textContent() : '';
  // A deck is a card in either look, so its bar has no Show as.
  check('a click on a card frames it and shows the bar: destination first, then the main action and More', barShown && /gob-deck\.pptx · PowerPoint · 2 KB/.test(barText) && /Open in/.test(barText) && !/Show as/.test(barText) && /More/.test(barText), barText);
  const framed = await page.locator('.cm-file-card[data-file-framed]').count();
  check('the framed card draws its ring', framed === 1);
  if (shotsDir) {
    for (const theme of ['light', 'dark']) {
      await setTheme(theme);
      const box = await card.boundingBox();
      if (box) await page.screenshot({ path: path.join(shotsDir, `bar-${theme}.png`), clip: { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 40), width: 640, height: box.height + 140 } });
    }
    await setTheme('light');
  }

  // More > Rename…: the field takes focus once the menu has closed, and Enter writes the new name into the link.
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const ask = page.locator('.opal-file-ask input');
  await ask.waitFor({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  const focused = await page.evaluate(() => document.activeElement?.closest('.opal-file-ask') !== null);
  const barHidden = await bar.evaluate((node) => getComputedStyle(node).visibility === 'hidden').catch(() => true);
  check('Rename… opens with its field focused, in the bar\'s place', focused && barHidden, `focused ${focused}, bar hidden ${barHidden}`);
  if (shotsDir) await page.screenshot({ path: path.join(shotsDir, 'rename-light.png') });
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('Gob deck v2');
  await page.keyboard.press('Enter');
  let renamed = '';
  for (let tries = 0; tries < 20; tries += 1) {
    await page.waitForTimeout(250);
    renamed = await readFile(path.join(gallery, 'files.mdo'), 'utf8');
    if (renamed.includes('|Gob deck v2]]')) break;
  }
  check('Rename… writes the name into the link and types nothing into the page', renamed.includes('gob-deck.a3f9c2e1.pptx|Gob deck v2]]') && !/^Gob deck v2$/m.test(renamed), renamed.split('\n').find((line) => line.includes('gob-deck')) ?? '');
  check('the field closes once applied', await page.locator('.opal-file-ask').count() === 0);
  await page.keyboard.press('Escape');

  // A picture whose bytes are on the Mini is the Not-downloaded card, not a line of text.
  await reach('.cm-file-card[data-state="remote"]');
  const remoteCards = await page.locator('.cm-file-card[data-state="remote"]').allTextContents();
  check('a picture not on this Mac shows the Not-downloaded card with Get from Mini', remoteCards.some((text) => text.includes('Not downloaded yet') && text.includes('Get from Mini') && !text.includes('Board deck')), remoteCards.join(' | '));

  // A framed picture lets the browser start a drag of its file.
  await reach('.cm-md-image img[src*="diagram"]');
  const picture2 = page.locator('.cm-md-image img[src*="diagram"]').first();
  await picture2.click();
  await page.waitForTimeout(300);
  const box2 = await picture2.boundingBox();
  if (box2) {
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down();
    const draggable = await picture2.evaluate((node) => node.draggable);
    await page.mouse.up();
    check('a framed picture can be dragged out as its file', draggable === true);
  }

  // A drop of a PDF, a short movie and a deck onto an empty document.
  await open(path.join(gallery, 'Drop.mdo'));
  const movieBytes = made.movie ? [...await readFile(path.join(made.files, 'night-shift.a3f9c2e1.mp4'))] : [...Buffer.from('not a movie')];
  const drops = [
    { name: 'Q3 numbers.pdf', type: 'application/pdf', bytes: [...pdf(['Dropped'])] },
    { name: 'clip.mp4', type: 'video/mp4', bytes: movieBytes },
    { name: 'Pitch deck.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes: [...Buffer.from('PK\u0003\u0004 deck', 'latin1')] },
  ];
  await page.evaluate((files) => {
    const content = document.querySelector('.cm-content');
    const line = content.querySelector('.cm-line').getBoundingClientRect();
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
    content.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: line.left + 10, clientY: line.bottom - 2 }));
  }, drops);
  let dropped = '';
  for (let tries = 0; tries < 40; tries += 1) {
    await page.waitForTimeout(250);
    dropped = await readFile(path.join(gallery, 'Drop.mdo'), 'utf8');
    if (dropped.split('\n').filter(Boolean).length >= 4) break;
  }
  const lines = dropped.split('\n');
  check('a dropped PDF goes in as a preview with its name', /^!\[\[Library\/files\/\d{4}-\d{2}\/q3-numbers\.[0-9a-f]{8}\.pdf\|Q3 numbers\.pdf\]\]$/.test(lines[1] ?? ''), lines[1]);
  check('a dropped movie goes in as a preview with a width', /^!\[\[Library\/files\/\d{4}-\d{2}\/clip\.[0-9a-f]{8}\.mp4(\|\d+)?\]\]$/.test(lines[2] ?? ''), lines[2]);
  check('a dropped deck goes in as a card link with its name', /^\[\[Library\/files\/\d{4}-\d{2}\/pitch-deck\.[0-9a-f]{8}\.pptx\|Pitch deck\.pptx\]\]$/.test(lines[3] ?? ''), lines[3]);
  if (shotsDir) await page.locator('.opal-editor').first().screenshot({ path: path.join(shotsDir, 'drop-light.png') });

  // Input methods next to a chip: before and after it, at the line's start and end. The caret goes there by keys, as a person moves it.
  const cdp = await page.context().newCDPSession(page);
  const cells = [
    ['before a chip', ['Meta+ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight'], `See に${CHIP} here\n`],
    ['after a chip', ['Meta+ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight'], `See ${CHIP}に here\n`],
    ['at the line\'s start', ['Meta+ArrowLeft'], `にSee ${CHIP} here\n`],
    ['at the line\'s end', ['Meta+ArrowRight'], `See ${CHIP} hereに\n`],
  ];
  for (const [index, [label, keys, expected]] of cells.entries()) {
    const file = path.join(gallery, `IME ${index + 1}.mdo`);
    await writeFile(file, `See ${CHIP} here\n`);
    await open(file);
    await page.locator('.cm-content').first().click({ position: { x: 4, y: 4 } });
    for (const key of keys) await page.keyboard.press(key);
    await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
    await page.waitForTimeout(100);
    await cdp.send('Input.insertText', { text: 'に' });
    let after = '';
    for (let tries = 0; tries < 20; tries += 1) {
      await page.waitForTimeout(250);
      after = await readFile(file, 'utf8');
      if (after.includes('に')) break;
    }
    check(`Japanese input ${label} lands where a typed letter would`, after === expected, JSON.stringify(after));
  }
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
console.log(`${failed === 0 ? 'PASS' : 'FAIL'} ${results.length - failed} of ${results.length} checks`);
process.exit(failed === 0 ? 0 : 1);
