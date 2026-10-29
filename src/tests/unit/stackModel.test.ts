// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

vi.mock('@/main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { RootRegistry } from '@/main/fs/RootRegistry';
import { StackService } from '@/main/vault/StackService';
import {
  dailyDetail,
  dailyHeadDate,
  dailyStreamNames,
  isBlankPage,
  isStackHead,
  readOnlyRule,
  stackKindForPath,
} from '@/common/stackModel';

describe('stack model', () => {
  it('knows daily heads by path, and never upgrades a daily page opened alone', () => {
    expect(dailyHeadDate('/Vault/Library/daily/2026-10-29.md')).toBe('2026-10-29');
    expect(dailyHeadDate('Library/daily/2026-10-29.md')).toBe('2026-10-29');
    expect(dailyHeadDate('/Vault/Library/daily/2026-02-30.md')).toBeNull();
    expect(dailyHeadDate('/Vault/Library/daily/old/2026-10-29.md')).toBeNull();
    expect(dailyHeadDate('/Vault/Inbox/Logs/2026-10-29.md')).toBeNull();
    expect(isStackHead('daily', '/Vault/Library/daily/2026-10-29.md')).toBe(true);
    expect(isStackHead('daily', '/Vault/Notes/2026-10-29.md')).toBe(false);
    expect(stackKindForPath('/Vault/Library/daily/2026-10-29.md')).toBeNull();
    expect(stackKindForPath('/Vault/Notes/brief.md')).toBeNull();
  });

  it('lists earlier daily pages newest first, leaving out the head, later days and other names', () => {
    const names = [
      '2026-10-27.md', '2026-10-29.md', '2026-10-30.md', '2026-09-01.md', 'notes.md',
      '2026-10-28.md', '2026-02-30.md', '2026-10-28 copy.md', '2026-10-26.txt',
    ];
    expect(dailyStreamNames(names, '2026-10-29')).toEqual(['2026-10-28.md', '2026-10-27.md', '2026-09-01.md']);
    expect(dailyStreamNames(names, '2026-10-29', 2)).toEqual(['2026-10-28.md', '2026-10-27.md']);
  });

  it('names a day Today, Yesterday or by its weekday', () => {
    expect(dailyDetail('2026-10-29', '2026-10-29')).toBe('Today');
    expect(dailyDetail('2026-10-28', '2026-10-29')).toBe('Yesterday');
    expect(dailyDetail('2026-10-27', '2026-10-29')).toBe('Tuesday');
    expect(dailyDetail('2026-02-28', '2026-03-01')).toBe('Yesterday');
  });

  it('treats a page with only frontmatter and whitespace as blank', () => {
    expect(isBlankPage('')).toBe(true);
    expect(isBlankPage('---\ndate: 2026-10-29\ntags:\n  - daily\n---\n\n  \n')).toBe(true);
    expect(isBlankPage('---\ndate: 2026-10-29\n---\n- [ ] ')).toBe(false);
    expect(isBlankPage('Hello')).toBe(false);
  });

  it('shares one read-only rule with the editor', () => {
    expect(readOnlyRule('/Vault/Library/logs/2026-10-29 log.md')).toBe(true);
    expect(readOnlyRule('/Vault/Library/daily/2026-10-29.md')).toBe(false);
    expect(readOnlyRule('/Vault/Library/recordings/2026-10-29 0900 Standup.md')).toBe(false);
  });
});

describe('StackService', () => {
  let temporary: string;
  let root: string;
  let registry: RootRegistry;
  let service: StackService;

  const put = async (relative: string, text: string) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
    return file;
  };

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-stack-'));
    root = path.join(temporary, 'Vault');
    await mkdir(root);
    registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    root = await registry.add(root);
    service = new StackService({ registry, today: () => '2026-10-29' });
  });

  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it('lists the head, then earlier non-empty daily pages newest first', async () => {
    const head = await put('Library/daily/2026-10-29.md', '---\ndate: 2026-10-29\n---\n');
    await put('Library/daily/2026-10-30.md', 'Tomorrow, written ahead.');
    await put('Library/daily/2026-10-28.md', 'Yesterday.');
    await put('Library/daily/2026-10-27.md', '---\ndate: 2026-10-27\n---\n\n');
    await put('Library/daily/2026-10-20.md', '- [ ] Something');
    await put('Library/daily/notes.md', 'Not a day.');
    await mkdir(path.join(root, 'Library/daily/2026-10-19.md'));
    const stack = await service.stack(root, 'daily', head);
    expect(stack.kind).toBe('daily');
    expect(stack.head).toBe(head);
    expect(stack.folders).toEqual([path.join(root, 'Library/daily')]);
    expect(stack.sections.map((section) => [path.basename(section.path), section.label, section.detail, section.role])).toEqual([
      ['2026-10-29.md', '2026-10-29', 'Today', 'head'],
      ['2026-10-28.md', '2026-10-28', 'Yesterday', 'part'],
      ['2026-10-20.md', '2026-10-20', 'Tuesday', 'part'],
    ]);
    expect(stack.sections.every((section) => section.defaultOpen && !section.readOnly)).toBe(true);
    expect(stack.sections[1].size).toBe('Yesterday.'.length);
  });

  it('starts a stream from an earlier day, leaving out the days after it', async () => {
    await put('Library/daily/2026-10-29.md', 'Today.');
    const head = await put('Library/daily/2026-10-28.md', 'Yesterday.');
    await put('Library/daily/2026-10-27.md', 'Before.');
    const stack = await service.stack(root, 'daily', head);
    expect(stack.sections.map((section) => section.label)).toEqual(['2026-10-28', '2026-10-27']);
    expect(stack.sections[0].detail).toBe('Yesterday');
  });

  it('notices a past page that gains a body', async () => {
    const head = await put('Library/daily/2026-10-29.md', '');
    await put('Library/daily/2026-10-28.md', '');
    expect((await service.stack(root, 'daily', head)).sections).toHaveLength(1);
    await put('Library/daily/2026-10-28.md', 'Written on another Mac.');
    expect((await service.stack(root, 'daily', head)).sections.map((section) => section.label)).toEqual(['2026-10-29', '2026-10-28']);
  });

  it('refuses heads that do not start a stack, folders it did not open, and links', async () => {
    const note = await put('Notes/2026-10-29.md', 'Not daily.');
    await expect(service.stack(root, 'daily', note)).rejects.toThrow('does not start a stack');
    await expect(service.stack(root, 'daily', 'Library/daily/2026-10-29.md')).rejects.toThrow();
    await expect(service.stack(path.join(temporary, 'elsewhere'), 'daily', note)).rejects.toThrow();
    await expect(service.stack(root, 'recording', note)).rejects.toThrow();
    const real = await put('Elsewhere/2026-10-29.md', 'Outside.');
    await mkdir(path.join(root, 'Library'), { recursive: true });
    await symlink(path.dirname(real), path.join(root, 'Library/daily'));
    await expect(service.stack(root, 'daily', path.join(root, 'Library/daily/2026-10-29.md'))).rejects.toThrow(/Symlinks/);
  });
});
