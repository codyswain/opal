import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCUS_CHECK_MS, UpdateService, type UpdateServiceDependencies } from '@/main/updates/UpdateService';
import type { UpdateState } from '@/types/updates';

const CURRENT = { commit: 'aaa1111', builtAt: '2026-01-05T07:40:00Z' };
const NEWER = { commit: 'bbb2222', builtAt: '2026-01-06T07:40:00Z' };
const BUNDLE_ID = 'com.example.opal';
const ZIP = Buffer.from('pretend this is a zip of Opal.app');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

let dir: string;
let userData: string;
let source: string;
let backups: string;
let apps: string;
let clock: number;
let fetch: ReturnType<typeof vi.fn>;
let exec: ReturnType<typeof vi.fn>;
let spawnDetached: ReturnType<typeof vi.fn>;
let quit: ReturnType<typeof vi.fn>;
let changes: UpdateState[];
/** What the fake ditto unpacks: the names at the zip's top, and the bundle id inside. */
let unpacks: { names: string[]; bundleId: string };

const latest = (build: { commit: string; builtAt: string }, fields: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, ...build, file: `Opal-${build.commit}.zip`, sha256: sha(ZIP), notes: 'Faster daily page', ...fields });

const makeBundle = async (where: string, bundleId: string) => {
  await mkdir(path.join(where, 'Contents', 'MacOS'), { recursive: true });
  await writeFile(path.join(where, 'Contents', 'Info.plist'), bundleId);
  await writeFile(path.join(where, 'Contents', 'MacOS', 'Opal'), '');
};

const service = (overrides: Partial<UpdateServiceDependencies> = {}) =>
  new UpdateService({
    current: CURRENT,
    userData,
    home: dir,
    backupsDir: backups,
    execPath: path.join(apps, 'Opal.app', 'Contents', 'MacOS', 'Opal'),
    pid: 4242,
    isPackaged: true,
    relaunchEnv: null,
    fs,
    fetch: fetch as unknown as UpdateServiceDependencies['fetch'],
    exec: exec as unknown as UpdateServiceDependencies['exec'],
    spawnDetached,
    quit,
    now: () => clock,
    onChanged: (state) => changes.push(state),
    ...overrides,
  });

const sources = (...entries: string[]) =>
  writeFile(path.join(userData, 'updates.json'), JSON.stringify({ version: 1, sources: entries }));

const response = (body: string | Buffer, init: { status?: number; url?: string } = {}) => {
  const value = new Response(body, { status: init.status ?? 200 });
  Object.defineProperty(value, 'url', { value: init.url ?? 'https://host.example/x' });
  return value;
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'opal-updates-'));
  userData = path.join(dir, 'profile');
  source = path.join(dir, 'source');
  backups = path.join(dir, 'backups');
  apps = path.join(dir, 'apps');
  await Promise.all([userData, source, apps].map((folder) => mkdir(folder, { recursive: true })));
  await makeBundle(path.join(apps, 'Opal.app'), BUNDLE_ID);
  clock = Date.parse('2026-01-06T12:00:00Z');
  changes = [];
  unpacks = { names: ['Opal.app'], bundleId: BUNDLE_ID };
  fetch = vi.fn(async () => {
    throw new Error('offline');
  });
  spawnDetached = vi.fn();
  quit = vi.fn();
  exec = vi.fn(async (file: string, args: string[]) => {
    if (file === '/usr/bin/ditto') {
      const unpacked = args[3];
      await mkdir(unpacked, { recursive: true });
      for (const name of unpacks.names) await makeBundle(path.join(unpacked, name), unpacks.bundleId);
      return { stdout: '' };
    }
    if (file === '/usr/bin/plutil') return { stdout: `${await readFile(args[args.length - 1], 'utf8')}\n` };
    throw new Error(`unexpected ${file}`);
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe('UpdateService: checking', () => {
  it('shows nothing without updates.json, or with an unreadable one', async () => {
    expect((await service().check()).available).toBeNull();
    await writeFile(path.join(userData, 'updates.json'), '{oops');
    const state = await service().check();
    expect(state).toMatchObject({ available: null, showRow: false, canRollBack: false, busy: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('finds a newer build in a folder source', async () => {
    await sources(source);
    await writeFile(path.join(source, 'latest.json'), latest(NEWER));
    const state = await service().check();
    expect(state.available).toEqual({ ...NEWER, notes: 'Faster daily page' });
    expect(state.showRow).toBe(true);
    expect(changes.at(-1)?.showRow).toBe(true);
  });

  it('is not ready for the same commit, or for an older build', async () => {
    await sources(source);
    await writeFile(path.join(source, 'latest.json'), latest({ commit: CURRENT.commit, builtAt: NEWER.builtAt }));
    expect((await service().check()).available).toBeNull();
    await writeFile(path.join(source, 'latest.json'), latest({ commit: 'ccc3333', builtAt: '2026-01-01T00:00:00Z' }));
    expect((await service().check()).available).toBeNull();
  });

  it('asks only https addresses, and the latest build across sources wins', async () => {
    await sources('http://host.example/plain', source, 'https://host.example/opal');
    await writeFile(path.join(source, 'latest.json'), latest(NEWER));
    fetch.mockImplementation(async (url: string) =>
      url === 'https://host.example/opal/latest.json'
        ? response(latest({ commit: 'ccc3333', builtAt: '2026-01-07T00:00:00Z' }), { url })
        : response('', { status: 404 }));
    const state = await service().check();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://host.example/opal/latest.json']);
    expect(state.available?.commit).toBe('ccc3333');
  });

  it('skips a source that fails, without a word, and refuses a redirect off https', async () => {
    await sources('https://host.example/down', 'https://host.example/moved', source);
    await writeFile(path.join(source, 'latest.json'), latest(NEWER));
    fetch.mockImplementation(async (url: string) => {
      if (url.includes('/down/')) throw new Error('offline');
      return response(latest({ commit: 'ccc3333', builtAt: '2026-01-07T00:00:00Z' }), { url: 'http://host.example/moved/latest.json' });
    });
    expect((await service().check()).available?.commit).toBe(NEWER.commit);
  });

  it('checks again on focus at most every ten minutes', async () => {
    await sources(source);
    const read = vi.fn(fs.readFile);
    const updates = service({ fs: { ...fs, readFile: read as typeof fs.readFile } });
    await updates.check();
    const after = read.mock.calls.length;
    updates.focused();
    clock += FOCUS_CHECK_MS - 1;
    updates.focused();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(read.mock.calls.length).toBe(after);
    clock += 1;
    updates.focused();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(read.mock.calls.length).toBeGreaterThan(after);
  });
});

describe('UpdateService: installing', () => {
  beforeEach(async () => {
    await sources(source);
    await writeFile(path.join(source, 'latest.json'), latest(NEWER));
    await writeFile(path.join(source, `Opal-${NEWER.commit}.zip`), ZIP);
  });

  it('copies, checks and unpacks the build, writes the helper, starts it and quits', async () => {
    const updates = service();
    await updates.check();
    await updates.install();
    expect(spawnDetached).toHaveBeenCalledTimes(1);
    const [shell, [script]] = spawnDetached.mock.calls[0];
    expect(shell).toBe('/bin/bash');
    const text = await readFile(script, 'utf8');
    expect(text).toContain(`TARGET='${path.join(apps, 'Opal.app')}'`);
    expect(text).toContain(`INCOMING='${path.join(userData, 'updates', 'unpacked', 'Opal.app')}'`);
    expect(text).toContain(`'Opal-update-20260105T074000Z-aaa1111.app'`);
    expect(text).toContain('PID=4242');
    expect(quit).toHaveBeenCalledTimes(1);
    expect(updates.state().busy).toBe('installing');
  });

  it('downloads from an https source', async () => {
    await sources('https://host.example/opal');
    fetch.mockImplementation(async (url: string) =>
      url.endsWith('latest.json') ? response(latest(NEWER), { url }) : response(ZIP, { url }));
    const updates = service();
    await updates.check();
    await updates.install();
    expect(fetch.mock.calls.map(([url]) => url)).toContain(`https://host.example/opal/Opal-${NEWER.commit}.zip`);
    expect(quit).toHaveBeenCalled();
  });

  const refuses = async (message: string | RegExp, overrides: Partial<UpdateServiceDependencies> = {}) => {
    const updates = service(overrides);
    await updates.check();
    await expect(updates.install()).rejects.toThrow(message);
    expect(spawnDetached).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    expect(updates.state().busy).toBeNull();
  };

  it('refuses a zip whose checksum does not match', async () => {
    await writeFile(path.join(source, `Opal-${NEWER.commit}.zip`), Buffer.from('something else'));
    await refuses('does not match its checksum');
  });

  it('refuses a zip over the size cap', async () => {
    await refuses('too large', { maxZipBytes: 4 });
  });

  it('refuses a bundle with another bundle identifier, or more than one bundle', async () => {
    unpacks = { names: ['Opal.app'], bundleId: 'com.example.other' };
    await refuses('not a build of Opal');
    unpacks = { names: ['Opal.app', 'Other.app'], bundleId: BUNDLE_ID };
    await refuses('exactly one Opal.app');
  });

  it('refuses outside the packaged app, and when the bundle folder is not writable', async () => {
    await refuses('only in the packaged app', { isPackaged: false });
    await refuses('not running from an app bundle', { execPath: path.join(dir, 'electron') });
    await refuses(/cannot write/, { fs: { ...fs, access: async () => { throw new Error('EACCES'); } } });
  });
});

describe('UpdateService: rolling back', () => {
  beforeEach(async () => {
    await makeBundle(path.join(backups, 'Opal-update-20260101T000000Z-0001111.app'), BUNDLE_ID);
    await makeBundle(path.join(backups, 'Opal-update-20260102T000000Z-0002222.app'), BUNDLE_ID);
    await mkdir(path.join(backups, 'Opal hand-made copy.app'), { recursive: true });
  });

  it('offers the newest earlier copy, puts it back, and remembers the commit it left', async () => {
    const updates = service({ current: NEWER });
    expect((await updates.check()).canRollBack).toBe(true);
    await updates.rollBack();
    const text = await readFile(spawnDetached.mock.calls[0][1][0], 'utf8');
    expect(text).toContain(`INCOMING='${path.join(backups, 'Opal-update-20260102T000000Z-0002222.app')}'`);
    expect(text).toContain(`'Opal-update-20260106T074000Z-bbb2222.app'`);
    expect(quit).toHaveBeenCalled();
    expect(JSON.parse(await readFile(path.join(userData, 'update-state.json'), 'utf8'))).toEqual({ rolledBackFrom: NEWER.commit });
  });

  it('after a roll back, hides the row for that commit but still lets Install Update install it', async () => {
    await writeFile(path.join(userData, 'update-state.json'), JSON.stringify({ rolledBackFrom: NEWER.commit }));
    await sources(source);
    await writeFile(path.join(source, 'latest.json'), latest(NEWER));
    await writeFile(path.join(source, `Opal-${NEWER.commit}.zip`), ZIP);
    const updates = service();
    const state = await updates.check();
    expect(state.available?.commit).toBe(NEWER.commit);
    expect(state.showRow).toBe(false);
    await updates.install();
    expect(quit).toHaveBeenCalled();
    // Installing it clears the remembered commit.
    expect(await readdir(userData)).not.toContain('update-state.json');
  });

  it('a newer build than the remembered one shows the row again', async () => {
    await writeFile(path.join(userData, 'update-state.json'), JSON.stringify({ rolledBackFrom: NEWER.commit }));
    await sources(source);
    await writeFile(path.join(source, 'latest.json'), latest({ commit: 'ccc3333', builtAt: '2026-01-07T00:00:00Z' }));
    expect((await service().check()).showRow).toBe(true);
  });

  it('offers no roll back when no earlier copy is kept', async () => {
    await rm(backups, { recursive: true });
    const updates = service();
    expect((await updates.check()).canRollBack).toBe(false);
    await expect(updates.rollBack()).rejects.toThrow('no earlier build');
    expect(quit).not.toHaveBeenCalled();
  });
});
