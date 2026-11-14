// Disposable Electron acceptance for Comment: a box under a selection, the
// first-use question, a run that edits the page on disk while it is open, its
// mark running and done with the reply, a failed run in a document, Stop, and
// the "not installed" and "not signed in" lines. The agent command is the fake
// in src/tests/fixtures/agent, found through a temp home and PATH, so no real
// command is ever found or run and nothing needs a sign-in or the network.
// Saves light and dark screenshots for people to look at; they are never
// compared. Own userData and temp vault; run from the repository root after
// the Vite bundles are built (see README.md here):
//
//   node e2e/acceptance/comment-acceptance.mjs [--out dir]
import { _electron as electron } from '@playwright/test';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = path.resolve(outFlag !== -1 ? args[outFlag + 1] : process.env.OPAL_COMMENT_SHOTS ?? path.join('e2e', 'out', 'comment'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const PLAN = [
  '---',
  'title: Plan',
  'tags: [launch]',
  '---',
  '# Launch plan',
  '',
  'The beta goes to twenty teams first. Each team gets a short call and a shared notes page.',
  '',
  'We ship on Friday.',
  '',
  'Open questions sit at the bottom until someone owns them.',
  '',
].join('\n');
const BRIEF = [
  '# Summary',
  '',
  'A long paragraph that could be tighter, with a few words that say the same thing twice over.',
  '',
  'A second paragraph with nothing to change.',
  '',
].join('\n');

const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'opal-comment-')));
const userData = path.join(dir, 'userData');
const vault = path.join(dir, 'Vault');
const home = path.join(dir, 'home');
const bin = path.join(dir, 'bin');
const empty = path.join(dir, 'empty');
const runLog = path.join(dir, 'runs.jsonl');
await Promise.all([mkdir(userData), mkdir(path.join(vault, 'Projects'), { recursive: true }), mkdir(home), mkdir(bin), mkdir(empty)]);
const PLAN_FILE = path.join(vault, 'Projects', 'Plan.md');
const BRIEF_FILE = path.join(vault, 'Projects', 'Brief.mdo');
await writeFile(PLAN_FILE, PLAN);
await writeFile(BRIEF_FILE, BRIEF);
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));

// The fake, behind two wrappers: one signed in that edits the plan, one signed out.
const FIXTURES = path.join(PROJECT_ROOT, 'src', 'tests', 'fixtures', 'agent');
for (const name of ['fake-agent.mjs', 'success.jsonl', 'error.jsonl', 'signed-out.jsonl']) await copyFile(path.join(FIXTURES, name), path.join(bin, name));
const wrapper = async (name, lines) => {
  const file = path.join(bin, name);
  await writeFile(file, ['#!/bin/sh', ...lines, `exec "${process.execPath}" "${path.join(bin, 'fake-agent.mjs')}" "$@"`, ''].join('\n'));
  await chmod(file, 0o755);
  return file;
};
const SIGNED_IN = await wrapper('claude', [
  `export FAKE_AGENT_LOG='${runLog}'`,
  `export FAKE_AGENT_EDIT='${JSON.stringify({ find: 'We ship on Friday.', replace: 'Do we ship on Friday, or wait for the last fixes?' })}'`,
  "export FAKE_AGENT_REPLY='Turned the line into a question about the ship date.'",
  'export FAKE_AGENT_DELAY_MS=3000',
]);
const SIGNED_OUT = await wrapper('claude-signed-out', ['export FAKE_AGENT_AUTH=out']);
const settings = (fields) => writeFile(path.join(userData, 'agent.json'), JSON.stringify({ version: 1, ...fields }, null, 2));
await mkdir(outDir, { recursive: true });

const app = await electron.launch({
  args: [PROJECT_ROOT],
  env: {
    ...process.env,
    OPAL_TEST_USER_DATA_DIR: userData,
    OPAL_TEST_AGENT_HOME: home,
    OPAL_TEST_AGENT_PATH: `${empty}:/usr/bin:/bin`,
    ANTHROPIC_API_KEY: 'sk-test-not-a-key',
  },
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 820));

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

/** The window, light and dark. */
async function shoot(name) {
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    await page.screenshot({ path: path.join(outDir, `${name}-${theme}.png`) });
  }
  await setTheme('light');
}

async function open(file, text) {
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, file);
  await page.waitForFunction((wanted) => document.querySelector('.cm-content')?.textContent?.includes(wanted), text, { timeout: 15_000 });
  await page.waitForTimeout(400);
}

const box = page.getByTestId('comment-box');
const line = page.getByTestId('comment-line');
const popover = page.getByTestId('comment-popover');
const marks = page.locator('[data-comment-mark]');

/** Selects a whole line of the page by its text and opens the box with the key. */
async function commentOn(text) {
  await page.locator('.cm-line', { hasText: text }).first().click({ clickCount: 3 });
  await page.keyboard.press('Meta+Shift+M');
  await box.waitFor({ timeout: 5_000 });
}

async function closeBox() {
  await page.keyboard.press('Escape');
  await box.waitFor({ state: 'detached', timeout: 5_000 });
}

const waitFor = async (predicate, timeout = 15_000) => {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeout) return false;
    await page.waitForTimeout(100);
  }
  return true;
};

try {
  await open(PLAN_FILE, 'We ship on Friday.');

  // Not installed: no command anywhere Opal looks.
  await settings({ command: path.join(dir, 'nowhere', 'claude'), folders: [vault] });
  await commentOn('We ship on Friday.');
  await line.waitFor({ timeout: 10_000 });
  check('says Claude Code is not installed, with a link', (await line.textContent()).includes('Claude Code is not installed.') && (await line.getByRole('link').getAttribute('href')).startsWith('https://'));
  await page.keyboard.type('Make this a question');
  await shoot('comment-not-installed');
  await closeBox();

  // Not signed in.
  await settings({ command: SIGNED_OUT, folders: [vault] });
  await commentOn('We ship on Friday.');
  await line.waitFor({ timeout: 10_000 });
  check('says Claude Code is not signed in', (await line.textContent()) === 'Claude Code is not signed in. Run claude auth login in a terminal.', await line.textContent());
  await page.keyboard.type('Make this a question');
  await shoot('comment-signed-out');
  await closeBox();

  // The box under a selection, then the first-use question on Enter.
  await settings({ command: SIGNED_IN });
  await commentOn('We ship on Friday.');
  const selected = await page.evaluate(() => document.querySelector('.cm-comment-target')?.textContent ?? '');
  check('the selection stays marked while the box is open', selected.includes('We ship on Friday.'), JSON.stringify(selected));
  await page.keyboard.type('Make this a question');
  check('the box has the caret', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Comment'));
  await shoot('comment-box');
  await page.keyboard.press('Enter');
  await line.waitFor({ timeout: 10_000 });
  check('asks once before running in this folder', (await line.textContent()).includes("Run Claude Code in this folder? It loads this folder's Claude settings, hooks and tools."));
  await shoot('comment-first-use');

  // Run: Enter on the focused Run button. The page keeps an edit typed first, saved before the run reads it.
  await page.keyboard.press('Enter');
  await box.waitFor({ state: 'detached', timeout: 10_000 });
  await marks.first().waitFor({ timeout: 5_000 });
  check('a running mark shows', (await marks.first().getAttribute('data-status')) === 'running');
  await page.mouse.move(5, 400);
  await shoot('comment-running');
  const kept = JSON.parse(await readFile(path.join(userData, 'agent.json'), 'utf8'));
  check('keeps the yes in agent.json', JSON.stringify(kept.folders) === JSON.stringify([vault]), JSON.stringify(kept));
  // Typing goes on while the run edits the file.
  await page.locator('.cm-line', { hasText: 'Open questions' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Typed while it ran.');
  const done = await waitFor(async () => (await marks.first().getAttribute('data-status')) === 'done');
  check('the mark shows done', done);
  const shown = await page.locator('.cm-content').textContent();
  check('the run\'s edit is in the open page, beside what was typed meanwhile', shown.includes('Do we ship on Friday, or wait for the last fixes?') && shown.includes('Typed while it ran.'));
  await waitFor(async () => (await readFile(PLAN_FILE, 'utf8')).includes('Typed while it ran.'));
  const disk = await readFile(PLAN_FILE, 'utf8');
  check('the file holds both and its frontmatter', disk.startsWith('---\ntitle: Plan\n') && disk.includes('Do we ship on Friday, or wait') && disk.includes('Typed while it ran.'));
  const [call] = (await readFile(runLog, 'utf8')).trim().split('\n').map((entry) => JSON.parse(entry));
  check('the prompt names the file and the file\'s own line', call.prompt.includes('File: Projects/Plan.md\nSelected lines: 9-9\n'), call.prompt.split('\n').slice(2, 4).join(' | '));
  const keys = call.keys.filter((key) => key === 'ANTHROPIC_API_KEY' || key === 'ANTHROPIC_AUTH_TOKEN');
  check('the run has neither API key variable and runs in the folder', keys.length === 0 && call.cwd === vault, JSON.stringify({ keys: call.keys, cwd: call.cwd }));
  const markTop = await marks.first().evaluate((element) => element.getBoundingClientRect().top);
  const lineTop = await page.locator('.cm-line', { hasText: 'Do we ship on Friday' }).first().evaluate((element) => element.getBoundingClientRect().top);
  check('the mark sits beside its line', Math.abs(markTop - lineTop) < 16, `${markTop} vs ${lineTop}`);
  await marks.first().click();
  await popover.waitFor({ timeout: 5_000 });
  check('the popover holds the comment and the reply', (await popover.textContent()).includes('Make this a question') && (await popover.textContent()).includes('Turned the line into a question about the ship date.'));
  await shoot('comment-done');
  await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'detached', timeout: 5_000 });
  check('a done mark goes once it has been read', await waitFor(async () => (await marks.count()) === 0, 3_000));

  // Stop: a run that waits, stopped from its mark.
  await commentOn('Open questions');
  await page.keyboard.type('Wait on this #slow');
  await page.keyboard.press('Enter');
  await marks.first().waitFor({ timeout: 5_000 });
  await marks.first().click();
  await popover.getByRole('button', { name: 'Stop' }).click();
  check('Stop ends the run and takes its mark away', await waitFor(async () => (await marks.count()) === 0, 8_000));
  await page.keyboard.press('Escape').catch(() => undefined);

  // A failed run, in a document.
  await open(BRIEF_FILE, 'A long paragraph');
  await commentOn('A long paragraph');
  await page.keyboard.type('Tighten this #fail');
  await page.keyboard.press('Enter');
  await marks.first().waitFor({ timeout: 5_000 });
  check('the failed mark shows in a document', await waitFor(async () => (await marks.first().getAttribute('data-status')) === 'failed'));
  await marks.first().click();
  await popover.waitFor({ timeout: 5_000 });
  check('the failed popover says why and offers Dismiss', (await popover.textContent()).includes('API Error: the service is overloaded') && (await popover.getByRole('button', { name: 'Dismiss' }).count()) === 1);
  await shoot('comment-failed');
  await page.keyboard.press('Escape');
  check('a failed mark stays until dismissed', (await marks.count()) === 1);
  await marks.first().click();
  await popover.getByRole('button', { name: 'Dismiss' }).click();
  check('Dismiss takes it away', await waitFor(async () => (await marks.count()) === 0, 3_000));
  check('a failed run leaves the document as it was', (await readFile(BRIEF_FILE, 'utf8')) === BRIEF);

  const hued = await page.evaluate(() => [...document.querySelectorAll('[data-comment-mark], [data-testid^="comment"], [data-testid^="comment"] *')]
    .flatMap((element) => [getComputedStyle(element).color, getComputedStyle(element).backgroundColor])
    .filter((colour) => { const channels = (colour.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number); return channels.length === 3 && Math.max(...channels) - Math.min(...channels) > 0; }));
  check('nothing of Comment carries a colour', hued.length === 0, hued.slice(0, 3).join(' '));
} catch (error) {
  check('runs without an exception', false, String(error));
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((result) => !result.ok);
console.log(`${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length} of ${results.length} checks; screenshots in ${outDir}`);
process.exit(failed.length === 0 ? 0 : 1);
