// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

vi.mock('@/main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  CannotPromptError,
  HiddenFiles,
  HiddenPathError,
  PROMPT_REASON,
  cleanEntry,
  hiddenBy,
  parseHidden,
} from '@/main/fs/HiddenFiles';
import { RootRegistry } from '@/main/fs/RootRegistry';
import { FileWriter } from '@/main/fs/FileWriter';
import { touchIdPrompt, NO_TOUCH_ID } from '@/main/fs/touchId';
import { touchIdStub } from '@/main/testProfile';

describe('the path rule', () => {
  it('hides an entry and everything under a folder entry, ignoring case and Unicode form', () => {
    const entries = ['Notes/Private.md', 'Photos/private'];
    expect(hiddenBy(entries, 'Notes/Private.md')).toBe(true);
    expect(hiddenBy(entries, 'notes/private.md')).toBe(true);
    expect(hiddenBy(entries, 'Photos/private/report.pdf')).toBe(true);
    expect(hiddenBy(entries, 'Photos/private')).toBe(true);
    expect(hiddenBy(entries, 'Photos/private-trip/a.jpg')).toBe(false);
    expect(hiddenBy(entries, 'Notes/Private.md.bak')).toBe(false);
    expect(hiddenBy(entries, 'Notes')).toBe(false);
    expect(hiddenBy(['Notes/Café.md'], 'Notes/Café.md')).toBe(true);
  });

  it('reads only clean paths from the folder top out of a version 1 file', () => {
    expect(parseHidden('not json')).toEqual([]);
    expect(parseHidden(JSON.stringify({ version: 2, hidden: ['a.md'] }))).toEqual([]);
    expect(parseHidden(JSON.stringify({ version: 1, hidden: ['a.md', 'A.md', '/abs.md', '../out.md', 'b\\c', 'Photos/private/', 7] })))
      .toEqual(['a.md', 'Photos/private']);
    expect(cleanEntry('./Notes//x.md')).toBe('Notes/x.md');
    expect(cleanEntry('..')).toBeNull();
  });
});

describe('HiddenFiles', () => {
  let temporary: string, root: string, other: string, registry: RootRegistry, hidden: HiddenFiles;
  let prompt: ReturnType<typeof vi.fn<(reason: string) => Promise<void>>>;
  let canPrompt: { ok: boolean; reason?: string };
  let changes: Array<{ shown: boolean; directories: string[] }>;
  const file = (base = root) => path.join(base, '.opal/hidden.json');
  const put = async (relative: string, text = 'x\n', base = root) => {
    const target = path.join(base, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
    return target;
  };
  const stored = async (base = root) => JSON.parse(await readFile(file(base), 'utf8')).hidden;

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-hidden-'));
    registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    await mkdir(path.join(temporary, 'vault'));
    await mkdir(path.join(temporary, 'other'));
    root = await registry.add(path.join(temporary, 'vault'));
    other = await registry.add(path.join(temporary, 'other'));
    await put('Notes/Private.md', 'secret\n');
    await put('Notes/Index.md');
    await put('Photos/private/report.pdf');
    prompt = vi.fn(async () => undefined);
    canPrompt = { ok: true };
    changes = [];
    hidden = new HiddenFiles({
      roots: () => registry.list(),
      prompt,
      canPrompt: () => canPrompt,
      onChanged: (change) => changes.push(change),
    });
    registry.setHidden(hidden);
  });
  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it('starts hidden, and the registry refuses a hidden path and anything in a hidden folder', async () => {
    await put('.opal/hidden.json', JSON.stringify({ version: 1, hidden: ['Notes/Private.md', 'Photos/private'] }));
    expect(hidden.isShown()).toBe(false);
    await expect(registry.assertAllowed(path.join(root, 'Notes/Private.md'))).rejects.toBeInstanceOf(HiddenPathError);
    await expect(registry.assertAllowed(path.join(root, 'Photos/private/report.pdf'))).rejects.toThrow('This file is hidden.');
    await expect(registry.assertAllowed(path.join(root, 'Notes/Index.md'))).resolves.toBe(path.join(root, 'Notes/Index.md'));
    // The readers that filter what they hand out see everything.
    await expect(registry.seeingHidden().assertAllowed(path.join(root, 'Notes/Private.md'))).resolves.toBe(path.join(root, 'Notes/Private.md'));
    expect((await registry.seeingHidden().blocked())(path.join(root, 'Notes/Private.md'))).toBe(false);
    expect((await registry.blocked())(path.join(root, 'Notes/Private.md'))).toBe(true);
  });

  it('shows hidden files only after the prompt passes, and hides them with no prompt', async () => {
    await hidden.add(path.join(root, 'Notes/Private.md'));
    await hidden.show();
    expect(prompt).toHaveBeenCalledWith(PROMPT_REASON);
    expect(hidden.isShown()).toBe(true);
    await expect(registry.assertAllowed(path.join(root, 'Notes/Private.md'))).resolves.toBeTruthy();
    expect(changes.at(-1)).toMatchObject({ shown: true });
    expect(changes.at(-1)?.directories).toContain(path.join(root, 'Notes'));
    await hidden.hide();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(hidden.isShown()).toBe(false);
    await expect(registry.assertAllowed(path.join(root, 'Notes/Private.md'))).rejects.toBeInstanceOf(HiddenPathError);
  });

  it('changes nothing when the prompt fails or the Mac cannot ask', async () => {
    prompt.mockRejectedValueOnce(new Error('Canceled by user.'));
    await expect(hidden.show()).rejects.toThrow('Canceled by user.');
    expect(hidden.isShown()).toBe(false);
    canPrompt = { ok: false, reason: NO_TOUCH_ID };
    await expect(hidden.show()).rejects.toBeInstanceOf(CannotPromptError);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(hidden.isShown()).toBe(false);
    expect(changes).toEqual([]);
  });

  it('writes the list, keeping what another Mac added since it was read', async () => {
    await hidden.add(path.join(root, 'Notes/Private.md'));
    expect(await stored()).toEqual(['Notes/Private.md']);
    // A pull brings an entry from another Mac; Opal has not read it.
    await writeFile(file(), JSON.stringify({ version: 1, hidden: ['Notes/Private.md', 'Notes/Pulled.md'] }));
    await hidden.add(path.join(root, 'Photos/private'));
    expect(await stored()).toEqual(['Notes/Private.md', 'Notes/Pulled.md', 'Photos/private']);
    // Something already under a hidden folder adds nothing.
    await hidden.add(path.join(root, 'Photos/private/report.pdf'));
    expect(await stored()).toEqual(['Notes/Private.md', 'Notes/Pulled.md', 'Photos/private']);
    await hidden.remove(path.join(root, 'Notes/Private.md'));
    expect(await stored()).toEqual(['Notes/Pulled.md', 'Photos/private']);
    await expect(hidden.remove(path.join(root, 'Photos/private/report.pdf'))).rejects.toThrow('A folder above it is hidden.');
    await expect(hidden.add(root)).rejects.toThrow('inside an opened folder');
  });

  it('reads a hand edit or a pull when the watcher reports the .opal folder', async () => {
    expect((await registry.blocked())(path.join(root, 'Notes/Private.md'))).toBe(false);
    await put('.opal/hidden.json', JSON.stringify({ version: 1, hidden: ['Notes/Private.md'] }));
    await hidden.changed([path.join(root, '.opal')]);
    expect((await registry.blocked())(path.join(root, 'Notes/Private.md'))).toBe(true);
    expect(changes.at(-1)?.directories).toContain(path.join(root, 'Notes'));
  });

  describe('follows Opal file actions', () => {
    let writer: FileWriter;
    beforeEach(async () => {
      writer = new FileWriter({ registry, hidden, trashItem: vi.fn(async () => undefined) });
      await hidden.add(path.join(root, 'Notes/Private.md'));
      await hidden.add(path.join(root, 'Photos/private'));
      await hidden.show();
    });

    it('keeps an entry on a renamed file and on a renamed folder above it', async () => {
      await writer.rename(path.join(root, 'Notes/Private.md'), 'Secret.md');
      expect(await stored()).toEqual(['Notes/Secret.md', 'Photos/private']);
      await writer.rename(path.join(root, 'Photos'), 'Pictures');
      expect(await stored()).toEqual(['Notes/Secret.md', 'Pictures/private']);
    });

    it('keeps an entry on a moved file, into another opened folder too', async () => {
      await mkdir(path.join(root, 'Archive'));
      await writer.move(path.join(root, 'Notes/Private.md'), path.join(root, 'Archive'));
      expect(await stored()).toEqual(['Archive/Private.md', 'Photos/private']);
      await writer.move(path.join(root, 'Photos/private'), other);
      expect(await stored()).toEqual(['Archive/Private.md']);
      expect(await stored(other)).toEqual(['private']);
    });

    it('drops the entries at or under a path moved to the Trash', async () => {
      await writer.moveToTrash(path.join(root, 'Photos'));
      expect(await stored()).toEqual(['Notes/Private.md']);
    });
  });
});

describe('the Touch ID prompt', () => {
  it('uses the system prompt, and stays hidden with a reason on a Mac that cannot ask', async () => {
    const system = { canPromptTouchID: vi.fn(() => false), promptTouchID: vi.fn(async () => undefined) };
    const touchId = touchIdPrompt(system, null);
    expect(touchId.canPrompt()).toEqual({ ok: false, reason: NO_TOUCH_ID });
    system.canPromptTouchID.mockReturnValue(true);
    expect(touchId.canPrompt()).toEqual({ ok: true });
    await touchId.prompt(PROMPT_REASON);
    expect(system.promptTouchID).toHaveBeenCalledWith('show hidden files');
    expect(touchIdPrompt({}, null).canPrompt().ok).toBe(false);
  });

  it('honours a test stub only in an unpackaged run under the test profile', () => {
    const env = { OPAL_TEST_USER_DATA_DIR: '/tmp/profile', OPAL_TEST_TOUCH_ID: 'pass' };
    expect(touchIdStub(env, false)).toBe('pass');
    expect(touchIdStub(env, true)).toBeNull();
    expect(touchIdStub({ OPAL_TEST_TOUCH_ID: 'pass' }, false)).toBeNull();
    expect(touchIdStub({ ...env, OPAL_TEST_TOUCH_ID: 'yes' }, false)).toBeNull();
  });

  it('a stub can pass, fail or have no Touch ID', async () => {
    await expect(touchIdPrompt({}, 'pass').prompt(PROMPT_REASON)).resolves.toBeUndefined();
    await expect(touchIdPrompt({}, 'fail').prompt(PROMPT_REASON)).rejects.toThrow();
    expect(touchIdPrompt({}, 'none').canPrompt().ok).toBe(false);
  });
});
