#!/usr/bin/env node
// Stages a packaged Opal build in an update source folder.
//
//   node scripts/stage-update.mjs <path/to/Opal.app> <target-folder> [notes]
//
// Zips the bundle with ditto, computes its sha256, reads the build's commit
// and time from the bundle, and writes Opal-<commit>.zip and then latest.json
// into the target folder. latest.json is written last and atomically, so an
// Opal checking at the same moment sees the old build or the new one, never
// half of either. Older Opal-*.zip files in the folder are removed afterwards.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [appArg, targetArg, ...noteWords] = process.argv.slice(2);
const fail = (message) => {
  console.error(`stage-update: ${message}`);
  process.exit(1);
};
if (!appArg || !targetArg) fail('usage: stage-update.mjs <path/to/Opal.app> <target-folder> [notes]');

const app = path.resolve(appArg);
const target = path.resolve(targetArg);
if (path.basename(app) !== 'Opal.app') fail(`the bundle must be called Opal.app: ${app}`);
if (!(await stat(app).catch(() => null))?.isDirectory()) fail(`no bundle at ${app}`);

const infoFile = path.join(app, 'Contents/Resources/app/.vite/build/build-info.json');
let build;
try {
  build = JSON.parse(await readFile(infoFile, 'utf8'));
} catch {
  fail(`no build-info.json in the bundle (${infoFile}); package it from a checkout with this script`);
}
if (!/^[0-9a-f]{4,40}$/.test(build.commit ?? '')) fail(`the build has no commit: ${JSON.stringify(build.commit)}`);
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(build.builtAt ?? '')) fail(`the build has no time: ${JSON.stringify(build.builtAt)}`);

const notes = noteWords.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
const file = `Opal-${build.commit}.zip`;
await mkdir(target, { recursive: true });

const partial = path.join(target, `.${file}.partial`);
await rm(partial, { force: true });
execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, partial], { stdio: 'inherit' });

const hash = createHash('sha256');
for await (const chunk of createReadStream(partial)) hash.update(chunk);
const sha256 = hash.digest('hex');
await rename(partial, path.join(target, file));

const latest = { version: 1, commit: build.commit, builtAt: build.builtAt, file, sha256, notes };
const pending = path.join(target, '.latest.json.partial');
await writeFile(pending, `${JSON.stringify(latest, null, 2)}\n`);
await rename(pending, path.join(target, 'latest.json'));

for (const name of await readdir(target)) {
  if (name !== file && /^Opal-[0-9a-f]{4,40}\.zip$/.test(name)) await rm(path.join(target, name), { force: true });
}

const { size } = await stat(path.join(target, file));
console.log(`Staged ${build.commit} (built ${build.builtAt}, ${(size / 1024 ** 2).toFixed(0)} MB) in ${target}`);
