// Disposable acceptance for the update button, end to end, against two
// packaged builds from two commits. Nothing here touches the installed app,
// the real profile or the real backups folder: everything lives in one temp
// folder.
//
//   node e2e/acceptance/update-acceptance.mjs <first/Opal.app> <second/Opal.app> [--keep]
//
// 1. Copies the first build to <temp>/apps/Opal.app and stages the second
//    in <temp>/source with scripts/stage-update.mjs.
// 2. Writes <temp>/profile/updates.json pointing at <temp>/source.
// 3. Starts the copy with OPAL_TEST_USER_DATA_DIR=<temp>/profile and
//    OPAL_TEST_UPDATE_BACKUPS_DIR=<temp>/backups, and clicks "Update ready".
// 4. Checks that Opal quit, the bundle was swapped, the first build landed in
//    <temp>/backups, and the second build is running from <temp>/apps on
//    the same temp profile. Then quits that copy.
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const [first, second] = args.filter((arg) => !arg.startsWith('--')).map((arg) => path.resolve(arg));
if (!first || !second) {
  console.error('usage: update-acceptance.mjs <first/Opal.app> <second/Opal.app> [--keep]');
  process.exit(2);
}
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const buildOf = async (bundle) => JSON.parse(await readFile(path.join(bundle, 'Contents/Resources/app/.vite/build/build-info.json'), 'utf8'));
/** Opal processes started from this run's bundle, by pid; nothing else is ever matched. */
const running = (bundle) => {
  try {
    return execFileSync('/usr/bin/pgrep', ['-f', `${bundle}/Contents/MacOS/Opal`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
};

const temp = await mkdtemp(path.join(os.tmpdir(), 'opal-update-run-'));
const apps = path.join(temp, 'apps');
const bundle = path.join(apps, 'Opal.app');
const profile = path.join(temp, 'profile');
const backups = path.join(temp, 'backups');
const source = path.join(temp, 'source');
const vault = path.join(temp, 'vault');
console.log(`Run folder: ${temp}`);
const fsRealProfile = path.join(await realpath(temp), 'profile');
let relaunched = [];
try {
  const [one, two] = [await buildOf(first), await buildOf(second)];
  check('the two builds differ', one.commit !== two.commit && two.builtAt > one.builtAt, `${one.commit} then ${two.commit}`);
  await Promise.all([apps, profile, backups, path.join(vault, 'Notes')].map((dir) => mkdir(dir, { recursive: true })));
  execFileSync('/usr/bin/ditto', [first, bundle]);
  execFileSync(process.execPath, [path.resolve('scripts/stage-update.mjs'), second, source, 'Second build for the update run'], { stdio: 'inherit' });
  await writeFile(path.join(vault, 'Notes', 'Plan.md'), '# Plan\n\nA made-up note.\n');
  await writeFile(path.join(profile, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }));
  await writeFile(path.join(profile, 'updates.json'), JSON.stringify({ version: 1, sources: [source] }));

  const env = { ...process.env, OPAL_TEST_USER_DATA_DIR: profile, OPAL_TEST_UPDATE_BACKUPS_DIR: backups };
  const app = await electron.launch({ executablePath: path.join(bundle, 'Contents/MacOS/Opal'), args: [], env });
  const child = app.process();
  const firstPid = child.pid;
  const page = await app.firstWindow();
  const row = page.getByRole('button', { name: 'Update ready' });
  await row.waitFor({ timeout: 30_000 });
  check('the sidebar shows Update ready', true);
  check('its tooltip is the notes line', (await row.getAttribute('title')) === 'Second build for the update run');
  const closed = new Promise((resolve) => child.once('exit', resolve));
  await row.click();
  const updating = await page.getByRole('button', { name: 'Updating…' }).waitFor({ timeout: 5_000 }).then(() => true, () => false);
  check('the row reads Updating… after the click', updating);
  // Copying, checking and unpacking a 200 MB build takes a while before Opal quits.
  await Promise.race([closed, sleep(120_000)]);
  check('the first build quit', child.exitCode !== null || child.signalCode !== null);

  for (let tries = 0; tries < 120 && running(bundle).filter((pid) => pid !== firstPid).length === 0; tries += 1) await sleep(250);
  relaunched = running(bundle).filter((pid) => pid !== firstPid);
  check('a build started again from the same place', relaunched.length > 0, `pid ${relaunched.join(', ')}`);
  check('the bundle in place is the second build', (await buildOf(bundle)).commit === two.commit);
  const kept = await readdir(backups);
  const expected = `Opal-update-${one.builtAt.replace(/[-:]/g, '')}-${one.commit}.app`;
  check('the first build is in the backups folder', kept.includes(expected), kept.join(', '));
  check('the kept copy is the first build', kept.includes(expected) && (await buildOf(path.join(backups, expected))).commit === one.commit);
  if (relaunched.length) {
    const environment = execFileSync('/bin/ps', ['eww', '-o', 'command=', '-p', String(relaunched[0])], { encoding: 'utf8' });
    check('the relaunched build runs on the temp profile', environment.includes(`OPAL_TEST_USER_DATA_DIR=${profile}`));
    check('and with the temp backups folder', environment.includes(`OPAL_TEST_UPDATE_BACKUPS_DIR=${backups}`));
  }
  const log = await readFile(path.join(profile, 'updates', 'helper.log'), 'utf8').catch(() => '');
  console.log(`helper.log:\n${log.trim()}`);
  check('the helper logged the install', log.includes('Installed:'));
  // The second build has files open in the temp profile (Chromium's stores), and none in another profile.
  let open = [];
  for (let tries = 0; tries < 60 && relaunched.length && open.length === 0; tries += 1) {
    try {
      open = execFileSync('/usr/sbin/lsof', ['-p', relaunched.join(','), '-Fn'], { encoding: 'utf8' })
        .split('\n').filter((line) => line.startsWith('n/')).map((line) => line.slice(1));
    } catch {
      open = [];
    }
    open = open.filter((file) => file.includes('/Application Support/') || file.startsWith(profile) || file.startsWith(fsRealProfile));
    if (!open.some((file) => file.startsWith(profile) || file.startsWith(fsRealProfile))) {
      open = [];
      await sleep(250);
    }
  }
  check('the relaunched build has files open in the temp profile', open.length > 0, open.slice(0, 2).join(', '));
  check('and none in Application Support', !open.some((file) => file.includes('/Application Support/')));
} catch (error) {
  check('the run finished', false, error instanceof Error ? error.stack : String(error));
} finally {
  for (const pid of running(bundle)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  await sleep(1000);
  if (!keep) await rm(temp, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
process.exit(failed ? 1 : 0);
