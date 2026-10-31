// Disposable Electron acceptance for saving while git rewrites the vault.
// The vault is a clone of a bare upstream repo with 3,000 other files, so
// git takes about as long to read the tree for its stash as in the real
// vault. Each run types line A in a note and lets it autosave, uncommitted.
// Another clone pushes a commit that changes a middle line of the same note.
// Then the run types line B near the top and starts the merge vault-pull.sh
// runs (`git merge --autostash`) around the time B's autosave is due. Git
// stashes A, resets the note to HEAD, merges and puts A back. A run is a
// loss when A, B or the upstream line is missing from the file or the page
// afterwards without a conflict view, or git left the autostash in
// `git stash`.
//
// B's autosave falls from just before the merge starts to well inside it.
// In the first tens of milliseconds git reads the files for its stash before
// it leaves any mark in .git, so a save that lands then is missing from the
// stash and the reset takes it out. A post-merge hook sleeps
// OPAL_RACE_WINDOW_MS (500 by default) after the reset, because a merge in a
// small repo takes a few milliseconds and one in the 3,500-file vault takes
// 0.4 to 0.7 s. OPAL_RACE_RUNS sets the number of runs (30 by default). Own
// userData and temp repos; run from the repository root after the Vite
// bundles are built: see README.md here.
import { _electron as electron } from '@playwright/test';
import { execFile } from 'child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, realpath, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const RUNS = Number(process.env.OPAL_RACE_RUNS ?? 30);
const WINDOW_MS = Number(process.env.OPAL_RACE_WINDOW_MS ?? 500);
const AUTOSAVE_DELAY_MS = 800;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// The user's global git config could add hooks, signing or another default
// branch, and a GIT_DIR from a calling hook would point git at another repo.
const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Race', GIT_AUTHOR_EMAIL: 'race@example.com',
  GIT_COMMITTER_NAME: 'Race', GIT_COMMITTER_EMAIL: 'race@example.com',
};
const sh = (cwd, file, args) => new Promise((resolve) => {
  execFile(file, args, { cwd, env: GIT_ENV }, (error, stdout, stderr) =>
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: `${stdout}${stderr}`.trim() }));
});
const git = async (cwd, ...args) => {
  const result = await sh(cwd, 'git', args);
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.out}`);
  return result.out;
};

// vault-pull.sh --merge, without the vault's own chats steps.
const PULL = `
[ -n "$(git diff --name-only --diff-filter=U)" ] && exit 4
git rev-parse -q --verify MERGE_HEAD >/dev/null && exit 4
stashes=$(git stash list | wc -l)
if ! out=$(git merge --no-edit --autostash '@{u}' 2>&1); then
  git merge --abort 2>/dev/null
  [ "$(git stash list | wc -l)" -gt "$stashes" ] && git stash list -n 1 | grep -q 'autostash' && git stash pop -q 2>/dev/null
  printf '%s\\n' "$out"
  exit 1
fi
printf '%s\\n' "$out"
[ -n "$(git diff --name-only --diff-filter=U)" ] && exit 3
exit 0
`;

// A small deterministic generator, so every run of the script uses the same delays.
let seed = 11;
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'opal-git-race-')));
const upstream = path.join(tmp, 'upstream.git');
const vault = path.join(tmp, 'Vault');
const otherMac = path.join(tmp, 'other');
const userData = path.join(tmp, 'userdata');
const NOTE = path.join(vault, 'note.md');

await git(tmp, 'init', '-q', '--bare', '-b', 'main', upstream);
await git(tmp, 'clone', '-q', upstream, vault);
await writeFile(NOTE, '# Race\n\nTop paragraph.\n\nMiddle paragraph one.\n\nMiddle paragraph two.\n\nMiddle paragraph three.\n\nBottom paragraph.\n');
await writeFile(path.join(vault, 'other.md'), '# Other\n');
await mkdir(path.join(vault, 'filler'));
for (let index = 0; index < 3000; index += 1) {
  await writeFile(path.join(vault, 'filler', `${String(index).padStart(4, '0')}.md`), `# Filler ${index}\n`);
}
await git(vault, 'add', '-A');
await git(vault, 'commit', '-qm', 'base');
await git(vault, 'push', '-q', '-u', 'origin', 'main');
await git(tmp, 'clone', '-q', upstream, otherMac);
await writeFile(path.join(vault, '.git', 'hooks', 'post-merge'), `#!/bin/sh\nsleep ${WINDOW_MS / 1000}\n`);
await chmod(path.join(vault, '.git', 'hooks', 'post-merge'), 0o755);
await mkdir(userData, { recursive: true });
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

const saveState = () => page.getByTestId('editor-save-state').getAttribute('data-state');
const pageText = () => page.locator('.cm-content').textContent();
const waitForDisk = async (predicate, timeout = 10_000) => {
  const start = Date.now();
  let text = await readFile(NOTE, 'utf8');
  while (!predicate(text) && Date.now() - start < timeout) {
    await pause(50);
    text = await readFile(NOTE, 'utf8');
  }
  return text;
};
/** Waits until the page is neither dirty nor saving for 500 ms in a row. */
const waitForSettled = async (timeout = 10_000) => {
  const start = Date.now();
  let quietSince = null;
  while (Date.now() - start < timeout) {
    const state = await saveState();
    if (state === 'dirty' || state === 'saving') quietSince = null;
    else if (quietSince === null) quietSince = Date.now();
    else if (Date.now() - quietSince >= 500) return state;
    await pause(50);
  }
  return saveState();
};

let losses = 0;
let conflicts = 0;
let inWindow = 0;
let early = 0;
const lossDetails = [];
try {
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, NOTE);
  await page.getByTestId('markdown-editor').waitFor();
  const content = page.locator('.cm-content');

  for (let run = 1; run <= RUNS; run += 1) {
    const id = String(run).padStart(2, '0');
    const lineA = `alpha${id}saved`;
    const lineB = `bravo${id}typed`;

    // A: a new last line, autosaved and left uncommitted.
    await content.focus();
    await page.keyboard.press('Meta+ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.type(lineA);
    await waitForDisk((text) => text.includes(lineA));
    await waitForSettled();

    // Another Mac pushes a commit that changes a middle line of the note, far
    // from A and B, and the vault fetches it, as vault-pull.sh does before its merge.
    const upstreamLine = `Middle paragraph two, upstream ${id}.`;
    const otherNote = path.join(otherMac, 'note.md');
    await writeFile(otherNote, (await readFile(otherNote, 'utf8')).replace(/^Middle paragraph two.*$/m, upstreamLine));
    await git(otherMac, 'commit', '-qam', `upstream ${id}`);
    await git(otherMac, 'push', '-q');
    await git(vault, 'fetch', '-q');

    // B: typed near the top, far from A, so a merge of the two sides is clean.
    await content.focus();
    await page.keyboard.press('Meta+ArrowUp');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(lineB);
    const typed = Date.now();
    // The merge starts 250 to 850 ms after the last key, so B's autosave is
    // due from 50 ms before the merge starts to 550 ms after.
    await pause(250 + random() * 600 - (Date.now() - typed));
    const mergeStart = Date.now();
    const pull = await sh(vault, 'bash', ['-c', PULL]);
    const mergeEnd = Date.now();
    const due = typed + AUTOSAVE_DELAY_MS;
    const hit = due > mergeStart && due < mergeEnd;
    if (hit) inWindow += 1;
    // Before git leaves its first mark: about the first 45 ms of a merge in a tree this size.
    if (due > mergeStart - 10 && due < mergeStart + 45) early += 1;

    const state = await waitForSettled();
    const disk = await readFile(NOTE, 'utf8');
    const shown = await pageText();
    const stash = await git(vault, 'stash', 'list');
    const conflict = state === 'conflict';
    const missing = [lineA, lineB, upstreamLine].filter((line) => !disk.includes(line) || !shown.includes(line));
    const lost = stash !== '' || (!conflict && missing.length > 0);
    if (conflict) conflicts += 1;
    if (lost) {
      losses += 1;
      lossDetails.push(`run ${id}: missing ${missing.join(', ') || 'nothing'}, stash ${stash ? 'kept the autostash' : 'empty'}, git exit ${pull.code}`);
    }
    console.log(`run ${id}: autosave due ${due - mergeStart} ms after the merge started, merge ${mergeEnd - mergeStart} ms, git exit ${pull.code}, ${pull.out.includes('Applied autostash') ? 'autostash applied' : 'autostash NOT applied'}, page ${state}${lost ? ', LOST' : ''}`);

    // Put the run back to a clean tree, as auto-sync's commit does.
    if (conflict) {
      await page.getByTestId('editor-conflict').getByRole('button', { name: 'Keep mine' }).click();
      await waitForSettled();
    }
    if (stash) await git(vault, 'stash', 'clear');
    await git(vault, 'add', '-A');
    await git(vault, 'commit', '-qm', `run ${id}`, '--allow-empty');
  }
  console.log(`\n${inWindow} of ${RUNS} runs had the autosave due while the merge ran, ${early} of them in its first 45 ms; ${conflicts} showed a conflict.`);
  check(`no saved or typed line lost in ${RUNS} runs`, losses === 0, losses ? `${losses} lost: ${lossDetails.join('; ')}` : '');
} catch (error) {
  check('flow threw', false, String(error));
}
check('no renderer errors', errors.length === 0, errors.join(' | '));
await app.close();
await rm(tmp, { recursive: true, force: true });

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
