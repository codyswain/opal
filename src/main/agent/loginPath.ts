import { pathFromShellOutput, shellPathArgs } from './agentModel';

/**
 * The login shell's PATH, read once. An app started from the Dock gets a
 * minimal PATH, so the command and the folder's hooks would not find their
 * tools. A shell that fails or takes longer than the timeout leaves Opal's
 * own PATH.
 */
export function loginShellPath(deps: {
  shell: string | undefined;
  fallback: string;
  run: (file: string, args: string[], timeoutMs: number) => Promise<string>;
  timeoutMs?: number;
}): () => Promise<string> {
  let found: Promise<string> | null = null;
  return () => {
    found ??= (async () => {
      const shell = deps.shell && deps.shell.startsWith('/') ? deps.shell : '/bin/zsh';
      try {
        return pathFromShellOutput(await deps.run(shell, shellPathArgs(), deps.timeoutMs ?? 5000)) ?? deps.fallback;
      } catch {
        return deps.fallback;
      }
    })();
    return found;
  };
}
