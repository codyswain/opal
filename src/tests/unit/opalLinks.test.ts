// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { opalLinkPath } from '@/common/opalLink';
import { RootRegistry } from '@/main/fs/RootRegistry';
import { OPEN_PAGE_CHANNEL, OpalLinks, type LinkReceiver } from '@/main/protocol/OpalLinks';

describe('opalLinkPath', () => {
  it('reads the path from opal://open and nothing else', () => {
    expect(opalLinkPath('opal://open?path=Library/a%20b.md')).toBe('Library/a b.md');
    expect(opalLinkPath('opal://open/?path=%2FUsers%2Fcody%2Fa.md')).toBe('/Users/cody/a.md');
    expect(opalLinkPath('opal://open?path=a%2Bb.md')).toBe('a+b.md');
    expect(opalLinkPath('opal://open?path=')).toBeNull();
    expect(opalLinkPath('opal://open')).toBeNull();
    expect(opalLinkPath('opal://delete?path=a.md')).toBeNull();
    expect(opalLinkPath('opal://open/extra?path=a.md')).toBeNull();
    expect(opalLinkPath('obsidian://open?path=a.md')).toBeNull();
    expect(opalLinkPath('not a url')).toBeNull();
  });
});

describe('OpalLinks', () => {
  let temporary: string, vault: string, other: string, links: OpalLinks;
  const vaults = vi.fn<() => Promise<string[]>>();
  const link = (target: string) => `opal://open?path=${encodeURIComponent(target)}`;
  const receiver = () => {
    let destroyed = false;
    return {
      send: vi.fn<LinkReceiver['send']>(),
      isDestroyed: () => destroyed,
      destroy: () => {
        destroyed = true;
      },
    };
  };

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-links-'));
    const registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    await mkdir(path.join(temporary, 'vault/Library/notes'), { recursive: true });
    await writeFile(path.join(temporary, 'vault/Library/notes/a b.md'), '# A\n');
    await mkdir(path.join(temporary, 'outside'));
    await writeFile(path.join(temporary, 'outside/secret.md'), 'no\n');
    vault = await registry.add(path.join(temporary, 'vault'));
    other = path.join(temporary, 'outside');
    vaults.mockResolvedValue([vault]);
    links = new OpalLinks({ registry, vaults });
  });
  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it('opens a vault-relative or absolute path inside an opened folder', async () => {
    const file = path.join(vault, 'Library/notes/a b.md');
    expect(await links.request(link('Library/notes/a b.md'))).toEqual({ path: file });
    expect(await links.request(link(file))).toEqual({ path: file });
  });

  it('refuses folders, missing files and anything outside the opened folders', async () => {
    expect(await links.request(link('Library/notes'))).toEqual({
      error: 'Library/notes is a folder, not a file.',
    });
    expect(await links.request(link('Library/missing.md'))).toHaveProperty('error');
    expect(await links.request(link('../outside/secret.md'))).toHaveProperty('error');
    expect(await links.request(link(path.join(other, 'secret.md')))).toHaveProperty('error');
    expect(await links.request('opal://open')).toHaveProperty('error');
    vaults.mockResolvedValue([]);
    expect(await links.request(link('Library/notes/a b.md'))).toEqual({
      error: "No opened folder is a vault, so Opal can't open Library/notes/a b.md.",
    });
  });

  it('holds links until a renderer listens, and again after it goes away', async () => {
    const file = path.join(vault, 'Library/notes/a b.md');
    links.receive(link('Library/notes/a b.md'));
    const first = receiver();
    links.attach(first);
    await vi.waitFor(() =>
      expect(first.send).toHaveBeenCalledWith(OPEN_PAGE_CHANNEL, { path: file }),
    );

    links.detach(first);
    links.receive(link(file));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(first.send).toHaveBeenCalledTimes(1);

    const second = receiver();
    links.attach(second);
    await vi.waitFor(() => expect(second.send).toHaveBeenCalledTimes(1));

    second.destroy();
    links.receive(link(file));
    const third = receiver();
    links.attach(third);
    await vi.waitFor(() => expect(third.send).toHaveBeenCalledTimes(1));
    expect(second.send).toHaveBeenCalledTimes(1);
  });
});
