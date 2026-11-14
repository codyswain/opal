import { execFile, spawn } from 'child_process';
import type { AgentRunFile, AgentSpawn } from './AgentService';

/** Starts the command with pipes and no shell. */
export const spawnAgent: AgentSpawn = (file, args, options) =>
  spawn(file, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });

/**
 * Runs the command to its end. `auth status` exits 1 when signed out and
 * still prints its answer, so the output counts whatever the exit code; only
 * a command that could not start at all rejects.
 */
export const runAgentFile: AgentRunFile = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { env: options.env, timeout: options.timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      const text = String(stdout ?? '');
      if (error && !text && typeof (error as NodeJS.ErrnoException).code === 'string') reject(error);
      else resolve({ stdout: text });
    });
  });
