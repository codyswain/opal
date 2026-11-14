import { randomUUID } from 'crypto';
import { constants } from 'fs';
import type * as fsPromises from 'fs/promises';
import path from 'path';
import { NOT_INSTALLED_MESSAGE, SIGNED_OUT_MESSAGE } from '@/common/commentText';
import { isFsPathAtOrBelow } from '@/common/fsPaths';
import type { AgentReadiness, CommentRequest, CommentRun } from '@/types/agent';
import { parseMarkdown } from '@/main/fs/MarkdownDocumentService';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import {
  COMMENT_LIMIT,
  SELECTION_LIMIT,
  StreamReader,
  type RunOutcome,
  agentArgs,
  agentEnv,
  commandCandidates,
  commentPrompt,
  linesBefore,
  parseAgentSettings,
  parseAuthStatus,
  runTitle,
  withFolder,
} from './agentModel';

/** The file operations the service uses; Node's `fs/promises` in the app. */
export type AgentFs = Pick<typeof fsPromises, 'readFile' | 'writeFile' | 'rename' | 'mkdir' | 'access' | 'stat'>;

/** The part of a child process the service uses. */
export interface AgentProcess {
  stdin: { end: (text: string) => void; on: (event: 'error', listener: (error: Error) => void) => unknown } | null;
  stdout: { setEncoding: (encoding: 'utf8') => unknown; on: (event: 'data', listener: (chunk: string) => void) => unknown } | null;
  stderr: { setEncoding: (encoding: 'utf8') => unknown; on: (event: 'data', listener: (chunk: string) => void) => unknown } | null;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill: (signal: NodeJS.Signals) => boolean;
}

export type AgentSpawn = (file: string, args: string[], options: { cwd: string; env: Record<string, string> }) => AgentProcess;
/** Runs a command to its end and gives its standard output whatever its exit code; rejects only when it could not run. */
export type AgentRunFile = (file: string, args: string[], options: { env: Record<string, string>; timeoutMs: number }) => Promise<{ stdout: string }>;

export interface AgentServiceDependencies {
  registry: Pick<RootRegistry, 'assertAllowed' | 'list'>;
  userData: string;
  home: string;
  env: Record<string, string | undefined>;
  fs: AgentFs;
  spawn: AgentSpawn;
  runFile: AgentRunFile;
  /** The login shell's PATH, read once, or Opal's own when the shell does not answer. */
  searchPath: () => Promise<string>;
  onChanged?: (run: CommentRun) => void;
  now?: () => number;
  /** How long after a Stop a run that has not ended is killed. */
  stopGraceMs?: number;
}

/** A yes from `auth status` is trusted this long, so the box answers at once. A no is asked again every time. */
export const SIGNED_IN_TTL_MS = 10 * 60 * 1000;
const AUTH_TIMEOUT_MS = 15_000;
const STOP_GRACE_MS = 10_000;

interface LiveRun {
  run: CommentRun;
  child: AgentProcess;
  reader: StreamReader;
  stopped: boolean;
  /** The end has been sent: at the first result line, or at exit when none came. */
  reported: boolean;
  killTimer: ReturnType<typeof setTimeout> | null;
}

class AgentError extends Error {}

/**
 * Comment's main-process half. For a comment on a page it finds the agent
 * command, checks it is signed in and that the page's opened folder said yes
 * once, then runs it in that folder with the prompt on standard input and no
 * shell, and reports how each run ends. The command and the folders that
 * said yes come from `<userData>/agent.json` only: a folder opened in Opal
 * can never name the program Opal runs.
 */
export class AgentService {
  private runs = new Map<string, LiveRun>();
  private signedIn = new Map<string, number>();

  constructor(private deps: AgentServiceDependencies) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private get settingsPath(): string {
    return path.join(this.deps.userData, 'agent.json');
  }

  private async settingsText(): Promise<string | null> {
    try {
      return await this.deps.fs.readFile(this.settingsPath, 'utf8');
    } catch {
      return null;
    }
  }

  /** The opened folder that holds `real`: the deepest, when one opened folder is inside another. */
  private rootOf(real: string): string {
    const roots = this.deps.registry.list().filter((root) => isFsPathAtOrBelow(root, real));
    if (roots.length === 0) throw new AgentError('This page is not in an opened folder.');
    return roots.sort((a, b) => b.length - a.length)[0];
  }

  /** The first candidate that is an executable file, or null. */
  async findCommand(): Promise<string | null> {
    const settings = parseAgentSettings(await this.settingsText(), this.deps.home);
    for (const candidate of commandCandidates(settings.command, this.deps.home, await this.deps.searchPath())) {
      try {
        const info = await this.deps.fs.stat(candidate);
        if (!info.isFile()) continue;
        await this.deps.fs.access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not here.
      }
    }
    return null;
  }

  /** Whether the command says it is signed in. Output Opal cannot read counts as yes, and the run then says what is wrong. */
  private async isSignedIn(command: string): Promise<boolean> {
    const until = this.signedIn.get(command);
    if (until !== undefined && until > this.now()) return true;
    let stdout = '';
    try {
      ({ stdout } = await this.deps.runFile(command, ['auth', 'status'], {
        env: agentEnv(this.deps.env, await this.deps.searchPath()),
        timeoutMs: AUTH_TIMEOUT_MS,
      }));
    } catch {
      return true;
    }
    const answer = parseAuthStatus(stdout);
    if (answer === false) {
      this.signedIn.delete(command);
      return false;
    }
    this.signedIn.set(command, this.now() + SIGNED_IN_TTL_MS);
    return true;
  }

  private async check(target: string): Promise<{ readiness: AgentReadiness; real: string; root: string; command: string | null }> {
    const real = await this.deps.registry.assertAllowed(target);
    const root = this.rootOf(real);
    const command = await this.findCommand();
    if (!command) return { readiness: { state: 'missing' }, real, root, command };
    if (!(await this.isSignedIn(command))) return { readiness: { state: 'signed-out' }, real, root, command };
    const settings = parseAgentSettings(await this.settingsText(), this.deps.home);
    if (!settings.folders.includes(root)) return { readiness: { state: 'ask', folder: path.basename(root) }, real, root, command };
    return { readiness: { state: 'ready' }, real, root, command };
  }

  async readiness(target: string): Promise<AgentReadiness> {
    return (await this.check(target)).readiness;
  }

  /** The yes to the first-use question, for the opened folder that holds `target`. */
  async allowFolder(target: string): Promise<void> {
    const root = this.rootOf(await this.deps.registry.assertAllowed(target));
    const text = withFolder(await this.settingsText(), root);
    await this.deps.fs.mkdir(this.deps.userData, { recursive: true });
    const temporary = `${this.settingsPath}.${process.pid}.${randomUUID()}.tmp`;
    await this.deps.fs.writeFile(temporary, text, 'utf8');
    await this.deps.fs.rename(temporary, this.settingsPath);
  }

  /** Starts one run for a comment. Checks everything `readiness` does first, so a comment is never lost to a setup problem. */
  async start(request: CommentRequest): Promise<CommentRun> {
    const { readiness, real, root, command } = await this.check(request.path);
    if (readiness.state === 'missing') throw new AgentError(NOT_INSTALLED_MESSAGE);
    if (readiness.state === 'signed-out') throw new AgentError(SIGNED_OUT_MESSAGE);
    if (readiness.state === 'ask' || !command) throw new AgentError('This folder has not been allowed to run comments.');
    const comment = request.comment.trim();
    if (!comment || comment.length > COMMENT_LIMIT) throw new AgentError('The comment is empty or too long.');
    const { selection } = request;
    if (selection && selection.text.length > SELECTION_LIMIT) throw new AgentError('The selection is too long to send.');

    const parsed = parseMarkdown(await this.deps.fs.readFile(real));
    const offset = linesBefore(parsed.prefix.toString('utf8'));
    const prompt = commentPrompt({
      file: path.relative(root, real).split(path.sep).join('/'),
      comment,
      selection: selection ? { first: selection.from + offset, last: selection.to + offset, text: selection.text } : null,
    });
    const settings = parseAgentSettings(await this.settingsText(), this.deps.home);
    const child = this.deps.spawn(command, agentArgs({ title: runTitle(comment), model: settings.model }), {
      cwd: root,
      env: agentEnv(this.deps.env, await this.deps.searchPath()),
    });
    const run: CommentRun = { id: randomUUID(), path: request.path, status: 'running', reply: '', sessionId: null };
    // The run ends at its first result line. The process may live on after
    // it (a folder's hooks can keep it busy, or wake it for more turns); it
    // stays tracked until it exits, so quitting still ends it.
    const report = (outcome: RunOutcome) => {
      if (live.reported) return;
      live.reported = true;
      run.status = outcome.status;
      run.reply = outcome.reply;
      run.sessionId = live.reader.sessionId;
      // A run that failed for want of a sign-in means the remembered yes is stale.
      if (outcome.signedOut) this.signedIn.delete(command);
      this.deps.onChanged?.({ ...run });
    };
    const live: LiveRun = {
      run,
      child,
      reader: new StreamReader(() => {
        if (!live.stopped) report(live.reader.outcome(false));
      }),
      stopped: false,
      reported: false,
      killTimer: null,
    };
    this.runs.set(run.id, live);

    let exited = false;
    const end = (spawnError?: Error) => {
      if (exited) return;
      exited = true;
      if (live.killTimer) clearTimeout(live.killTimer);
      this.runs.delete(run.id);
      if (spawnError) live.reader.err(`${spawnError.message}\n`);
      const outcome = live.reader.finish(live.stopped);
      report(outcome);
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => live.reader.out(chunk));
    child.stderr?.on('data', (chunk) => live.reader.err(chunk));
    child.on('error', (error) => end(error));
    child.on('close', () => end());
    // A command that exits before reading its prompt closes the pipe; that ends as the run does.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(prompt);
    this.deps.onChanged?.({ ...run });
    return { ...run };
  }

  /** Ends a run's turn with SIGINT; one still going after the grace period is killed. A run past its result has ended and is not stopped. */
  stop(id: string): void {
    const live = this.runs.get(id);
    if (!live || live.reported) return;
    this.signal(live);
  }

  private signal(live: LiveRun): void {
    if (live.stopped) return;
    live.stopped = true;
    live.child.kill('SIGINT');
    live.killTimer = setTimeout(() => {
      if (this.runs.get(live.run.id) === live) live.child.kill('SIGTERM');
    }, this.deps.stopGraceMs ?? STOP_GRACE_MS);
    live.killTimer.unref?.();
  }

  /** On quit: every process Opal started ends, including one past its result. */
  stopAll(): void {
    for (const live of [...this.runs.values()]) this.signal(live);
  }

  /** Runs that have not ended. */
  running(): CommentRun[] {
    return [...this.runs.values()].filter((live) => !live.reported).map((live) => ({ ...live.run }));
  }
}
