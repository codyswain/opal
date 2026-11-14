import { pathFromShellOutput, shellPathArgs } from './agentModel';

/**
 * The login shell's PATH. An app started from the Dock gets a minimal PATH,
 * so the command and the folder's hooks would not find their tools. Only a
 * real answer is kept. A shell that fails, takes longer than the timeout or
 * prints no PATH gives Opal's own PATH for that call, and the next call asks
 * the shell again.
 */
export function loginShellPath(deps: {
  shell: string | undefined;
  fallback: string;
  run: (file: string, args: string[], timeoutMs: number) => Promise<string>;
  timeoutMs?: number;
}): () => Promise<string> {
  let found: string | null = null;
  let asking: Promise<string | null> | null = null;
  return async () => {
    if (found !== null) return found;
    asking ??= (async () => {
      const shell = deps.shell && deps.shell.startsWith('/') ? deps.shell : '/bin/zsh';
      try {
        return pathFromShellOutput(await deps.run(shell, shellPathArgs(), deps.timeoutMs ?? 5000));
      } catch {
        return null;
      } finally {
        asking = null;
      }
    })();
    const answer = await asking;
    if (answer !== null) found = answer;
    return answer ?? deps.fallback;
  };
}
