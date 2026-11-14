import * as fs from 'fs/promises';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SIGNED_OUT_MESSAGE } from '@/common/commentText';
import { AgentService, type AgentServiceDependencies } from '@/main/agent/AgentService';
import { AgentHandlers, validCommentRequest } from '@/main/agent/AgentHandlers';
import { runAgentFile, spawnAgent } from '@/main/agent/nodeProcesses';
import { RootRegistry } from '@/main/fs/RootRegistry';
import type { CommentRun } from '@/types/agent';

/*
 * The main-process half against a fake command: a Node script that prints a
 * saved stream and edits the file, run as a real child process. Nothing here
 * needs a sign-in or the network.
 */

const FIXTURES = path.join(__dirname, '../fixtures/agent');

let dir: string;
let vault: string;
let userData: string;
let home: string;
let bin: string;
let log: string;
let runs: CommentRun[];
let registry: RootRegistry;
let fakeEnv: Record<string, string>;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'opal-agent-')));
  vault = path.join(dir, 'Vault');
  userData = path.join(dir, 'userData');
  home = path.join(dir, 'home');
  bin = path.join(dir, 'bin');
  log = path.join(dir, 'runs.jsonl');
  await Promise.all([mkdir(path.join(vault, 'Projects'), { recursive: true }), mkdir(userData), mkdir(home), mkdir(bin)]);
  // The fake and its streams, in a folder of their own on the PATH.
  for (const name of ['fake-agent.mjs', 'success.jsonl', 'error.jsonl', 'signed-out.jsonl']) {
    await copyFile(path.join(FIXTURES, name), path.join(bin, name === 'fake-agent.mjs' ? 'claude.mjs' : name));
  }
  await writeFile(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'claude.mjs')}" "$@"\n`);
  await chmod(path.join(bin, 'claude'), 0o755);
  registry = new RootRegistry({ storePath: path.join(userData, 'disk-roots.json') });
  await registry.add(vault);
  runs = [];
  fakeEnv = { FAKE_AGENT_LOG: log };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const service = (overrides: Partial<AgentServiceDependencies> = {}) =>
  new AgentService({
    registry,
    userData,
    home,
    env: { HOME: home, ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_AUTH_TOKEN: 'token', ANTHROPIC_BASE_URL: 'http://localhost:1', CLAUDE_CODE_SIMPLE: '1', CLAUDECODE: '1', ...fakeEnv },
    fs,
    spawn: spawnAgent,
    runFile: runAgentFile,
    searchPath: async () => `${bin}:/usr/bin:/bin`,
    onChanged: (run) => runs.push(run),
    stopGraceMs: 2000,
    ...overrides,
  });

const allow = () => writeFile(path.join(userData, 'agent.json'), JSON.stringify({ version: 1, folders: [vault] }));
const PLAN = () => path.join(vault, 'Projects', 'Plan.md');
const ended = async (count = 1) => {
  for (let waited = 0; runs.filter((run) => run.status !== 'running').length < count; waited += 20) {
    if (waited > 8000) throw new Error(`No end: ${JSON.stringify(runs)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return runs.filter((run) => run.status !== 'running');
};
const logged = async () => (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

describe('AgentService', () => {
  it('says not installed when no command is in the setting, ~/.local/bin or the PATH', async () => {
    await writeFile(PLAN(), 'Plan\n');
    const agent = service({ searchPath: async () => '/usr/bin:/bin' });
    expect(await agent.readiness(PLAN())).toEqual({ state: 'missing' });
    await expect(agent.start({ path: PLAN(), comment: 'Hi', selection: null })).rejects.toThrow('Claude Code is not installed.');
  });

  it('finds the command in ~/.local/bin and in the setting before the PATH', async () => {
    await mkdir(path.join(home, '.local', 'bin'), { recursive: true });
    await copyFile(path.join(bin, 'claude'), path.join(home, '.local', 'bin', 'claude'));
    await chmod(path.join(home, '.local', 'bin', 'claude'), 0o755);
    expect(await service().findCommand()).toBe(path.join(home, '.local', 'bin', 'claude'));
    await writeFile(path.join(userData, 'agent.json'), JSON.stringify({ version: 1, command: path.join(bin, 'claude') }));
    expect(await service().findCommand()).toBe(path.join(bin, 'claude'));
    // A file that cannot run is passed over.
    await writeFile(path.join(dir, 'not-executable'), '');
    await writeFile(path.join(userData, 'agent.json'), JSON.stringify({ version: 1, command: path.join(dir, 'not-executable') }));
    expect(await service().findCommand()).toBe(path.join(home, '.local', 'bin', 'claude'));
  });

  it('says not signed in from auth status, which exits 1 then, and asks again next time', async () => {
    await writeFile(PLAN(), 'Plan\n');
    fakeEnv.FAKE_AGENT_AUTH = 'out';
    const agent = service();
    expect(await agent.readiness(PLAN())).toEqual({ state: 'signed-out' });
    await expect(agent.start({ path: PLAN(), comment: 'Hi', selection: null })).rejects.toThrow(SIGNED_OUT_MESSAGE);
    fakeEnv.FAKE_AGENT_AUTH = 'in';
    expect(await service().readiness(PLAN())).toEqual({ state: 'ask', folder: 'Vault' });
  });

  it('forgets a remembered sign-in when a run fails for want of one', async () => {
    await allow();
    await writeFile(PLAN(), 'Plan\n');
    const env: Record<string, string> = { HOME: home, ...fakeEnv, FAKE_AGENT_AUTH: 'in' };
    const agent = service({ env });
    expect(await agent.readiness(PLAN())).toEqual({ state: 'ready' });
    // Signed out since: the remembered yes still answers.
    env.FAKE_AGENT_AUTH = 'out';
    expect(await agent.readiness(PLAN())).toEqual({ state: 'ready' });
    await agent.start({ path: PLAN(), comment: 'Tighten #signed-out', selection: null });
    expect((await ended())[0]).toMatchObject({ status: 'failed', reply: SIGNED_OUT_MESSAGE });
    expect(await agent.readiness(PLAN())).toEqual({ state: 'signed-out' });
  });

  it('keeps a remembered sign-in after a run that failed for another reason', async () => {
    await allow();
    await writeFile(PLAN(), 'Plan\n');
    const env: Record<string, string> = { HOME: home, ...fakeEnv };
    const agent = service({ env });
    expect(await agent.readiness(PLAN())).toEqual({ state: 'ready' });
    await agent.start({ path: PLAN(), comment: 'Tighten #fail', selection: null });
    await ended();
    env.FAKE_AGENT_AUTH = 'out';
    expect(await agent.readiness(PLAN())).toEqual({ state: 'ready' });
  });

  it('asks once per opened folder and keeps the yes in agent.json beside the other settings', async () => {
    await writeFile(PLAN(), 'Plan\n');
    await writeFile(path.join(userData, 'agent.json'), JSON.stringify({ version: 1, model: 'sonnet' }));
    const agent = service();
    expect(await agent.readiness(PLAN())).toEqual({ state: 'ask', folder: 'Vault' });
    await expect(agent.start({ path: PLAN(), comment: 'Hi', selection: null })).rejects.toThrow(/not been allowed/);
    await agent.allowFolder(PLAN());
    expect(JSON.parse(await readFile(path.join(userData, 'agent.json'), 'utf8'))).toEqual({ version: 1, model: 'sonnet', folders: [vault] });
    expect(await agent.readiness(PLAN())).toEqual({ state: 'ready' });
  });

  it('refuses a page outside the opened folders', async () => {
    await writeFile(path.join(dir, 'outside.md'), 'x');
    await expect(service().readiness(path.join(dir, 'outside.md'))).rejects.toThrow();
  });

  it('runs once in the folder with the prompt on stdin, the file\'s own line numbers, no API keys, and reports the reply', async () => {
    await allow();
    await writeFile(PLAN(), '---\ntitle: Plan\n---\n# Plan\n\nWe ship on Friday.\nThen we rest.\n');
    fakeEnv.FAKE_AGENT_EDIT = JSON.stringify({ find: 'We ship on Friday.', replace: 'Do we ship on Friday?' });
    const agent = service();
    const started = await agent.start({ path: PLAN(), comment: '  Make this a question.  ', selection: { from: 3, to: 3, text: 'We ship on Friday.' } });
    expect(started).toMatchObject({ status: 'running', path: PLAN(), reply: '' });
    const [run] = await ended();
    expect(run).toEqual({ id: started.id, path: PLAN(), status: 'done', reply: 'Rewrote the line as a question.', sessionId: '3f2b8f0e-6a1d-4f53-8d6e-0c9a7b5e2d41' });
    expect(await readFile(PLAN(), 'utf8')).toBe('---\ntitle: Plan\n---\n# Plan\n\nDo we ship on Friday?\nThen we rest.\n');
    const calls = await logged();
    // auth status ran with none of the session's variables either.
    const auth = calls.filter((entry) => entry.args?.[0] === 'auth');
    expect(auth.length).toBeGreaterThan(0);
    expect(auth.every((entry) => entry.keys.length === 0)).toBe(true);
    const call = calls.find((entry) => entry.args?.[0] === '-p');
    expect(call?.cwd).toBe(vault);
    expect(call.args).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--name', 'Make this a question.']);
    expect(call.keys).toEqual([]);
    expect(call.path).toBe(`${bin}:/usr/bin:/bin`);
    expect(call.prompt).toContain('File: Projects/Plan.md\nSelected lines: 6-6\n');
    expect(call.prompt).toContain('<<<\nWe ship on Friday.\n>>>\n\nComment:\nMake this a question.\n');
    expect(agent.running()).toEqual([]);
  });

  it('ends a run at its first result line while the process lives on, and ignores later results', async () => {
    await allow();
    await writeFile(PLAN(), 'Plan\n');
    fakeEnv.FAKE_AGENT_LINGER_MS = '5000';
    const agent = service();
    const started = Date.now();
    const { id } = await agent.start({ path: PLAN(), comment: 'Tighten', selection: null });
    const [run] = await ended();
    expect(Date.now() - started).toBeLessThan(3000);
    expect(run).toMatchObject({ id, status: 'done', reply: 'Rewrote the line as a question.' });
    // Past its result a run has ended: it is not running and Stop does nothing.
    expect(agent.running()).toEqual([]);
    agent.stop(id);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await logged()).some((entry) => entry.signal)).toBe(false);
    // Quitting still ends the lingering process, which then reports nothing new.
    agent.stopAll();
    for (let waited = 0; (await readFile(log, 'utf8')).indexOf('"signal"') < 0 && waited < 4000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect((await logged()).some((entry) => entry.signal === 'SIGINT')).toBe(true);
    expect(runs.filter((entry) => entry.status !== 'running')).toHaveLength(1);
  }, 15000);

  it('reports nothing from a second result even when the process exits after it', async () => {
    await allow();
    await writeFile(PLAN(), 'Plan\n');
    fakeEnv.FAKE_AGENT_LINGER_MS = '200';
    const exits: number[] = [];
    const agent = service({
      spawn: (file, args, options) => {
        const child = spawnAgent(file, args, options);
        child.on('close', () => exits.push(Date.now()));
        return child;
      },
    });
    await agent.start({ path: PLAN(), comment: 'Tighten', selection: null });
    await ended();
    for (let waited = 0; exits.length === 0 && waited < 4000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(exits).toHaveLength(1);
    expect(runs.filter((entry) => entry.status !== 'running')).toEqual([expect.objectContaining({ status: 'done', reply: 'Rewrote the line as a question.' })]);
  });

  it('passes the model from the settings', async () => {
    await writeFile(path.join(userData, 'agent.json'), JSON.stringify({ version: 1, model: 'sonnet', folders: [vault] }));
    await writeFile(PLAN(), 'Plan\n');
    await service().start({ path: PLAN(), comment: 'Tighten', selection: null });
    await ended();
    expect((await logged()).find((entry) => entry.args?.[0] === '-p')?.args.slice(-2)).toEqual(['--model', 'sonnet']);
  });

  it('fails with the result\'s message, the sign-in line, or the last error line when no result came', async () => {
    await allow();
    await writeFile(PLAN(), 'Plan\n');
    const agent = service();
    await agent.start({ path: PLAN(), comment: 'Tighten #fail', selection: null });
    await agent.start({ path: PLAN(), comment: 'Tighten #signed-out', selection: null });
    const done = await ended(2);
    expect(done.map((run) => run.reply).sort()).toEqual([SIGNED_OUT_MESSAGE, 'API Error: the service is overloaded. Try again in a moment.'].sort());
    expect(done.every((run) => run.status === 'failed')).toBe(true);

    runs = [];
    fakeEnv.FAKE_AGENT_NO_RESULT = '1';
    fakeEnv.FAKE_AGENT_STDERR = 'Error: something went wrong';
    await service().start({ path: PLAN(), comment: 'Tighten', selection: null });
    expect((await ended())[0]).toMatchObject({ status: 'failed', reply: 'Error: something went wrong', sessionId: '3f2b8f0e-6a1d-4f53-8d6e-0c9a7b5e2d41' });
  });

  it('fails a run whose command cannot start', async () => {
    await allow();
    await writeFile(PLAN(), 'Plan\n');
    const agent = service({ spawn: (file, args, options) => spawnAgent(path.join(dir, 'gone'), args, options) });
    await agent.start({ path: PLAN(), comment: 'Tighten', selection: null });
    expect((await ended())[0]).toMatchObject({ status: 'failed', reply: expect.stringContaining('ENOENT') });
  });

  it('stops a run with SIGINT, and stops every run on quit', async () => {
    await allow();
    await writeFile(PLAN(), 'Plan\n');
    const agent = service();
    const one = await agent.start({ path: PLAN(), comment: 'Wait #slow', selection: null });
    const two = await agent.start({ path: PLAN(), comment: 'Wait too #slow', selection: null });
    // Both have read their prompt and are waiting.
    for (let waited = 0; (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').length < 2 && waited < 5000; waited += 20) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    agent.stop(one.id);
    expect((await ended())[0]).toMatchObject({ id: one.id, status: 'stopped', reply: '' });
    agent.stopAll();
    expect((await ended(2))[1]).toMatchObject({ id: two.id, status: 'stopped' });
  });
});

describe('AgentHandlers', () => {
  it('accepts only a well-formed start request', () => {
    const ok = { path: '/Vault/Plan.md', comment: 'Hi', selection: { from: 1, to: 2, text: 'a' } };
    expect(validCommentRequest(ok)).toBe(true);
    expect(validCommentRequest({ ...ok, selection: null })).toBe(true);
    expect(validCommentRequest({ ...ok, path: 'Plan.md' })).toBe(false);
    expect(validCommentRequest({ ...ok, comment: '   ' })).toBe(false);
    expect(validCommentRequest({ ...ok, selection: { from: 3, to: 2, text: 'a' } })).toBe(false);
    expect(validCommentRequest({ ...ok, selection: { from: 0, to: 2, text: 'a' } })).toBe(false);
    expect(validCommentRequest(null)).toBe(false);
  });

  it('answers each channel, refusing bad arguments without calling the service', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const agent = service();
    new AgentHandlers({ ipc: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler); } } as never, service: agent }).registerAll();
    expect([...handlers.keys()].sort()).toEqual(['agent:allow-folder', 'agent:readiness', 'agent:start', 'agent:stop']);
    expect(await handlers.get('agent:readiness')?.({}, 'relative.md')).toEqual({ success: false, error: 'Invalid comment request.' });
    expect(await handlers.get('agent:start')?.({}, { path: '/x.md' })).toEqual({ success: false, error: 'Invalid comment request.' });
    await writeFile(PLAN(), 'Plan\n');
    expect(await handlers.get('agent:readiness')?.({}, PLAN())).toEqual({ success: true, data: { state: 'ask', folder: 'Vault' } });
  });
});
