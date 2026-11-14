// Look shots: the app's surfaces, the comment box and a done comment's
// popover among them, in one window the size of a laptop screen, 1500 x 933,
// light and dark, on version A or B of an interface variant.
// Screenshots are for people; nothing here compares them. Own userData and a
// temp vault of made-up files; run from the repository root after the Vite
// bundles are built (see README.md here):
//
//   node e2e/acceptance/look-shots.mjs [--side a|b] [--variant name] [--app dir] [--out dir]
//
// --side b writes the variant's side into the temp profile before launch
// (default variant: roomy). --app launches another built copy of the app,
// such as a build of main kept for comparison. Files are named
// <side>-<theme>-<nn>-<surface>.png. The window never takes the keyboard:
// it hides once shown and shows again without being made active.
import { _electron as electron } from '@playwright/test';
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const SIDE = flag('side', 'a');
const VARIANT = flag('variant', 'roomy');
const APP = path.resolve(flag('app', process.cwd()));
const outDir = path.resolve(flag('out', path.join('e2e', 'out', 'look')));
const WIDTH = 1500;
const HEIGHT = 933;

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return iso(date);
};
const TODAY = day(0);
const daily = (date, body) => `---\ndate: ${date}\ntags:\n  - daily\n---\n${body}`;

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-look-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-look-vault-'));
await mkdir(path.join(vaultParent, 'Vault'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const put = async (relative, text) => {
  await mkdir(path.dirname(path.join(vault, relative)), { recursive: true });
  await writeFile(path.join(vault, relative), text);
};
const NOTE = 'Notes/Launch plan.md';
const DOC = 'Notes/Weekly review.mdo';
await put('Archive/Journal/Template.md', daily('{{date:YYYY-MM-DD}}', ''));
await put(`Library/daily/${TODAY}.mdo`, daily(TODAY, 'Walk the garden beds before the rain.\n\n- [ ] Order seed trays\n- [ ] Call the plumber about the kitchen tap\n- [x] Water the tomatoes\n\nThe new shelves arrive on Thursday. Clear the hall first.\n'));
await put(`Library/daily/${day(-1)}.md`, daily(day(-1), 'Read two chapters and sketched the porch steps.\n'));
await put(`Library/daily/${day(-2)}.md`, daily(day(-2), 'Quiet day. Repotted the fig.\n'));
await put(`Library/logs/${TODAY} log.md`, `---\ntype: log\ndate: ${TODAY}\ndaily: "[[Library/daily/${TODAY}]]"\n---\n- 08:10 Drafted the launch plan for the garden club newsletter. · [[Notes/Launch plan|Launch plan]] · agent turn\n- 09:30 Reviewed the week and moved two tasks to Friday. · [[Notes/Weekly review|Weekly review]] · agent turn\n- 11:45 Sorted the seed list by sowing month. · [[Projects/Garden/Seeds|Seeds]] · routine run\n`);
await put(NOTE, [
  '# Garden club newsletter',
  '',
  'The newsletter goes to the garden club first. Each member gets a short note and a link to the shared page.',
  '',
  '## Before the launch',
  '',
  '- Write the welcome note',
  '- Pick three photos from the spring beds',
  '- Ask Robin to read it through',
  '',
  '### Open questions',
  '',
  'Do we send on Friday, or wait for the last frost? Most members plant the weekend after, so a Friday note lands at the right time.',
  '',
  '#### Small print',
  '',
  'Every section has one owner and one date.',
  '',
].join('\n'));
await put(DOC, [
  '# Weekly review',
  '',
  'Three things went well and two slipped. The seed order is late.',
  '',
  '## Next week',
  '',
  '1. Finish the porch steps',
  '2. Plant the second row of beans',
  '',
].join('\n'));
await put('Notes/Ideas.md', '# Ideas\n\nA rain gauge on the shed.\n');
await put('Notes/Reading list.md', '# Reading list\n\n- The Well-Tempered Garden\n');
await put('Projects/Garden/Seeds.md', '# Seeds\n\nBeans, peas, chard.\n');
await put('Projects/Garden/Beds.md', '# Beds\n\nFour raised beds.\n');
await put('Projects/Kitchen/Tap.md', '# Tap\n\nThe hot side drips.\n');
await put('Recipes/Bread.md', '# Bread\n\nFlour, water, salt, time.\n');
// Enough recipes that the tree overflows once Recipes is open.
for (const dish of ['Apple cake', 'Bean stew', 'Carrot soup', 'Dal', 'Egg fried rice', 'Fish pie', 'Gnocchi', 'Hummus', 'Risotto', 'Lentil salad', 'Miso soup', 'Nut roast', 'Omelette', 'Pancakes']) {
  await put(`Recipes/${dish}.md`, `# ${dish}\n`);
}
await put('.opal/pins.json', JSON.stringify({ version: 1, pins: [NOTE, 'Notes/Ideas.md'] }, null, 2));
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
if (SIDE === 'b') await writeFile(path.join(userData, 'variants.json'), JSON.stringify({ version: 1, sides: { [VARIANT]: 'b' } }, null, 2));
// Comment runs the repo's fake agent command (src/tests/fixtures/agent), found through a
// temp home and PATH, so no real command is ever run. It replies and edits nothing.
const home = path.join(userData, 'agent-home');
const bin = path.join(userData, 'agent-bin');
await mkdir(home, { recursive: true });
await mkdir(bin, { recursive: true });
const FIXTURES = path.join(process.cwd(), 'src', 'tests', 'fixtures', 'agent');
for (const name of ['fake-agent.mjs', 'success.jsonl', 'error.jsonl', 'signed-out.jsonl']) await copyFile(path.join(FIXTURES, name), path.join(bin, name));
const agent = path.join(bin, 'claude');
await writeFile(agent, ['#!/bin/sh', "export FAKE_AGENT_REPLY='Named the club secretary as the one who picks the date.'", 'export FAKE_AGENT_DELAY_MS=300', `exec "${process.execPath}" "${path.join(bin, 'fake-agent.mjs')}" "$@"`, ''].join('\n'));
await chmod(agent, 0o755);
await writeFile(path.join(userData, 'agent.json'), JSON.stringify({ version: 1, command: agent, folders: [vault] }, null, 2));
await mkdir(outDir, { recursive: true });

const launch = () => electron.launch({
  args: [APP],
  env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData, OPAL_TEST_AGENT_HOME: home, OPAL_TEST_AGENT_PATH: `${path.join(userData, 'no-agent')}:/usr/bin:/bin` },
});
const app = await launch();
const watchdog = setTimeout(() => {
  console.log('FAIL the run stopped answering after 5 minutes');
  void app.close().finally(() => process.exit(1));
}, 300_000);
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

// The window never keeps the keyboard (as in daily-mdo-acceptance.mjs).
for (let wait = 0; wait < 100 && !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)); wait += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}
await app.evaluate(({ app: electronApp, BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.setContentSize(1500, 933);
  electronApp.hide();
});
await new Promise((resolve) => setTimeout(resolve, 300));
await app.evaluate(({ app: electronApp }) => electronApp.show());
await (await page.context().newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: true });
await page.emulateMedia({ reducedMotion: 'reduce' });
// No caret blink and no text caret, so two runs draw the same pixels.
await page.addStyleTag({ content: '.cm-cursorLayer, .cm-cursor { visibility: hidden !important; } input, textarea { caret-color: transparent !important; }' });

const wait = (ms) => page.waitForTimeout(ms);
const menu = (id) => app.evaluate(({ BrowserWindow }, commandId) => BrowserWindow.getAllWindows()[0].webContents.send('menu:invoke', commandId), id);
const open = async (relative) => {
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, path.join(vault, relative));
  await page.getByTestId('markdown-editor').first().waitFor({ timeout: 15_000 });
  await wait(500);
};
const rest = async () => {
  // The pointer rests on the page's blank right margin, away from rows and buttons.
  await page.mouse.move(WIDTH - 330, HEIGHT - 40);
  await wait(1400);
};
async function setTheme(theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.evaluate((resolved) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  }, theme);
  await wait(200);
}

const shots = [];
let failed = false;
async function shot(theme, index, name, prepare, undo) {
  try {
    await prepare();
    await rest();
    const png = `${SIDE}-${theme}-${String(index).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: path.join(outDir, png) });
    shots.push(png);
    console.log(`PASS ${png}`);
  } catch (error) {
    failed = true;
    console.log(`FAIL ${theme} ${name}: ${String(error).split('\n')[0]}`);
  } finally {
    if (undo) await undo().catch(() => undefined);
    await page.keyboard.press('Escape').catch(() => undefined);
    await wait(200);
  }
}

const clickWord = async (word) => {
  const box = await page.evaluate((target) => {
    const walker = document.createTreeWalker(document.querySelector('.cm-content'), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent.indexOf(target);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + target.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return null;
  }, word);
  if (!box) throw new Error(`no "${word}" on the page`);
  return box;
};

try {
  const variantOn = await page.evaluate((name) => document.documentElement.getAttribute(`data-${name}`), VARIANT);
  console.log(`root data-${VARIANT}: ${variantOn ?? '(none)'}`);
  // Daily, then the tree open at today's page, the selected row.
  await page.getByRole('button', { name: 'Daily', exact: true }).click();
  await page.locator('.opal-stack').first().waitFor({ timeout: 15_000 });
  await wait(800);
  for (const folder of ['Notes', 'Projects']) {
    const row = page.locator(`[data-tree-path="${path.join(vault, folder)}"]`);
    if ((await row.getAttribute('aria-expanded')) === 'false') await row.click();
  }
  await wait(400);

  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    await page.getByRole('button', { name: 'Daily', exact: true }).click();
    await wait(600);
    await shot(theme, 1, 'sidebar-daily', async () => {});
    await shot(theme, 2, 'note', () => open(NOTE));
    await shot(theme, 3, 'document', () => open(DOC));
    await shot(theme, 4, 'palette', async () => {
      await menu('palette.open');
      await page.getByTestId('command-palette').waitFor({ timeout: 5_000 });
      await page.keyboard.type('plan', { delay: 30 });
      await wait(500);
    });
    await shot(theme, 5, 'context-menu', async () => {
      await page.locator(`[data-tree-path="${path.join(vault, NOTE)}"]`).click({ button: 'right' });
      await wait(400);
    });
    await shot(theme, 6, 'settings', async () => {
      await menu('app.openSettings');
      await page.getByTestId('settings-dialog').waitFor({ timeout: 5_000 });
      await wait(300);
    });
    await shot(theme, 7, 'right-sidebar', async () => {
      await page.getByRole('button', { name: 'Daily', exact: true }).click();
      await wait(400);
      // The right sidebar starts open; it is opened only if something closed it.
      if (!(await page.getByTestId('day-sidebar').isVisible())) await menu('pane.toggleRight');
      await page.getByTestId('day-sidebar').waitFor({ timeout: 5_000 });
      await wait(800);
    });
    await shot(theme, 8, 'recent', async () => {
      await page.getByRole('button', { name: 'Recent', exact: true }).click();
      await wait(600);
    });
    await shot(theme, 9, 'tabs', async () => {
      await open(NOTE);
      // New Tab opens the palette for a file; Enter opens the first match in the new tab.
      for (const name of ['Weekly review', 'Ideas', 'Seeds']) {
        await menu('tabs.new');
        await page.getByTestId('command-palette').waitFor({ timeout: 5_000 });
        await page.keyboard.type(name, { delay: 20 });
        await wait(400);
        await page.keyboard.press('Enter');
        await page.getByTestId('command-palette').waitFor({ state: 'detached', timeout: 5_000 });
        await wait(400);
      }
      await page.locator('[role="tab"]').first().click();
      await wait(400);
    }, async () => {
      // Closing the last tab would close the window, so one always stays.
      while ((await page.locator('[role="tab"]').count()) > 1) {
        await page.locator('[role="tab"]').last().click();
        await menu('tabs.close');
        await wait(300);
      }
    });
    await shot(theme, 10, 'find-bar', async () => {
      await open(NOTE);
      const at = await clickWord('newsletter');
      await page.mouse.click(at.x, at.y);
      await page.keyboard.press('Meta+f');
      await page.locator('.cm-search input[name="search"]').first().waitFor({ timeout: 5_000 });
      await wait(300);
    });
    await shot(theme, 11, 'link-popover', async () => {
      await open(DOC);
      const at = await clickWord('porch');
      await page.mouse.dblclick(at.x, at.y);
      await page.keyboard.press('Meta+k');
      await page.getByTestId('link-popover').waitFor({ timeout: 5_000 });
      await wait(300);
    });
    // A tree that overflows: Daily active and today's row selected, scrolled
    // part way so the stuck folder rows show above it.
    const toggleFolders = async (order) => {
      for (const folder of order) {
        await page.locator(`[data-tree-path="${path.join(vault, folder)}"]`).click();
        await wait(150);
      }
    };
    // The tree's scroller is the nearest scrolling ancestor of a row, so this
    // also works on builds from before the tree had its own class.
    const scrollTree = (top) => page.locator('[data-tree-path]').first().evaluate((row, value) => {
      let element = row.parentElement;
      while (element && !/(auto|scroll)/.test(getComputedStyle(element).overflowY)) element = element.parentElement;
      element.scrollTop = value;
    }, top);
    await shot(theme, 14, 'long-tree', async () => {
      await page.getByRole('button', { name: 'Daily', exact: true }).click();
      await wait(500);
      await scrollTree(0);
      await wait(200);
      await toggleFolders(['Library/logs', 'Projects/Kitchen', 'Recipes']);
      const step = await page.locator('[data-tree-path]').first().evaluate((row) => row.parentElement.getBoundingClientRect().height);
      await scrollTree(Math.round(step * 1.5));
      // The thumb shows while scrolling; the picture waits for it to fade (rest()).
    }, async () => {
      await scrollTree(0);
      await wait(200);
      await toggleFolders(['Recipes', 'Projects/Kitchen', 'Library/logs']);
    });
    await shot(theme, 12, 'comment-box', async () => {
      await open(NOTE);
      await page.locator('.cm-line', { hasText: 'Every section has one owner' }).first().click({ clickCount: 3 });
      await page.keyboard.press('Meta+Shift+M');
      await page.getByTestId('comment-box').waitFor({ timeout: 5_000 });
      await page.keyboard.type('Say who picks the date', { delay: 20 });
      await wait(300);
    });
    await shot(theme, 13, 'comment-done', async () => {
      await open(NOTE);
      await page.locator('.cm-line', { hasText: 'Every section has one owner' }).first().click({ clickCount: 3 });
      await page.keyboard.press('Meta+Shift+M');
      await page.getByTestId('comment-box').waitFor({ timeout: 5_000 });
      await page.keyboard.type('Say who picks the date', { delay: 20 });
      await page.keyboard.press('Enter');
      await page.getByTestId('comment-box').waitFor({ state: 'detached', timeout: 10_000 });
      const mark = page.locator('[data-comment-mark]').first();
      for (let tries = 0; tries < 100 && (await mark.getAttribute('data-status').catch(() => null)) !== 'done'; tries += 1) await wait(100);
      await mark.click();
      await page.getByTestId('comment-popover').waitFor({ timeout: 5_000 });
      await wait(300);
    }, async () => {
      await page.keyboard.press('Escape');
      await wait(600);
    });
  }
} catch (error) {
  failed = true;
  console.log(`FAIL ${String(error)}`);
} finally {
  clearTimeout(watchdog);
  await app.close();
}

// The first frame after a launch on the variant's side: the same profile
// launched again, its window's own colour, and the root as it is when the
// first animation frame runs, which is before the first paint.
if (!failed) {
  const again = await launch();
  try {
    const win = await again.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    for (let wait = 0; wait < 100 && !(await again.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)); wait += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await again.evaluate(({ app: electronApp }) => electronApp.hide());
    const background = await again.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor());
    await again.context().addInitScript((name) => {
      requestAnimationFrame(() => {
        const root = document.documentElement;
        window.__firstFrame = { attribute: root.hasAttribute(`data-${name}`), chrome: getComputedStyle(root).getPropertyValue('--chrome').trim(), fontSize: getComputedStyle(root).getPropertyValue('--text-ui-size').trim() };
      });
    }, VARIANT);
    await win.reload();
    await win.waitForFunction(() => window.__firstFrame !== undefined, null, { timeout: 15_000 });
    const frame = await win.evaluate(() => window.__firstFrame);
    const expected = SIDE === 'b';
    const ok = frame.attribute === expected;
    if (!ok) failed = true;
    console.log(`${ok ? 'PASS' : 'FAIL'} relaunch on ${SIDE}: window background ${background}; first frame data-${VARIANT} ${frame.attribute}, --chrome ${frame.chrome}, --text-ui-size ${frame.fontSize}`);
  } catch (error) {
    failed = true;
    console.log(`FAIL relaunch: ${String(error).split('\n')[0]}`);
  } finally {
    await again.close();
  }
}
{
  await rm(userData, { recursive: true, force: true });
  await rm(vaultParent, { recursive: true, force: true });
}

console.log(`${failed || errors.length > 0 ? 'FAIL' : 'PASS'} ${shots.length} shots in ${outDir}${errors.length > 0 ? ` with page errors: ${errors.join(' | ')}` : ''}`);
process.exit(failed || errors.length > 0 ? 1 : 0);
