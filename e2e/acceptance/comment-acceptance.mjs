// Disposable Electron acceptance for Comment: a box under a selection, the
// first-use question, a run that edits the page on disk while it is open, its
// mark running and done with the reply, a failed run in a document, Stop, the
// "not installed" and "not signed in" lines, a run that rewrites the sentence
// being typed in, marks on the rows of a wrapped paragraph (two comments on
// one row share a mark), a comment inside a drawn table, and a run whose
// process lives on after its result. The agent command is the fake
// in src/tests/fixtures/agent, found through a temp home and PATH, so no real
// command is ever found or run and nothing needs a sign-in or the network.
// Saves light and dark screenshots for people to look at; they are never
// compared. The window never takes the keyboard from whoever is using the
// computer. Own userData and temp vault; run from the repository root after
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
  'Each step has one owner and one date.',
  '',
  'The rollout runs in three waves over six weeks, and every wave starts with a dry run in the staging space so the support team can see the new screens before customers do. After each wave we read the feedback notes, fix what blocks people first, then decide with the team leads whether the next wave can start on time or should wait a week. Pricing does not change during the beta, and nobody is billed until the last wave ends and the contracts are signed.',
  '',
].join('\n');
const PARAGRAPH = 'The rollout runs in three waves';
const TABLE = [
  '# Steps',
  '',
  '| Step | Owner | Status |',
  '| --- | --- | --- |',
  '| Dry run | alex | Ready |',
  '| First wave | sam | Waiting |',
  '| Second wave | kim | Waiting |',
  '',
  'Dates follow once the first wave ends.',
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
const TABLE_FILE = path.join(vault, 'Projects', 'Owners.mdo');
await writeFile(PLAN_FILE, PLAN);
await writeFile(BRIEF_FILE, BRIEF);
await writeFile(TABLE_FILE, TABLE);
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
  "export FAKE_AGENT_REPLY='Changed line 9 of `Projects/Plan.md` into a question about the ship date.'",
  'export FAKE_AGENT_DELAY_MS=3000',
]);
// Rewrites the sentence it was asked about 1.5 s in, while the person is still typing in it.
const STEP_LINE = 'Each step has one owner and one date.';
const STEP_RUN = 'Every step names one owner and a due date.';
const REWRITES = await wrapper('claude-rewrites', [
  `export FAKE_AGENT_LOG='${runLog}'`,
  `export FAKE_AGENT_EDIT='${JSON.stringify({ find: STEP_LINE, replace: STEP_RUN })}'`,
  'export FAKE_AGENT_EDIT_DELAY_MS=1500',
  'export FAKE_AGENT_DELAY_MS=1000',
  "export FAKE_AGENT_REPLY='Reworded the line about owners and dates.'",
]);
// Rewords the first paragraph half a second in, for undo and redo.
const REWORDS = await wrapper('claude-rewords', [
  `export FAKE_AGENT_LOG='${runLog}'`,
  `export FAKE_AGENT_EDIT='${JSON.stringify({ find: 'twenty teams', replace: 'ten teams' })}'`,
  'export FAKE_AGENT_EDIT_DELAY_MS=500',
  'export FAKE_AGENT_DELAY_MS=300',
  "export FAKE_AGENT_REPLY='Cut the beta to ten teams.'",
]);
// Writes 2.5 s in from the file as it was when the run began, over whatever was saved since.
const STALE = await wrapper('claude-stale', [
  `export FAKE_AGENT_LOG='${runLog}'`,
  `export FAKE_AGENT_EDIT='${JSON.stringify({ find: 'Open questions sit', replace: 'OPEN QUESTIONS SIT' })}'`,
  'export FAKE_AGENT_EDIT_DELAY_MS=2500',
  'export FAKE_AGENT_STALE=1',
  'export FAKE_AGENT_DELAY_MS=300',
  "export FAKE_AGENT_REPLY='Capitalised the opening words.'",
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
    // Variables an agent session that starts Opal would pass down; none may reach the run.
    ANTHROPIC_API_KEY: 'sk-test-not-a-key',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
    CLAUDE_CODE_SIMPLE: '1',
    CLAUDECODE: '1',
  },
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

// The window never keeps the keyboard: once it shows, the app hides and shows
// again without being made active, so the app in front stays there and typing
// on this computer cannot land in the test. The page still acts focused.
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

/** Each word of the line holding `text`, with the middle of its box and its visual row, top to bottom. */
const wordsOf = (text) => page.evaluate((wanted) => {
  const line = [...document.querySelectorAll('.cm-line')].find((element) => element.textContent.includes(wanted));
  const words = [];
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const match of node.textContent.matchAll(/[A-Za-z]{4,}/g)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const rect = range.getBoundingClientRect();
      words.push({ word: match[0], x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, top: rect.top });
    }
  }
  const rows = [...new Set(words.map((word) => Math.round(word.top)))].sort((a, b) => a - b);
  return words.map((word) => ({ ...word, row: rows.indexOf(Math.round(word.top)) }));
}, text);

/** Double-clicks a word, so it is the selection, and comments on it. */
async function commentOnWord(word, comment) {
  await page.mouse.dblclick(word.x, word.y);
  await page.keyboard.press('Meta+Shift+M');
  await box.waitFor({ timeout: 5_000 });
  await page.keyboard.type(comment);
  await page.keyboard.press('Enter');
  await box.waitFor({ state: 'detached', timeout: 5_000 });
}

const markRects = () => marks.evaluateAll((elements) => elements.map((element) => {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, middle: rect.top + rect.height / 2, left: rect.left, status: element.dataset.status, count: Number(element.dataset.count) };
}).sort((a, b) => a.top - b.top));

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
  check('says Claude Code is not installed, with a link to the setup page', (await line.textContent()).includes('Claude Code is not installed.') && (await line.getByRole('link').getAttribute('href')) === 'https://code.claude.com/docs/en/setup');
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
  const logged = (await readFile(runLog, 'utf8')).trim().split('\n').map((entry) => JSON.parse(entry));
  const call = logged.find((entry) => entry.args?.[0] === '-p');
  check('the prompt names the file and the file\'s own line', call.prompt.includes('File: Projects/Plan.md\nSelected lines: 9-9\n'), call.prompt.split('\n').slice(2, 4).join(' | '));
  const passed = logged.flatMap((entry) => entry.keys ?? []);
  check('neither the run nor auth status gets an ANTHROPIC_*, CLAUDE_CODE_* or CLAUDECODE variable, and the run is in the folder', passed.length === 0 && call.cwd === vault && logged.some((entry) => entry.args?.[0] === 'auth'), JSON.stringify({ passed, cwd: call.cwd }));
  const markTop = await marks.first().evaluate((element) => element.getBoundingClientRect().top);
  const lineTop = await page.locator('.cm-line', { hasText: 'Do we ship on Friday' }).first().evaluate((element) => element.getBoundingClientRect().top);
  check('the mark sits beside its line', Math.abs(markTop - lineTop) < 16, `${markTop} vs ${lineTop}`);
  await marks.first().click();
  await popover.waitFor({ timeout: 5_000 });
  check('the popover holds the comment and the reply', (await popover.textContent()).includes('Make this a question') && (await popover.textContent()).includes('Changed line 9 of Projects/Plan.md into a question about the ship date.'));
  check('the reply\'s backtick span shows as code', (await popover.locator('code').textContent()) === 'Projects/Plan.md');
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

  // The run rewrites the sentence while the person types in it.
  await settings({ command: REWRITES, folders: [vault] });
  await commentOn(STEP_LINE);
  await page.keyboard.type('Say who decides the date');
  await page.keyboard.press('Enter');
  await box.waitFor({ state: 'detached', timeout: 5_000 });
  await page.locator('.cm-line', { hasText: STEP_LINE }).first().click();
  await page.keyboard.press('Home');
  for (let step = 0; step < 'Each step has one owner'.length; step += 1) await page.keyboard.press('ArrowRight');
  // Typed one key at a time, so no save happens before the run's write lands.
  const TYPED = ' (a person, not a team)';
  await page.keyboard.type(TYPED, { delay: 120 });
  const conflict = page.getByTestId('editor-conflict');
  const conflicted = await waitFor(async () => (await conflict.count()) === 1, 6_000);
  check('the run\'s rewrite of the sentence being typed in shows as a conflict, not merged', conflicted);
  check('the mark still ends as done', await waitFor(async () => (await marks.first().getAttribute('data-status')) === 'done', 8_000));
  const page1 = await page.locator('.cm-content').textContent();
  check('the page keeps what was typed', page1.includes(`Each step has one owner${TYPED} and one date.`));
  const shownRun = await page.evaluate(() => [...document.querySelectorAll('.cm-deletedChunk, .cm-deletedLine, del')].map((element) => element.textContent).join(' | '));
  check('the run\'s version shows beside it in the page', shownRun.includes('Every step names one owner and a due date.'), shownRun.slice(0, 120));
  const onDisk = await readFile(PLAN_FILE, 'utf8');
  check('the disk keeps the run\'s version until a pick is made', onDisk.includes(STEP_RUN) && !onDisk.includes(TYPED), '');
  await page.mouse.move(5, 400);
  await shoot('comment-conflict');
  await conflict.getByRole('button', { name: 'Keep mine' }).click();
  check('Keep mine saves what was typed over the run\'s version', await waitFor(async () => (await readFile(PLAN_FILE, 'utf8')).includes(`one owner${TYPED} and one date.`), 5_000));
  await marks.first().click();
  await popover.waitFor({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  await waitFor(async () => (await marks.count()) === 0, 3_000);

  // Undo takes a run's edit back as one step, in the page and on disk; redo brings it back.
  const pageText = () => page.locator('.cm-content').textContent();
  const diskText = () => readFile(PLAN_FILE, 'utf8');
  await settings({ command: REWORDS, folders: [vault] });
  await commentOn('The beta goes');
  await page.keyboard.type('Fewer teams');
  await page.keyboard.press('Enter');
  await box.waitFor({ state: 'detached', timeout: 5_000 });
  const reworded = await waitFor(async () => (await marks.first().getAttribute('data-status')) === 'done', 8_000);
  check('the run\'s edit lands', reworded && await waitFor(async () => (await pageText()).includes('goes to ten teams') && (await diskText()).includes('goes to ten teams'), 3_000),
    JSON.stringify({ status: await marks.first().getAttribute('data-status').catch(() => null), page: (await pageText()).slice(0, 80), disk: (await diskText()).split('\n')[6] }));
  await page.keyboard.press('Meta+Z');
  check('Cmd+Z takes the run\'s edit back in the page', await waitFor(async () => (await pageText()).includes('goes to twenty teams'), 2_000));
  check('and the file follows', await waitFor(async () => (await diskText()).includes('goes to twenty teams'), 4_000));
  await page.keyboard.press('Meta+Shift+Z');
  check('Shift+Cmd+Z brings it back, in the page and the file', await waitFor(async () => (await pageText()).includes('goes to ten teams'), 2_000)
    && await waitFor(async () => (await diskText()).includes('goes to ten teams'), 4_000));
  await marks.first().click();
  await popover.waitFor({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  await waitFor(async () => (await marks.count()) === 0, 3_000);

  // A run that writes from a stale read removes text the page had saved; one Cmd+Z brings it back.
  await settings({ command: STALE, folders: [vault] });
  const QUESTIONS = 'Open questions sit at the bottom until someone owns them. Typed while it ran.';
  await commentOn('Open questions sit');
  await page.keyboard.type('Capitalise the start');
  await page.keyboard.press('Enter');
  await box.waitFor({ state: 'detached', timeout: 5_000 });
  await page.locator('.cm-line', { hasText: 'Open questions sit' }).first().click();
  // End twice: the line wraps, and the first End stops at the end of the row.
  await page.keyboard.press('End');
  await page.keyboard.press('End');
  await page.keyboard.type(' TYPED');
  check('the typing is saved before the run writes', await waitFor(async () => (await diskText()).includes(`${QUESTIONS} TYPED`), 2_500));
  check('the stale write takes the saved typing out of the page and the file', await waitFor(async () => (await pageText()).includes('OPEN QUESTIONS SIT'), 6_000)
    && !(await pageText()).includes('TYPED') && !(await diskText()).includes('TYPED'));
  await waitFor(async () => (await marks.first().getAttribute('data-status')) === 'done', 5_000);
  await page.keyboard.press('Meta+Z');
  check('one Cmd+Z brings the typed text back, undamaged', await waitFor(async () => (await pageText()).includes(`${QUESTIONS} TYPED`), 2_000), (await pageText()).split('Open').slice(1, 2).join(''));
  check('and the file follows', await waitFor(async () => (await diskText()).includes(`${QUESTIONS} TYPED`), 4_000));
  await page.keyboard.press('Meta+Z');
  check('a second Cmd+Z undoes the typing cleanly', await waitFor(async () => (await pageText()).includes(QUESTIONS) && !(await pageText()).includes('TYPED') && !(await pageText()).includes('OPEN QUESTIONS'), 2_000));
  await marks.first().click();
  await popover.waitFor({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  await waitFor(async () => (await marks.count()) === 0, 3_000);

  // Comment again while the box is open keeps the box and what was typed in it.
  await commentOn('Do we ship on Friday');
  await page.keyboard.type('Half a thought');
  const firstBox = await box.getAttribute('data-comment-box');
  await page.keyboard.press('Meta+Shift+M');
  await page.waitForTimeout(300);
  check('Comment again keeps the open box, its text and its focus',
    (await box.getAttribute('data-comment-box')) === firstBox
      && (await box.locator('textarea').inputValue()) === 'Half a thought'
      && await page.evaluate(() => document.activeElement?.closest('[data-testid="comment-box"]') !== null));
  await closeBox();

  // A long wrapped paragraph: one comment on its first row, two on a later row that share a mark.
  await settings({ command: SIGNED_IN, folders: [vault] });
  await page.locator('.cm-line', { hasText: PARAGRAPH }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  let words = await wordsOf(PARAGRAPH);
  const rows = Math.max(...words.map((word) => word.row)) + 1;
  check('the paragraph wraps onto several rows', rows >= 4, `${rows} rows`);
  const later = Math.min(3, rows - 1);
  const first = words.find((word) => word.row === 0 && word.word === 'waves');
  const pair = words.filter((word) => word.row === later).slice(1, 3);
  await commentOnWord(first, 'Name the three waves');
  words = await wordsOf(PARAGRAPH);
  await commentOnWord(words.find((word) => word.row === later && word.word === pair[0].word), 'Wait on this #slow');
  words = await wordsOf(PARAGRAPH);
  await commentOnWord(words.find((word) => word.row === later && word.word === pair[1].word), 'Check this #fail');
  await waitFor(async () => (await markRects()).some((mark) => mark.status === 'failed') || (await markRects()).length === 2, 5_000);
  check('the first row\'s comment is done', await waitFor(async () => (await markRects())[0]?.status === 'done', 8_000));
  const placed = await markRects();
  words = await wordsOf(PARAGRAPH);
  const rowMiddle = (row) => words.find((word) => word.row === row).y;
  check('three comments on two rows make two marks', placed.length === 2, JSON.stringify(placed));
  check('each mark sits beside the row its selection starts on, not the paragraph\'s first row',
    placed.length === 2 && Math.abs(placed[0].middle - rowMiddle(0)) < 4 && Math.abs(placed[1].middle - rowMiddle(later)) < 4,
    JSON.stringify({ marks: placed.map((mark) => Math.round(mark.middle)), rows: [rowMiddle(0), rowMiddle(later)].map(Math.round) }));
  check('the shared mark holds two and shows running while one runs', placed[1]?.count === 2 && placed[1]?.status === 'running', JSON.stringify(placed[1]));
  const textLeft = await page.locator('.cm-content').evaluate((element) => element.getBoundingClientRect().left + parseFloat(getComputedStyle(element).paddingLeft));
  check('the marks stay in the padding, clear of the text', placed.every((mark) => mark.left + 16 <= textLeft), `${placed.map((mark) => mark.left)} vs ${textLeft}`);
  await page.mouse.move(5, 400);
  await shoot('comment-rows');
  await marks.nth(1).click();
  await popover.waitFor({ timeout: 5_000 });
  const entries = popover.getByTestId('comment-entry');
  check('the shared mark\'s popover lists both, oldest first, each with its own Stop or Dismiss',
    (await entries.count()) === 2
      && (await entries.nth(0).textContent()).includes('Wait on this') && (await entries.nth(0).getByRole('button', { name: 'Stop' }).count()) === 1
      && (await entries.nth(1).textContent()).includes('Check this') && (await entries.nth(1).getByRole('button', { name: 'Dismiss' }).count()) === 1);
  await shoot('comment-same-row');
  await entries.nth(1).getByRole('button', { name: 'Dismiss' }).click();
  check('Dismiss takes one away and leaves the other in the popover', await waitFor(async () => (await entries.count()) === 1, 3_000));
  await entries.nth(0).getByRole('button', { name: 'Stop' }).click();
  check('Stop on the last one takes the shared mark away', await waitFor(async () => (await marks.count()) === 1, 8_000));
  await page.keyboard.press('Escape').catch(() => undefined);
  await marks.first().click();
  await popover.waitFor({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  check('the first row\'s done mark goes once read', await waitFor(async () => (await marks.count()) === 0, 3_000));

  // Inside a drawn table, in a document, on a run whose process lives on after its result.
  await open(TABLE_FILE, 'Dates follow');
  const cell = page.locator('.cm-md-table td', { hasText: 'sam' }).first();
  await cell.click();
  await page.keyboard.press('Meta+Shift+M');
  await box.waitFor({ timeout: 5_000 });
  await page.keyboard.type('Add a date column #linger');
  const sentAt = Date.now();
  await page.keyboard.press('Enter');
  await box.waitFor({ state: 'detached', timeout: 5_000 });
  check('a comment inside a drawn table gets a mark', await waitFor(async () => (await marks.count()) === 1, 3_000));
  const tableRect = await page.locator('.cm-md-table').first().evaluate((element) => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; });
  const [tableMark] = await markRects();
  check('the mark sits beside the table', !!tableMark && tableMark.middle >= tableRect.top - 2 && tableMark.middle <= tableRect.bottom + 2, JSON.stringify({ tableMark, tableRect }));
  await page.mouse.move(5, 400);
  await shoot('comment-table');
  const doneSoon = await waitFor(async () => (await markRects())[0]?.status === 'done', 6_000);
  check('the mark shows done at the result, not when the process exits 5 s later', doneSoon && Date.now() - sentAt < 6_500, `${Date.now() - sentAt} ms`);
  await page.waitForTimeout(Math.max(0, 9_500 - (Date.now() - sentAt)));
  await marks.first().click();
  await popover.waitFor({ timeout: 5_000 });
  const lingerText = await popover.textContent();
  check('a later result from the same process does not replace the reply', lingerText.includes('Changed line 9') && !lingerText.includes('Noted the hook output'), lingerText);
  await page.keyboard.press('Escape');
  await waitFor(async () => (await marks.count()) === 0, 3_000);

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
