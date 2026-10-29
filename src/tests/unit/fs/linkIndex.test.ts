import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { LinkIndex, resolveLinkTarget } from '@/main/fs/LinkIndex';
import { PathNotAllowedError, RootRegistry } from '@/main/fs/RootRegistry';

describe('resolveLinkTarget', () => {
  const files = [
    '/Vault/Library/people/Robert Xu.md',
    '/Vault/Inbox/Robert Xu.md',
    '/Vault/Inbox/Logs/2026-10-28.md',
    '/Vault/Library/parametric/base-layout.png',
    '/Vault/Library/parametric/base-electronics/catalog.md',
    '/Vault/Archive/catalog.md',
    '/Vault/Archive/v1.2 notes.md',
    '/Vault/Library/Café.md',
  ];
  const from = '/Vault/Inbox/Logs/2026-10-28.md';

  it('finds a note by name, ignoring case and Unicode form, with or without .md', () => {
    expect(resolveLinkTarget('robert xu', '/Vault/Library/people/Ahmed.md', files)).toBe('/Vault/Library/people/Robert Xu.md');
    expect(resolveLinkTarget('2026-10-28.md', from, files)).toBe(from);
    expect(resolveLinkTarget('v1.2 notes', from, files)).toBe('/Vault/Archive/v1.2 notes.md');
    expect(resolveLinkTarget('Café', from, files)).toBe('/Vault/Library/Café.md');
    expect(resolveLinkTarget('base-layout.png', from, files)).toBe('/Vault/Library/parametric/base-layout.png');
  });

  it('prefers the linking note\'s folder, then the shortest path', () => {
    expect(resolveLinkTarget('Robert Xu', '/Vault/Inbox/today.md', files)).toBe('/Vault/Inbox/Robert Xu.md');
    expect(resolveLinkTarget('Robert Xu', '/Vault/Library/people/Ahmed.md', files)).toBe('/Vault/Library/people/Robert Xu.md');
    expect(resolveLinkTarget('catalog', from, files)).toBe('/Vault/Archive/catalog.md');
  });

  it('matches a path from the vault root or relative to the note, and nothing else', () => {
    expect(resolveLinkTarget('Library/people/Robert Xu', from, files)).toBe('/Vault/Library/people/Robert Xu.md');
    expect(resolveLinkTarget('base-electronics/catalog', from, files)).toBe('/Vault/Library/parametric/base-electronics/catalog.md');
    expect(resolveLinkTarget('../Robert Xu', from, files)).toBe('/Vault/Inbox/Robert Xu.md');
    expect(resolveLinkTarget('./catalog', from, files)).toBeNull();
    expect(resolveLinkTarget('Xu', from, files)).toBeNull();
    expect(resolveLinkTarget('  ', from, files)).toBeNull();
  });
});

describe('LinkIndex', () => {
  let tmp: string;
  let root: string;
  let registry: RootRegistry;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-links-'));
    await mkdir(path.join(tmp, 'Vault', 'People'), { recursive: true });
    await mkdir(path.join(tmp, 'Vault', '.obsidian'), { recursive: true });
    await writeFile(path.join(tmp, 'Vault', 'today.md'), '[[Robert Xu]]');
    await writeFile(path.join(tmp, 'Vault', 'People', 'Robert Xu.md'), '# Robert');
    await writeFile(path.join(tmp, 'Vault', '.obsidian', 'Hidden.md'), 'x');
    registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
    root = await registry.add(path.join(tmp, 'Vault'));
  });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('resolves across the opened roots and skips hidden folders', async () => {
    const links = new LinkIndex({ registry });
    expect(await links.resolve(path.join(root, 'today.md'), ['Robert Xu', 'Hidden', 'Nobody'])).toEqual({
      'Robert Xu': path.join(root, 'People', 'Robert Xu.md'),
      Hidden: null,
      Nobody: null,
    });
  });

  it('lists the folders the watcher reports again before the next lookup', async () => {
    const links = new LinkIndex({ registry });
    const today = path.join(root, 'today.md');
    expect(await links.resolve(today, ['Ahmed'])).toEqual({ Ahmed: null });
    await mkdir(path.join(root, 'People', 'New'));
    await writeFile(path.join(root, 'People', 'New', 'Ahmed.md'), '# Ahmed');
    expect(await links.resolve(today, ['Ahmed'])).toEqual({ Ahmed: null });
    links.invalidateDirectories([path.join(root, 'People')]);
    expect(await links.resolve(today, ['Ahmed'])).toEqual({ Ahmed: path.join(root, 'People', 'New', 'Ahmed.md') });
    await rm(path.join(root, 'People'), { recursive: true });
    links.invalidateDirectories([root]);
    expect(await links.resolve(today, ['Ahmed', 'Robert Xu'])).toEqual({ Ahmed: null, 'Robert Xu': null });
  });

  it('refuses to resolve for a page outside the opened roots', async () => {
    await writeFile(path.join(tmp, 'outside.md'), '');
    await expect(new LinkIndex({ registry }).resolve(path.join(tmp, 'outside.md'), ['Robert Xu'])).rejects.toThrow(PathNotAllowedError);
  });
});
