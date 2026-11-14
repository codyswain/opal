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

  it('keeps Opal\'s own PATH when the shell fails, times out or prints no markers', async () => {
    expect(await loginShellPath({ shell: '/bin/zsh', fallback: '/usr/bin', run: async () => { throw new Error('timed out'); } })()).toBe('/usr/bin');
    expect(await loginShellPath({ shell: undefined, fallback: '/usr/bin', run: async () => 'nothing' })()).toBe('/usr/bin');
    const shells: string[] = [];
    await loginShellPath({ shell: 'zsh', fallback: '/usr/bin', run: async (file) => { shells.push(file); return ''; } })();
    expect(shells).toEqual(['/bin/zsh']);
  });
});
