import { createHash } from 'crypto';
import { constants } from 'fs';
import type * as fsPromises from 'fs/promises';
import path from 'path';
import type { BuildIdentity, UpdateState } from '@/types/updates';
import { helperScript } from './helperScript';
import {
  backupName,
  parseLatest,
  parseSkipped,
  parseSources,
  pickUpdate,
  rollBackTarget,
  type LatestBuild,
  type UpdateSource,
} from './updateModel';

/** The file operations the service uses; Node's `fs/promises` in the app. */
export type UpdateFs = Pick<
  typeof fsPromises,
  'readFile' | 'writeFile' | 'rename' | 'mkdir' | 'rm' | 'readdir' | 'stat' | 'access' | 'copyFile' | 'chmod' | 'open'
>;

export type UpdateFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
export type UpdateExec = (file: string, args: string[]) => Promise<{ stdout: string }>;

export interface UpdateServiceDependencies {
  /** The running build, or null when it has no identity (as under Vitest). */
  current: BuildIdentity | null;
  userData: string;
  home: string;
  /** Where kept copies of earlier builds go. */
  backupsDir: string;
  /** `process.execPath`: `…/Opal.app/Contents/MacOS/Opal` in the packaged app. */
  execPath: string;
  pid: number;
  isPackaged: boolean;
  /** Variables the relaunched build must start with: set only under a test profile. */
  relaunchEnv: Record<string, string> | null;
  fs: UpdateFs;
  fetch: UpdateFetch;
  exec: UpdateExec;
  /** Starts the helper so it outlives Opal. */
  spawnDetached: (file: string, args: string[]) => void;
  /** Quits through the normal close path, so pending saves are written first. */
  quit: () => void;
  now?: () => number;
  onChanged?: (state: UpdateState) => void;
  /** The largest zip Opal accepts. */
  maxZipBytes?: number;
}

/** How often Opal looks for a new build while it runs. */
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** Focusing the window checks again, at most this often. */
export const FOCUS_CHECK_MS = 10 * 60 * 1000;
/** If Opal is still running this long after it was asked to quit for an update, the update is off. */
export const QUIT_GRACE_MS = 70 * 1000;
const DEFAULT_MAX_ZIP = 2 * 1024 ** 3;
const JSON_LIMIT = 64 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const HELPER_LOG = 'helper.log';
const APP_NAME = 'Opal.app';

interface Offer {
  source: UpdateSource;
  build: LatestBuild;
}

class UpdateError extends Error {}

/**
 * Finds newer builds of Opal in the sources `<userData>/updates.json` lists,
 * and installs one by swapping Opal's own bundle through a detached helper.
 * Sources are read from that file only: a folder the user opens can never
 * say where Opal fetches a program from.
 */
export class UpdateService {
  private offer: Offer | null = null;
  private skipped: string | null = null;
  private rollback: string | null = null;
  private busy: UpdateState['busy'] = null;
  private lastCheck = -Infinity;
  private checking: Promise<UpdateState> | null = null;
  private reported = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: UpdateServiceDependencies) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private get stagingDir(): string {
    return path.join(this.deps.userData, 'updates');
  }

  state(): UpdateState {
    const available = this.offer
      ? { commit: this.offer.build.commit, builtAt: this.offer.build.builtAt, notes: this.offer.build.notes }
      : null;
    return {
      current: this.deps.current,
      available,
      showRow: !!available && available.commit !== this.skipped,
      canRollBack: this.rollback !== null,
      busy: this.busy,
    };
  }

  /** Checks on launch and every 30 minutes. */
  start(): void {
    void this.check();
    this.timer ??= setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The window gained focus: checks when the last check is more than ten minutes old. */
  focused(): void {
    if (this.now() - this.lastCheck >= FOCUS_CHECK_MS) void this.check();
  }

  /** Reads every source. A source that fails is skipped without a word. */
  check(): Promise<UpdateState> {
    if (this.busy) return Promise.resolve(this.state());
    this.checking ??= this.read().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async read(): Promise<UpdateState> {
    this.lastCheck = this.now();
    const sources = parseSources(await this.text(path.join(this.deps.userData, 'updates.json')), this.deps.home);
    const found = await Promise.all(
      sources.map(async (source): Promise<Offer | null> => {
        try {
          const build = parseLatest(JSON.parse(await this.latestJson(source)));
          return build ? { source, build } : null;
        } catch {
          return null;
        }
      }),
    );
    this.offer = pickUpdate(found.filter((offer): offer is Offer => offer !== null), this.deps.current);
    this.skipped = parseSkipped(await this.text(this.statePath()));
    const kept = await this.deps.fs.readdir(this.deps.backupsDir).catch(() => [] as string[]);
    this.rollback = rollBackTarget(kept, this.deps.current);
    this.emit();
    return this.state();
  }

  /** Why this copy of Opal cannot replace itself, or null when it can. */
  async blocker(): Promise<string | null> {
    if (!this.deps.isPackaged) return 'Updates install only in the packaged app.';
    if (!this.deps.current) return 'This build does not know its own version.';
    const bundle = this.bundlePath();
    if (!bundle) return 'Opal is not running from an app bundle.';
    try {
      await this.deps.fs.access(path.dirname(bundle), constants.W_OK);
    } catch {
      return `Opal cannot write to ${path.dirname(bundle)}.`;
    }
    return null;
  }

  /** `…/Opal.app` from `…/Opal.app/Contents/MacOS/Opal`, or null outside a bundle. */
  bundlePath(): string | null {
    const macos = path.dirname(this.deps.execPath);
    const contents = path.dirname(macos);
    const bundle = path.dirname(contents);
    return path.basename(macos) === 'MacOS' && path.basename(contents) === 'Contents' && bundle.endsWith('.app')
      ? bundle
      : null;
  }

  /** Fetches, checks and unpacks the available build, starts the helper, then quits. */
  install(): Promise<void> {
    return this.run('installing', async (bundle) => {
      const offer = this.offer;
      if (!offer) throw new UpdateError('No update is ready.');
      const staging = await this.cleanStaging();
      const zip = path.join(staging, offer.build.file);
      await this.obtain(offer, zip);
      if ((await this.sha256(zip)) !== offer.build.sha256) {
        throw new UpdateError('The downloaded update does not match its checksum.');
      }
      const unpacked = path.join(staging, 'unpacked');
      try {
        await this.deps.exec('/usr/bin/ditto', ['-x', '-k', zip, unpacked]);
      } catch {
        throw new UpdateError('The update could not be unpacked.');
      }
      const entries = (await this.deps.fs.readdir(unpacked)).filter((name) => name !== '.DS_Store');
      if (entries.length !== 1 || entries[0] !== APP_NAME) {
        throw new UpdateError('The update does not hold exactly one Opal.app.');
      }
      const incoming = path.join(unpacked, APP_NAME);
      await this.checkBundle(incoming, bundle);
      // Installing a build clears the one hidden after a roll back.
      await this.deps.fs.rm(this.statePath(), { force: true });
      await this.handOff('install', bundle, incoming);
    });
  }

  /** Puts back the newest kept build older than the running one, then quits. */
  rollBack(): Promise<void> {
    return this.run('rolling-back', async (bundle) => {
      const current = this.deps.current as BuildIdentity;
      const kept = await this.deps.fs.readdir(this.deps.backupsDir).catch(() => [] as string[]);
      const name = rollBackTarget(kept, current);
      if (!name) throw new UpdateError('There is no earlier build to go back to.');
      const incoming = path.join(this.deps.backupsDir, name);
      await this.checkBundle(incoming, bundle);
      await this.cleanStaging();
      await this.deps.fs.writeFile(this.statePath(), `${JSON.stringify({ rolledBackFrom: current.commit })}\n`);
      await this.handOff('rollback', bundle, incoming);
    });
  }

  private async run(kind: NonNullable<UpdateState['busy']>, work: (bundle: string) => Promise<void>): Promise<void> {
    if (this.busy) throw new Error('An update is already under way.');
    const blocked = await this.blocker();
    if (blocked) throw new Error(blocked);
    this.busy = kind;
    this.emit();
    try {
      await work(this.bundlePath() as string);
    } catch (error) {
      this.busy = null;
      this.emit();
      if (error instanceof UpdateError) throw error;
      throw new Error(kind === 'installing' ? 'The update could not be installed.' : 'Could not go back to the earlier build.');
    }
  }

  /** Writes the helper, starts it, and quits. If Opal is still open long after, the update is off. */
  private async handOff(mode: 'install' | 'rollback', bundle: string, incoming: string): Promise<void> {
    const staging = this.stagingDir;
    const script = path.join(staging, `${mode}-helper.sh`);
    const text = helperScript({
      mode,
      pid: this.deps.pid,
      target: bundle,
      incoming,
      backupsDir: this.deps.backupsDir,
      backupName: backupName(this.deps.current as BuildIdentity),
      executable: path.basename(this.deps.execPath),
      relaunchEnv: this.deps.relaunchEnv,
      logFile: path.join(staging, HELPER_LOG),
    });
    await this.deps.fs.writeFile(script, text, { mode: 0o700 });
    await this.deps.fs.chmod(script, 0o700);
    this.deps.spawnDetached('/bin/bash', [script]);
    // The helper gives up after 60 s; a quit that was cancelled frees the row again.
    setTimeout(() => {
      this.busy = null;
      this.emit();
    }, QUIT_GRACE_MS).unref?.();
    this.deps.quit();
  }

  /** The bundle must be Opal: the same bundle identifier, with the same executable. */
  private async checkBundle(incoming: string, running: string): Promise<void> {
    const [theirs, ours] = await Promise.all([this.bundleId(incoming), this.bundleId(running)]);
    if (!theirs || !ours || theirs !== ours) throw new UpdateError('The update is not a build of Opal.');
    try {
      const stat = await this.deps.fs.stat(path.join(incoming, 'Contents', 'MacOS', path.basename(this.deps.execPath)));
      if (!stat.isFile()) throw new Error();
    } catch {
      throw new UpdateError('The update is not a build of Opal.');
    }
  }

  private async bundleId(bundle: string): Promise<string | null> {
    try {
      const { stdout } = await this.deps.exec('/usr/bin/plutil', [
        '-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(bundle, 'Contents', 'Info.plist'),
      ]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** Empties `<userData>/updates/` but for the helper's log. */
  private async cleanStaging(): Promise<string> {
    const staging = this.stagingDir;
    await this.deps.fs.mkdir(staging, { recursive: true });
    for (const name of await this.deps.fs.readdir(staging)) {
      if (name !== HELPER_LOG) await this.deps.fs.rm(path.join(staging, name), { recursive: true, force: true });
    }
    return staging;
  }

  private get maxZip(): number {
    return this.deps.maxZipBytes ?? DEFAULT_MAX_ZIP;
  }

  /** Copies the zip from a folder, or downloads it, into `destination`, refusing one over the cap. */
  private async obtain(offer: Offer, destination: string): Promise<void> {
    if (offer.source.kind === 'folder') {
      const from = path.join(offer.source.path, offer.build.file);
      let size: number;
      try {
        size = (await this.deps.fs.stat(from)).size;
      } catch {
        throw new UpdateError('The update file is missing from its folder.');
      }
      if (size > this.maxZip) throw new UpdateError('The update file is too large.');
      await this.deps.fs.copyFile(from, destination);
      if ((await this.deps.fs.stat(destination)).size > this.maxZip) throw new UpdateError('The update file is too large.');
      return;
    }
    const response = await this.get(`${offer.source.url}/${offer.build.file}`, DOWNLOAD_TIMEOUT_MS).catch(() => {
      throw new UpdateError('The update could not be downloaded.');
    });
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxZip) throw new UpdateError('The update file is too large.');
    const file = await this.deps.fs.open(destination, 'w');
    try {
      let total = 0;
      await this.chunks(response, async (chunk) => {
        total += chunk.byteLength;
        if (total > this.maxZip) throw new UpdateError('The update file is too large.');
        await file.write(chunk);
      });
    } finally {
      await file.close();
    }
  }

  private async sha256(file: string): Promise<string> {
    const hash = createHash('sha256');
    const handle = await this.deps.fs.open(file, 'r');
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        hash.update(buffer.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
    return hash.digest('hex');
  }

  private async latestJson(source: UpdateSource): Promise<string> {
    if (source.kind === 'folder') {
      const file = path.join(source.path, 'latest.json');
      if ((await this.deps.fs.stat(file)).size > JSON_LIMIT) throw new Error('Too large.');
      return this.deps.fs.readFile(file, 'utf8');
    }
    const response = await this.get(`${source.url}/latest.json`, FETCH_TIMEOUT_MS);
    const parts: Uint8Array[] = [];
    let total = 0;
    await this.chunks(response, async (chunk) => {
      total += chunk.byteLength;
      if (total > JSON_LIMIT) throw new Error('Too large.');
      parts.push(chunk);
    });
    return Buffer.concat(parts).toString('utf8');
  }

  /** An https GET that must stay on https through any redirect. */
  private async get(url: string, timeoutMs: number): Promise<Response> {
    const response = await this.deps.fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.url && !response.url.startsWith('https://')) throw new Error('Redirected off https.');
    return response;
  }

  private async chunks(response: Response, each: (chunk: Uint8Array) => Promise<void>): Promise<void> {
    if (!response.body) return;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) await each(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
  }

  private statePath(): string {
    return path.join(this.deps.userData, 'update-state.json');
  }

  private async text(file: string): Promise<string | null> {
    try {
      if ((await this.deps.fs.stat(file)).size > JSON_LIMIT) return null;
      return await this.deps.fs.readFile(file, 'utf8');
    } catch {
      return null;
    }
  }

  private emit(): void {
    const state = this.state();
    const json = JSON.stringify(state);
    if (json === this.reported) return;
    this.reported = json;
    this.deps.onChanged?.(state);
  }
}
