import { spawnSync } from 'child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { helperScript, shellQuote, type HelperPlan } from '@/main/updates/helperScript';

const exists = async (file: string) => readFile(file, 'utf8').then(() => true, () => false);

describe('the update helper script text', () => {
  const plan: HelperPlan = {
    mode: 'install',
    pid: 4242,
    target: "/Applications/Opal's copy/Opal.app",
    incoming: '/data/updates/unpacked/Opal.app',
    backupsDir: '/data/backups',
    backupName: 'Opal-update-20260105T074000Z-abc1234.app',
    executable: 'Opal',
    relaunchEnv: null,
    logFile: '/data/updates/helper.log',
  };

  it('quotes every path, waits for the pid, and opens the bundle with open', () => {
    const text = helperScript(plan);
    expect(text).toContain(`TARGET='/Applications/Opal'\\''s copy/Opal.app'`);
    expect(text).toContain('PID=4242');
    expect(text).toContain('while kill -0 "$PID"');
    expect(text).toContain('-ge 300 ]');
    expect(text).toContain(`"$OPEN" "$1"`);
    expect(text).toContain("OPEN='/usr/bin/open'");
    expect(text).toContain('Installed: $TARGET');
    expect(text).not.toContain('OPAL_TEST_USER_DATA_DIR');
  });

  it('for a roll back, says so; under a test profile, starts the executable with the profile', () => {
    const text = helperScript({
      ...plan,
      mode: 'rollback',
      incoming: '/data/backups/Opal-update-20260101T000000Z-aaa1111.app',
      relaunchEnv: { OPAL_TEST_USER_DATA_DIR: '/tmp/profile one' },
    });
    expect(text).toContain('Rolled back: $TARGET');
    expect(text).toContain(`nohup /usr/bin/env 'OPAL_TEST_USER_DATA_DIR=/tmp/profile one' "$1/Contents/MacOS/$EXECUTABLE"`);
  });

  it('refuses a bad pid or variable name', () => {
    expect(() => helperScript({ ...plan, pid: 0 })).toThrow();
    expect(() => helperScript({ ...plan, relaunchEnv: { 'A;rm': 'x' } })).toThrow();
    expect(() => shellQuote('a\0b')).toThrow();
  });
});

describe.skipIf(process.platform === 'win32')('the update helper, run', () => {
  let dir: string;
  let opened: string;
  let openStub: string;

  const bundle = async (where: string, marker: string) => {
    await mkdir(path.join(where, 'Contents', 'MacOS'), { recursive: true });
    await writeFile(path.join(where, 'marker'), marker);
  };
  const marker = (where: string) => readFile(path.join(where, 'marker'), 'utf8');
  /** A pid that has already exited. */
  const exitedPid = () => spawnSync('true').pid as number;
  const run = async (plan: Partial<HelperPlan>) => {
    const script = path.join(dir, 'helper.sh');
    await writeFile(script, helperScript({
      mode: 'install',
      pid: exitedPid(),
      target: path.join(dir, 'apps', 'Opal.app'),
      incoming: path.join(dir, 'updates', 'Opal.app'),
      backupsDir: path.join(dir, 'backups'),
      backupName: 'Opal-update-20260105T074000Z-aaa1111.app',
      executable: 'Opal',
      relaunchEnv: null,
      logFile: path.join(dir, 'helper.log'),
      openCommand: openStub,
      ...plan,
    }));
    return spawnSync('/bin/bash', [script], { encoding: 'utf8' });
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'opal-helper-'));
    opened = path.join(dir, 'opened.txt');
    openStub = path.join(dir, 'open-stub.sh');
    await writeFile(openStub, `#!/bin/bash\nprintf '%s\\n' "$@" >> '${opened}'\n`);
    await chmod(openStub, 0o755);
    await bundle(path.join(dir, 'apps', 'Opal.app'), 'old');
    await bundle(path.join(dir, 'updates', 'Opal.app'), 'new');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('installs: the old bundle goes to the backups, the new one takes its place and opens', async () => {
    expect((await run({})).status).toBe(0);
    expect(await marker(path.join(dir, 'apps', 'Opal.app'))).toBe('new');
    expect(await marker(path.join(dir, 'backups', 'Opal-update-20260105T074000Z-aaa1111.app'))).toBe('old');
    expect(await readFile(opened, 'utf8')).toBe(`${path.join(dir, 'apps', 'Opal.app')}\n`);
  });

  it('changes nothing when Opal is still running after the wait', async () => {
    expect((await run({ pid: process.pid, waitSeconds: 1 })).status).toBe(1);
    expect(await marker(path.join(dir, 'apps', 'Opal.app'))).toBe('old');
    expect(await marker(path.join(dir, 'updates', 'Opal.app'))).toBe('new');
    expect(await exists(opened)).toBe(false);
    expect(await readFile(path.join(dir, 'helper.log'), 'utf8')).toContain('still running');
  });

  it('puts the old bundle back and opens it when the new one cannot move in', async () => {
    await rm(path.join(dir, 'updates', 'Opal.app'), { recursive: true });
    // An incoming path that exists but cannot be moved into place: a file inside a read-only folder.
    const locked = path.join(dir, 'locked');
    await bundle(path.join(locked, 'Opal.app'), 'new');
    await chmod(locked, 0o555);
    try {
      expect((await run({ incoming: path.join(locked, 'Opal.app') })).status).toBe(1);
    } finally {
      await chmod(locked, 0o755);
    }
    expect(await marker(path.join(dir, 'apps', 'Opal.app'))).toBe('old');
    expect(await readFile(opened, 'utf8')).toBe(`${path.join(dir, 'apps', 'Opal.app')}\n`);
  });

  it('keeps its two newest copies and never touches other names in the backups folder', async () => {
    const backups = path.join(dir, 'backups');
    for (const name of [
      'Opal-update-20260101T000000Z-1111111.app',
      'Opal-update-20260102T000000Z-2222222.app',
      'Opal-update-20260103T000000Z-3333333.app',
      'Opal-backup-hand-made.app',
      'Opal before the big change.app',
      'Opal-update-notes.txt',
    ]) {
      await mkdir(path.join(backups, name), { recursive: true });
    }
    expect((await run({ backupName: 'Opal-update-20260104T000000Z-4444444.app' })).status).toBe(0);
    expect((await readdir(backups)).sort()).toEqual([
      'Opal before the big change.app',
      'Opal-backup-hand-made.app',
      'Opal-update-20260103T000000Z-3333333.app',
      'Opal-update-20260104T000000Z-4444444.app',
      'Opal-update-notes.txt',
    ]);
  });

  it('rolls back: a kept copy moves into place and the running build becomes a kept copy', async () => {
    await rm(path.join(dir, 'updates'), { recursive: true });
    const kept = path.join(dir, 'backups', 'Opal-update-20260101T000000Z-1111111.app');
    await bundle(kept, 'previous');
    expect((await run({ mode: 'rollback', incoming: kept, backupName: 'Opal-update-20260105T074000Z-aaa1111.app' })).status).toBe(0);
    expect(await marker(path.join(dir, 'apps', 'Opal.app'))).toBe('previous');
    expect(await marker(path.join(dir, 'backups', 'Opal-update-20260105T074000Z-aaa1111.app'))).toBe('old');
    expect(await exists(path.join(kept, 'marker'))).toBe(false);
  });

  it('under a test profile, starts the new build with the same profile', async () => {
    const seen = path.join(dir, 'seen.txt');
    const executable = path.join(dir, 'updates', 'Opal.app', 'Contents', 'MacOS', 'Opal');
    await writeFile(executable, `#!/bin/bash\nprintf '%s' "$OPAL_TEST_USER_DATA_DIR" > '${seen}'\n`);
    await chmod(executable, 0o755);
    expect((await run({ relaunchEnv: { OPAL_TEST_USER_DATA_DIR: '/tmp/a test profile' } })).status).toBe(0);
    for (let tries = 0; tries < 50 && !(await exists(seen)); tries += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await readFile(seen, 'utf8')).toBe('/tmp/a test profile');
    expect(await exists(opened)).toBe(false);
  });
});
