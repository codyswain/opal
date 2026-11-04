// Disposable Electron acceptance for Daily as one document: a temp vault with
// older .md days, one .mdo day, a date with both files and no page for today.
// Daily makes today's page as a .mdo from the template, lists the days in
// order with the date as each label, and shows one toolbar above the stream.
// The toolbar acts on the document that last had focus (Bold, a list on the
// line under a paragraph, Insert > Table, Undo), greys out in a note, is
// reached with Option+F10 and gives the caret back with Escape. A day folded
// and unfolded keeps its undo. The object bar, link popover, Find bar,
// formula popover and [[ picker open inside a document day. Daily's "+"
// makes tomorrow's page as a .mdo with the caret in it, a log's daily link
// opens the .mdo, and one to a day with no page makes it as a .mdo. After
// every edit it checks the files' bytes. Saves light and dark
// screenshots at 700 and 420px for people to look at; nothing compares them.
// Own userData and temp vault; run from the repository root after the Vite
// bundles are built (see README.md here):
//
//   node e2e/acceptance/daily-mdo-acceptance.mjs [--shots dir]
import { _electron as electron } from '@playwright/test';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { png } from '../fixtures/gallery/files.setup.mjs';

const PROJECT_ROOT = process.cwd();
const args = process.argv.slice(2);
const shotsFlag = args.indexOf('--shots');
const shotsDir = path.resolve(shotsFlag !== -1 ? args[shotsFlag + 1] : path.join('e2e', 'out', 'daily-mdo'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return iso(date);
};
const TODAY = day(0);
const TOMORROW = day(1);
const YESTERDAY = day(-1);
const DOC_DAY = day(-2);
const NOTE_DAYS = [day(-3), day(-4), day(-5)];
const TEMPLATE = '---\ndate: {{date:YYYY-MM-DD}}\ntags:\n  - daily\n---\n';
const filled = (date) => `---\ndate: ${date}\ntags:\n  - daily\n---\n`;
const PICTURE = 'Library/files/2026-11/chart.a1b2c3d4.png';

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-daily-mdo-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-daily-mdo-vault-'));
await mkdir(path.join(vaultParent, 'Vault'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const DAILY = path.join(vault, 'Library/daily');
const LOGS = path.join(vault, 'Library/logs');
for (const folder of [DAILY, LOGS, path.join(vault, 'Archive/Journal'), path.join(vault, '.opal'), path.dirname(path.join(vault, PICTURE))]) {
  await mkdir(folder, { recursive: true });
}
await writeFile(path.join(vault, '.opal/files.json'), JSON.stringify({ version: 1, folder: 'Library/files', store: 'folder' }));
await writeFile(path.join(vault, 'Archive/Journal/Template.md'), TEMPLATE);
await writeFile(path.join(vault, PICTURE), png(320, 180, (x) => [Math.round((x / 320) * 200) + 30, 255]));
const file = (date, extension) => path.join(DAILY, `${date}.${extension}`);
const YESTERDAY_NOTE = `${filled(YESTERDAY)}Written in Obsidian.\n`;
await writeFile(file(YESTERDAY, 'md'), YESTERDAY_NOTE);
await writeFile(file(YESTERDAY, 'mdo'), `${filled(YESTERDAY)}Made in Opal.\n\n![[${PICTURE}|240]]\n\nA spare line for popovers.\n`);
await writeFile(file(DOC_DAY, 'mdo'), `${filled(DOC_DAY)}A document day.\n`);
for (const date of NOTE_DAYS) await writeFile(file(date, 'md'), `${filled(date)}Notes from ${date}.\n- [ ] A task\n`);
const LOG = path.join(LOGS, `${DOC_DAY} log.md`);
await writeFile(LOG, `---\ntype: log\ndate: ${DOC_DAY}\ndaily: "[[Library/daily/${DOC_DAY}]]"\n---\n- 09:00 Wrote the plan. · agent turn\n`);
// A log written before its day's page exists, as the morning's first run does.
const LATER = day(3);
const LATER_LOG = path.join(LOGS, `${LATER} log.md`);
await writeFile(LATER_LOG, `---\ntype: log\ndate: ${LATER}\ndaily: "[[Library/daily/${LATER}]]"\n---\n- 07:00 Wrote the digest. · routine run\n`);
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
await mkdir(shotsDir, { recursive: true });

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
// A run that stops answering fails rather than holding the Electron lock.
const watchdog = setTimeout(() => {
  console.log('FAIL the run stopped answering after 5 minutes');
  void app.close().finally(() => process.exit(1));
}, 300_000);
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

// The window never keeps the keyboard: once it shows, the app hides and
// shows again without being made active, so the app that was in front stays
// there and typing on this Mac cannot land in the test. The page still acts
// focused, and keeps drawing frames while other windows cover it.
for (let wait = 0; wait < 100 && !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)); wait += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}
await app.evaluate(({ app: electronApp, BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
  electronApp.hide();
});
await new Promise((resolve) => setTimeout(resolve, 300));
await app.evaluate(({ app: electronApp }) => electronApp.show());
await (await page.context().newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: true });
// Menus close without their fade, which a window out of sight can hold up.
await page.emulateMedia({ reducedMotion: 'reduce' });

const read = (target) => readFile(target, 'utf8').catch(() => null);
const exists = (target) => access(target).then(() => true, () => false);
const type = (keys) => page.keyboard.type(keys, { delay: 25 });
const press = async (...keys) => {
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(40);
  }
};

/** Waits until `target` on disk matches `want` (bytes or a test), saving once if autosave is slow. */
async function onDisk(target, want, timeout = 8_000) {
  const matches = (bytes) => bytes !== null && (typeof want === 'function' ? want(bytes) : bytes === want);
  const start = Date.now();
  let bytes = await read(target);
  let saved = false;
  while (!matches(bytes) && Date.now() - start < timeout) {
    if (!saved && Date.now() - start > timeout / 2) {
      saved = true;
      await page.keyboard.press('Meta+s');
    }
    await page.waitForTimeout(150);
    bytes = await read(target);
  }
  return bytes;
}

/** Runs one edit, then checks `target`'s bytes. */
async function edit(name, target, act, want) {
  await act();
  const bytes = await onDisk(target, want);
  const ok = bytes !== null && (typeof want === 'function' ? want(bytes) : bytes === want);
  check(name, ok, ok ? '' : `${path.basename(target)} is ${JSON.stringify(bytes)}${typeof want === 'string' ? `, wanted ${JSON.stringify(want)}` : ''}`);
  return bytes ?? '';
}

const section = (target) => page.locator(`[data-stack-section="${target}"]`);
const content = (target) => section(target).locator('.cm-content');
const toolbar = () => page.getByRole('toolbar', { name: 'Formatting' });
const tool = (name) => toolbar().getByRole('button', { name, exact: true });
const enabled = (name) => tool(name).isEnabled();
/** Picks a menu's item and waits for the menu to close, so focus is back where the menu gives it. */
async function pick(name) {
  await page.getByRole('menuitem', { name }).click();
  await page.waitForFunction(() => document.querySelectorAll('[role="menu"]').length === 0, null, { timeout: 5_000 });
  await page.waitForTimeout(100);
}

/** Which section holds focus: its path, "toolbar", or null. */
const focusIn = () => page.evaluate(() => {
  const active = document.activeElement;
  if (active?.closest('[role="toolbar"]')) return 'toolbar';
  return active?.closest('[data-stack-section]')?.getAttribute('data-stack-section') ?? null;
});

/** The centre of `word`'s first appearance in a section's text, scrolled into view, for a real click. */
const wordAt = (target, word) => page.evaluate(({ where, find }) => {
  const root = document.querySelector(`[data-stack-section="${CSS.escape(where)}"] .cm-content`);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent.search(new RegExp(`\\b${find}\\b`));
    if (at === -1) continue;
    node.parentElement.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + find.length);
    const box = range.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }
  return null;
}, { where: target, find: word });

async function clickWord(target, word) {
  const at = await wordAt(target, word);
  if (!at) throw new Error(`no "${word}" in ${path.basename(target)}`);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(200);
}

async function doubleClickWord(target, word) {
  const at = await wordAt(target, word);
  if (!at) throw new Error(`no "${word}" in ${path.basename(target)}`);
  await page.mouse.dblclick(at.x, at.y);
  await page.waitForTimeout(150);
}

/** Puts the caret at the end of `word`'s line in a section. */
async function clickEndOf(target, word) {
  await clickWord(target, word);
  await press('End');
}

async function setTheme(theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.evaluate((resolved) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  }, theme);
  await page.waitForTimeout(300);
}

/**
 * Sizes the window so the stack's frame is `width` px wide, a few steps
 * since the sidebars change width with the window, and sets the width on
 * the frame when the window cannot be that narrow.
 */
async function sizeFrame(width) {
  const setContent = (w) => app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size, 900), w);
  const frameWidth = () => page.evaluate(() => document.querySelector('.opal-stack-frame').getBoundingClientRect().width);
  await page.evaluate(() => { document.querySelector('.opal-stack-frame').style.maxWidth = ''; });
  let content = width + 600;
  for (let step = 0; step < 4; step += 1) {
    await setContent(Math.max(640, Math.round(content)));
    await page.waitForTimeout(250);
    const off = (await frameWidth()) - width;
    if (Math.abs(off) < 1 || (off > 0 && content <= 640)) break;
    content -= off;
  }
  await page.evaluate((w) => { document.querySelector('.opal-stack-frame').style.maxWidth = `${w}px`; }, width);
  await page.waitForTimeout(300);
}

/**
 * The window from its top to the frame's bottom, across the frame: the tab
 * row, the toolbar and the stream. Electron draws it, since the window does
 * not have the keyboard and other windows may cover it.
 */
async function shoot(name) {
  // The frame is measured until two reads 100ms apart agree, so a layout still settling after a resize is not cut.
  const measure = () => page.evaluate(() => {
    const box = document.querySelector('.opal-stack-frame').getBoundingClientRect();
    return { x: Math.round(box.x), y: 0, width: Math.round(box.width), height: Math.round(box.bottom) };
  });
  let area = await measure();
  for (let tries = 0; tries < 10; tries += 1) {
    await page.waitForTimeout(100);
    const again = await measure();
    if (JSON.stringify(again) === JSON.stringify(area)) break;
    area = again;
  }
  const data = await app.evaluate(async ({ BrowserWindow }, rect) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(rect)).toPNG().toString('base64'), area);
  await writeFile(path.join(shotsDir, `${name}.png`), Buffer.from(data, 'base64'));
}

try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 900));
  const stack = page.getByTestId('files-stack');
  await stack.waitFor({ timeout: 15_000 });
  await content(file(TODAY, 'mdo')).waitFor({ timeout: 15_000 });
  await page.waitForFunction((count) => document.querySelectorAll('[data-stack-section]').length >= count, 7, { timeout: 10_000 });
  await page.waitForTimeout(800);

  // 1. Daily made today's page as a document from the template, and nothing else.
  check('Daily writes today\'s page as <date>.mdo from the template', (await read(file(TODAY, 'mdo'))) === filled(TODAY));
  check('Daily writes no <date>.md beside it', !(await exists(file(TODAY, 'md'))));

  // 2. The stream: newest first, a date with both files twice, the document first, each named by its date.
  const order = await page.evaluate(() => [...document.querySelectorAll('[data-stack-section]')].map((article) => ({
    path: article.getAttribute('data-stack-section'),
    label: article.querySelector('.opal-stack-label')?.textContent ?? '',
    detail: article.querySelector('.opal-stack-detail')?.textContent ?? '',
  })));
  const wanted = [file(TODAY, 'mdo'), file(YESTERDAY, 'mdo'), file(YESTERDAY, 'md'), file(DOC_DAY, 'mdo'), ...NOTE_DAYS.map((date) => file(date, 'md'))];
  check('the stream lists today, both of yesterday\'s files (the .mdo first), the .mdo day and the .md days', JSON.stringify(order.map((row) => row.path)) === JSON.stringify(wanted), order.map((row) => path.basename(row.path)).join(', '));
  check('each section is labelled by its date, never its extension', order.every((row) => /^\d{4}-\d\d-\d\d$/.test(row.label) && row.path.includes(`/${row.label}.`)), order.map((row) => row.label).join(', '));
  check('today and yesterday read Today and Yesterday', order[0]?.detail === 'Today' && order[1]?.detail === 'Yesterday' && order[2]?.detail === 'Yesterday');
  const folds = await page.evaluate((paths) => paths.map((target) => document.querySelector(`[data-stack-section="${CSS.escape(target)}"] .opal-stack-chevron`)?.getAttribute('aria-label')), [file(YESTERDAY, 'mdo'), file(YESTERDAY, 'md'), file(DOC_DAY, 'mdo')]);
  check('a date with both files names each by its file for screen readers, and other dates by the date', JSON.stringify(folds) === JSON.stringify([`Fold ${YESTERDAY}.mdo`, `Fold ${YESTERDAY}.md`, `Fold ${DOC_DAY}`]), folds.join(', '));

  // 3. Today's new document shows no Markdown: its properties are hidden as on any page, the body empty and focused.
  const todayDoc = file(TODAY, 'mdo');
  const todayText = await content(todayDoc).evaluate((root) => [...root.querySelectorAll('.cm-line')].map((line) => (line.querySelector('.cm-placeholder') ? '' : line.textContent)).join('\n'));
  check('today\'s page shows no frontmatter and an empty body', todayText === '', JSON.stringify(todayText));
  const footer = await section(todayDoc).locator('[data-properties-toggle]').textContent();
  check('its footer counts the template\'s two properties', /2 properties/.test(footer ?? ''), footer ?? '');
  check('the empty page has the caret, not the toolbar', (await focusIn()) === todayDoc, String(await focusIn()));

  // 4. One toolbar, above the scroll, in line with the text column.
  check('Daily shows one toolbar', (await toolbar().count()) === 1);
  const bar = await toolbar().boundingBox();
  const stackBox = await stack.boundingBox();
  const column = await section(todayDoc).locator('.opal-stack-column').boundingBox();
  check('the toolbar sits above the stream\'s scroll', bar.y + bar.height <= stackBox.y + 1, `toolbar ends at ${bar.y + bar.height}, stream starts at ${stackBox.y}`);
  check('the toolbar lines up with the text column', Math.abs(bar.x - column.x) <= 8 && Math.abs(bar.width - column.width) <= 12, `toolbar ${Math.round(bar.x)}+${Math.round(bar.width)}, column ${Math.round(column.x)}+${Math.round(column.width)}`);
  check('the toolbar is live in today\'s document', await enabled('Bold'));

  // 5. The toolbar in today's document: Bold, a list, Insert > Table.
  let today = await edit('typing goes into today\'s document', todayDoc, () => type('Plan the week'), `${filled(TODAY)}Plan the week`);
  today = await edit('a double-click on "week" and the toolbar\'s Bold write **week**', todayDoc, async () => {
    await doubleClickWord(todayDoc, 'week');
    await tool('Bold').click();
  }, `${filled(TODAY)}Plan the **week**`);
  check('Bold left the caret in the text', (await focusIn()) === todayDoc, String(await focusIn()));
  check('Bold shows as pressed', (await tool('Bold').getAttribute('aria-pressed')) === 'true');
  // A line, Enter, then the toolbar's list on the empty line, then the item's text.
  today = await edit('Enter, the toolbar\'s Bulleted list and typing put a list item right under the line', todayDoc, async () => {
    await press('ArrowRight', 'End', 'Enter');
    await tool('Bulleted list').click();
    await type('First item');
  }, `${filled(TODAY)}Plan the **week**\n- First item`);
  today = await edit('Enter carries the list on', todayDoc, async () => {
    await press('End', 'Enter');
    await type('Second item');
  }, `${filled(TODAY)}Plan the **week**\n- First item\n- Second item`);
  today = await edit('Enter twice ends the list', todayDoc, () => press('Enter', 'Enter'), (bytes) => /\n- Second item\n\n?$/.test(bytes));
  const beforeTable = today;
  today = await edit('Insert > Table writes a 3 by 3 table under the list', todayDoc, async () => {
    await tool('Insert').click();
    await pick('Table');
  }, (bytes) => bytes.startsWith(beforeTable.trimEnd()) && bytes.endsWith('\n\n| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n'));
  today = await edit('typing after Insert > Table goes into the first header cell', todayDoc, () => type('Owner'), (bytes) => bytes.includes('| Owner | Column 2 | Column 3 |'));
  await press('Escape');

  // 6. The toolbar follows focus into an older document.
  const docDay = file(DOC_DAY, 'mdo');
  const docBytes = await edit('in the .mdo day, a double-click on "document" and Bold write **document**', docDay, async () => {
    await doubleClickWord(docDay, 'document');
    await tool('Bold').click();
  }, `${filled(DOC_DAY)}A **document** day.\n`);
  check('Bold there left today\'s page as it was', (await read(todayDoc)) === today);

  // 7. In a note the toolbar greys out in place.
  const noteDay = file(NOTE_DAYS[0], 'md');
  const buttonsBefore = await toolbar().getByRole('button').count();
  await clickWord(noteDay, 'Notes');
  check('in a .md day the toolbar\'s buttons are greyed out', !(await enabled('Bold')) && !(await enabled('Bulleted list')) && !(await enabled('Insert')) && !(await enabled('Undo')));
  check('the toolbar stays, with the same buttons in the same place', (await toolbar().count()) === 1 && (await toolbar().getByRole('button').count()) === buttonsBefore && JSON.stringify(await toolbar().boundingBox()) === JSON.stringify(bar), JSON.stringify(await toolbar().boundingBox()));
  check('the click left the caret in the note', (await focusIn()) === noteDay);
  await tool('Bold').click({ force: true }).catch(() => undefined);
  check('a click on the grey Bold changes nothing', (await read(noteDay)) === `${filled(NOTE_DAYS[0])}Notes from ${NOTE_DAYS[0]}.\n- [ ] A task\n` && (await read(docDay)) === docBytes);

  // 8. Each document keeps its own undo.
  await clickWord(todayDoc, 'Plan');
  await edit('the toolbar\'s Undo in today\'s page takes back only its own last step', todayDoc, () => tool('Undo').click(), (bytes) => bytes !== today && bytes.includes('| Column 1 |'));
  check('the .mdo day keeps its Bold', (await read(docDay)) === docBytes);

  // 8b. A day whose editor goes and comes back keeps its undo: here today is folded and unfolded.
  const afterUndo = await read(todayDoc);
  await clickWord(docDay, 'day');
  await section(todayDoc).locator('.opal-stack-label').click();
  await content(todayDoc).waitFor({ state: 'detached', timeout: 5_000 });
  await section(todayDoc).locator('.opal-stack-label').click();
  await content(todayDoc).waitFor({ timeout: 5_000 });
  await clickWord(todayDoc, 'Plan');
  check('after its editor went and came back, today\'s Undo is live', await enabled('Undo'));
  await edit('and takes back today\'s step before', todayDoc, () => tool('Undo').click(), (bytes) => bytes !== afterUndo && bytes.startsWith(`${filled(TODAY)}Plan the **week**`));
  await edit('Redo puts it back', todayDoc, () => tool('Redo').click(), afterUndo);

  // 9. Option+F10 reaches the toolbar from a document; Escape gives the caret back to it.
  await clickWord(docDay, 'day');
  await press('Alt+F10');
  check('Option+F10 in a document moves focus to the toolbar', (await focusIn()) === 'toolbar', String(await focusIn()));
  await press('Escape');
  check('Escape in the toolbar gives the caret back to that document', (await focusIn()) === docDay, String(await focusIn()));

  // 10. Popovers and bars inside a document day of the stream.
  const yesterdayDoc = file(YESTERDAY, 'mdo');
  const objectBar = page.locator('[data-object-bar]');
  await section(yesterdayDoc).locator('.cm-md-image img').first().scrollIntoViewIfNeeded();
  await section(yesterdayDoc).locator('.cm-md-image img').first().click();
  check('a click on a picture shows its object bar', await objectBar.waitFor({ timeout: 5_000 }).then(() => true, () => false));
  await press('Escape');

  await doubleClickWord(yesterdayDoc, 'spare');
  await press('Meta+k');
  const linkPopover = page.getByTestId('link-popover');
  check('Cmd+K opens the link popover', await linkPopover.waitFor({ timeout: 5_000 }).then(() => true, () => false));
  await press('Escape');
  await linkPopover.waitFor({ state: 'detached', timeout: 3_000 }).catch(() => undefined);

  await clickEndOf(yesterdayDoc, 'spare');
  await press('Meta+f');
  const find = section(yesterdayDoc).locator('.cm-search input[name="search"]');
  check('Cmd+F opens the Find bar in that day', await find.waitFor({ timeout: 5_000 }).then(() => true, () => false));
  await press('Escape');

  let yesterday = await read(yesterdayDoc);
  yesterday = await edit('$$ and Enter open the formula popover, and Done writes the formula', yesterdayDoc, async () => {
    await clickEndOf(yesterdayDoc, 'spare');
    await press('Enter');
    await type('$$');
    await press('Enter');
    const popover = page.getByTestId('math-popover');
    await popover.waitFor({ timeout: 5_000 });
    await popover.getByRole('textbox', { name: 'TeX' }).pressSequentially('x^2', { delay: 25 });
    await popover.getByRole('button', { name: 'Done' }).click();
    await popover.waitFor({ state: 'detached', timeout: 5_000 });
  }, (bytes) => bytes.includes('$$\nx^2\n$$'));

  await clickEndOf(yesterdayDoc, 'spare');
  await press('Enter');
  await type('[[');
  const picker = page.locator('.cm-link-picker');
  check('[[ opens the link picker', await picker.waitFor({ timeout: 5_000 }).then(() => true, () => false));
  await press('Escape');
  check('yesterday\'s .md was left alone through all of it', (await read(file(YESTERDAY, 'md'))) === YESTERDAY_NOTE);

  // 11. Screenshots: light and dark at 700 and 420, with a document focused and with a note focused.
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    for (const width of [700, 420]) {
      await sizeFrame(width);
      await clickWord(todayDoc, 'Plan');
      await page.evaluate(() => { document.querySelector('[data-testid="files-stack"]').scrollTop = 0; });
      await page.waitForTimeout(300);
      if (width === 420) check(`at 420px in ${theme} the toolbar keeps one row and moves the rest into More`, (await toolbar().boundingBox()).height <= 44 && (await tool('More').count()) === 1);
      const rows = await page.evaluate((paths) => paths.map((target) => Math.round(document.querySelector(`[data-stack-section="${CSS.escape(target)}"] .opal-stack-title-row`)?.getBoundingClientRect().height ?? 0)), [todayDoc, yesterdayDoc, file(YESTERDAY, 'md')]);
      check(`at ${width}px in ${theme} a date with both files keeps its title on one line, as today's`, rows[0] > 0 && rows.every((height) => height === rows[0]), rows.join(', '));
      await shoot(`daily-${theme}-${width}-document`);
      await clickWord(noteDay, 'Notes');
      await page.evaluate(() => { document.querySelector('[data-testid="files-stack"]').scrollTop = 0; });
      await page.waitForTimeout(300);
      await shoot(`daily-${theme}-${width}-note`);
    }
  }
  await setTheme('light');
  await sizeFrame(900);

  // 12. Daily's "+" makes tomorrow's page as a document.
  await page.getByTestId('workspace-sidebar').hover();
  await page.getByRole('button', { name: 'New daily page' }).click();
  await pick(/^Tomorrow/);
  const tomorrow = await onDisk(file(TOMORROW, 'mdo'), filled(TOMORROW));
  check('Daily\'s "+" writes tomorrow\'s page as <date>.mdo from the template', tomorrow === filled(TOMORROW), JSON.stringify(tomorrow));
  check('and no <date>.md', !(await exists(file(TOMORROW, 'md'))));
  await section(file(TOMORROW, 'mdo')).waitFor({ timeout: 5_000 });
  await page.waitForFunction((target) => document.activeElement?.closest('[data-stack-section]')?.getAttribute('data-stack-section') === target, file(TOMORROW, 'mdo'), { timeout: 5_000 }).catch(() => undefined);
  check('tomorrow\'s empty page has the caret, and the toolbar acts on it', (await focusIn()) === file(TOMORROW, 'mdo') && (await enabled('Bold')), String(await focusIn()));
  await edit('typing right after the pick goes into tomorrow\'s page', file(TOMORROW, 'mdo'), () => type('Prep'), `${filled(TOMORROW)}Prep`);
  await shoot('daily-light-900-tomorrow');
  const first = await page.evaluate(() => document.querySelector('[data-stack-section]')?.getAttribute('data-stack-section'));
  check('tomorrow\'s page comes above today\'s, labelled by its date', first === file(TOMORROW, 'mdo') && (await section(file(TOMORROW, 'mdo')).locator('.opal-stack-label').textContent()) === TOMORROW);
  check('the daily folder holds only the expected files', JSON.stringify((await readdir(DAILY)).sort()) === JSON.stringify([...wanted, file(TOMORROW, 'mdo')].map((target) => path.basename(target)).sort()), (await readdir(DAILY)).sort().join(', '));

  // 13. A log's `daily:` link opens the day's document.
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, LOG);
  const logEditor = page.locator('.opal-editor[data-layout="page"]');
  await logEditor.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await logEditor.locator('[data-properties-toggle]').click();
  const link = logEditor.locator('.cm-md-properties-link', { hasText: DOC_DAY });
  await link.waitFor({ timeout: 5_000 });
  await link.click();
  await page.waitForFunction(() => document.querySelector('.opal-editor[data-layout="page"] .cm-content')?.textContent?.includes('document day'), null, { timeout: 10_000 }).catch(() => undefined);
  const opened = await page.evaluate(() => {
    const editor = document.querySelector('.opal-editor[data-layout="page"]');
    return {
      text: editor?.querySelector('.cm-content')?.textContent ?? '',
      toolbar: !!editor?.querySelector('.opal-doc-toolbar'),
      tab: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('title') ?? '',
      label: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? '',
    };
  });
  check('the log\'s daily link opens the .mdo day as a document', opened.text.includes('document day') && opened.toolbar && opened.tab.endsWith(`${DOC_DAY}.mdo`), JSON.stringify(opened));
  check('its tab is named by the date', opened.label.trim().startsWith(DOC_DAY) && !opened.label.includes('.mdo'), opened.label);

  // 14. A log's link to a day with no page makes the page as Daily does: a document from the template.
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, LATER_LOG);
  await page.waitForFunction(() => document.querySelector('.opal-editor[data-layout="page"] .cm-content')?.textContent?.includes('Wrote the digest'), null, { timeout: 10_000 });
  const laterEditor = page.locator('.opal-editor[data-layout="page"]');
  await page.waitForTimeout(500);
  if (!(await laterEditor.locator('.cm-md-properties-link').count())) await laterEditor.locator('[data-properties-toggle]').click();
  await laterEditor.locator('.cm-md-properties-link', { hasText: LATER }).click();
  const made = await onDisk(file(LATER, 'mdo'), filled(LATER));
  check('a log\'s link to a day with no page writes <date>.mdo from the template', made === filled(LATER), JSON.stringify(made));
  check('and no empty <date>.md', !(await exists(file(LATER, 'md'))));
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
