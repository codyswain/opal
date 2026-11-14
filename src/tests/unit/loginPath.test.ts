import { describe, expect, it, vi } from 'vitest';
import { loginShellPath } from '@/main/agent/loginPath';

describe('loginShellPath', () => {
  it('asks the login shell once, with a timeout, and reads the PATH between the markers', async () => {
    const run = vi.fn(async () => 'Last login: today\n__OPAL_PATH__/opt/homebrew/bin:/usr/bin__OPAL_PATH__');
    const read = loginShellPath({ shell: '/bin/zsh', fallback: '/usr/bin', run });
    expect(await read()).toBe('/opt/homebrew/bin:/usr/bin');
    expect(await read()).toBe('/opt/homebrew/bin:/usr/bin');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]).toEqual(['/bin/zsh', ['-ilc', expect.stringContaining('$PATH')], 5000]);
  });

  it('does not keep a fallback: the next call asks the shell again, and keeps the first real answer', async () => {
    const answers = [
      async () => { throw new Error('timed out'); },
      async () => 'no markers',
      async () => '__OPAL_PATH__/opt/homebrew/bin:/usr/bin__OPAL_PATH__',
    ];
    let calls = 0;
    const run = vi.fn(async (): Promise<string> => answers[calls++]());
    const read = loginShellPath({ shell: '/bin/zsh', fallback: '/usr/bin', run });
    expect(await read()).toBe('/usr/bin');
    expect(await read()).toBe('/usr/bin');
    expect(await read()).toBe('/opt/homebrew/bin:/usr/bin');
    expect(await read()).toBe('/opt/homebrew/bin:/usr/bin');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('asks the shell once for calls made while it is answering', async () => {
    let answer: (text: string) => void = () => undefined;
    const run = vi.fn(() => new Promise<string>((resolve) => { answer = resolve; }));
    const read = loginShellPath({ shell: '/bin/zsh', fallback: '/usr/bin', run });
    const both = Promise.all([read(), read()]);
    answer('__OPAL_PATH__/bin__OPAL_PATH__');
    expect(await both).toEqual(['/bin', '/bin']);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('gives Opal\'s own PATH when the shell fails, times out or prints no markers', async () => {
    expect(await loginShellPath({ shell: '/bin/zsh', fallback: '/usr/bin', run: async () => { throw new Error('timed out'); } })()).toBe('/usr/bin');
    expect(await loginShellPath({ shell: undefined, fallback: '/usr/bin', run: async () => 'nothing' })()).toBe('/usr/bin');
    const shells: string[] = [];
    await loginShellPath({ shell: 'zsh', fallback: '/usr/bin', run: async (file) => { shells.push(file); return ''; } })();
    expect(shells).toEqual(['/bin/zsh']);
  });
});
