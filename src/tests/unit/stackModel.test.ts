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
  leadingHeading,
  readOnlyRule,
  sessionDetail,
  sessionLabel,
  stackKindForPath,
  transcriptName,
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

  it('lists the later and the earlier daily pages around the head, newest first, leaving out the head and other names', () => {
    const names = [
      '2026-10-27.md', '2026-10-29.md', '2026-10-30.md', '2026-09-01.md', 'notes.md', '2026-11-02.md',
      '2026-10-28.md', '2026-02-30.md', '2026-10-28 copy.md', '2026-10-26.txt', '2026-10-31.md',
    ];
    expect(dailyStreamNames(names, '2026-10-29')).toEqual({
      later: ['2026-11-02.md', '2026-10-31.md', '2026-10-30.md'],
      earlier: ['2026-10-28.md', '2026-10-27.md', '2026-09-01.md'],
    });
    // The limit keeps the days nearest the head on each side.
    expect(dailyStreamNames(names, '2026-10-29', 2)).toEqual({
      later: ['2026-10-31.md', '2026-10-30.md'],
      earlier: ['2026-10-28.md', '2026-10-27.md'],
    });
  });

  it('names a day Today, Yesterday, Tomorrow or by its weekday', () => {
    expect(dailyDetail('2026-10-29', '2026-10-29')).toBe('Today');
    expect(dailyDetail('2026-10-28', '2026-10-29')).toBe('Yesterday');
    expect(dailyDetail('2026-10-27', '2026-10-29')).toBe('Tuesday');
    expect(dailyDetail('2026-02-28', '2026-03-01')).toBe('Yesterday');
    expect(dailyDetail('2026-10-30', '2026-10-29')).toBe('Tomorrow');
    expect(dailyDetail('2026-11-01', '2026-10-31')).toBe('Tomorrow');
    expect(dailyDetail('2026-10-31', '2026-10-29')).toBe('Saturday');
  });

  it('treats a page with only frontmatter and whitespace as blank', () => {
    expect(isBlankPage('')).toBe(true);
    expect(isBlankPage('---\ndate: 2026-10-29\ntags:\n  - daily\n---\n\n  \n')).toBe(true);
    expect(isBlankPage('---\ndate: 2026-10-29\n---\n- [ ] ')).toBe(false);
    expect(isBlankPage('Hello')).toBe(false);
  });

  it('opens a recording summary and a thread card as stacks, and their transcripts and sessions alone', () => {
    expect(stackKindForPath('/Vault/Library/recordings/2026-10-26 0930 Josh x Lucas (Meet).md')).toBe('recording');
    expect(stackKindForPath('/Vault/Library/recordings/2026-10-22 1050 Operator Staffing.md')).toBe('recording');
    expect(stackKindForPath('/Vault/Library/recordings/transcripts/2026-10-26 0930 Josh x Lucas (Meet) transcript.md')).toBeNull();
    expect(stackKindForPath('/Vault/Library/recordings/README.md')).toBeNull();
    expect(stackKindForPath('/Vault/Inbox/Recordings/2026-10-20 1000 Standup (Meet).md')).toBeNull();
    expect(stackKindForPath('/Vault/Library/chats/sf-site-one.md')).toBe('chat');
    expect(stackKindForPath('/Vault/Library/chats/sf-site-one/2026-10-21-claude-f30001cd.md')).toBeNull();
    expect(isStackHead('recording', '/Vault/Library/recordings/2026-10-26 0930 Josh x Lucas (Meet).md')).toBe(true);
    expect(isStackHead('chat', '/Vault/Library/recordings/2026-10-26 0930 Josh x Lucas (Meet).md')).toBe(false);
    expect(transcriptName('2026-10-26 0930 Josh x Lucas (Meet).md')).toBe('2026-10-26 0930 Josh x Lucas (Meet) transcript.md');
    expect(transcriptName('2026-10-26 0930 Standup (Meet) 2.md')).toBe('2026-10-26 0930 Standup (Meet) 2 transcript.md');
  });

  it('finds the heading a page starts with, after its frontmatter and up to two blank lines', () => {
    expect(leadingHeading('---\nsource: meet\n---\n## Details\n\nNotes.')).toEqual({ level: 2, line: 0 });
    expect(leadingHeading('---\ntype: thread-transcript\n---\n\n# SF Site One · Claude · 2026-10-16\n')).toEqual({ level: 1, line: 1 });
    expect(leadingHeading('\n\n### Third line')).toEqual({ level: 3, line: 2 });
    expect(leadingHeading('\n\n\n# Too far down')).toBeNull();
    expect(leadingHeading('Some text first.\n# Heading')).toBeNull();
    expect(leadingHeading('#hashtag, not a heading')).toBeNull();
    expect(leadingHeading('')).toBeNull();
  });

  it('labels a session as the thread card lists it', () => {
    const fields = { tool: 'claude', started: '2026-10-21 09:14', last: '2026-10-28 13:14', prompts: 62 };
    expect(sessionLabel(fields, '2026-10-21-claude-f30001cd.md')).toBe('2026-10-21 · Claude');
    expect(sessionDetail(fields)).toBe('62 prompts · last active 2026-10-28 13:14');
    expect(sessionDetail({ prompts: 1 })).toBe('1 prompt');
    expect(sessionLabel({ tool: 'codex' }, '2026-10-20-codex-1.md')).toBe('2026-10-20 · Codex');
    expect(sessionLabel({}, 'loose-notes.md')).toBe('loose-notes');
    expect(sessionDetail({})).toBeNull();
  });

  it('shares one read-only rule with the editor', () => {
    expect(readOnlyRule('/Vault/Library/logs/2026-10-29 log.md')).toBe(true);
    expect(readOnlyRule('/Vault/Library/daily/2026-10-29.md')).toBe(false);
    expect(readOnlyRule('/Vault/Library/recordings/2026-10-29 0900 Standup.md')).toBe(false);
    // threads.py rewrites a chat's card and its sessions on every capture.
    expect(readOnlyRule('/Vault/Library/chats/sf-site-one.md')).toBe(true);
    expect(readOnlyRule('/Vault/Library/chats/sf-site-one/2026-10-21-claude-f30001cd.md')).toBe(true);
    expect(readOnlyRule('Library/chats/sf-site-one.md')).toBe(true);
    expect(readOnlyRule('/Vault/Library/chats/sf-site-one/notes/deeper.md')).toBe(false);
    expect(readOnlyRule('/Vault/Notes/Library chats.md')).toBe(false);
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

  it('lists later pages above the head, blank ones too, then earlier non-empty pages, newest first', async () => {
    const head = await put('Library/daily/2026-10-29.md', '---\ndate: 2026-10-29\n---\n');
    await put('Library/daily/2026-10-30.md', 'Tomorrow, written ahead.');
    // A page just made for a later day is blank, and shows.
    await put('Library/daily/2026-11-02.md', '---\ndate: 2026-11-02\n---\n');
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
      ['2026-11-02.md', '2026-11-02', 'Monday', 'part'],
      ['2026-10-30.md', '2026-10-30', 'Tomorrow', 'part'],
      ['2026-10-29.md', '2026-10-29', 'Today', 'head'],
      ['2026-10-28.md', '2026-10-28', 'Yesterday', 'part'],
      ['2026-10-20.md', '2026-10-20', 'Tuesday', 'part'],
    ]);
    expect(stack.sections.every((section) => section.defaultOpen && !section.readOnly)).toBe(true);
    expect(stack.sections[3].size).toBe('Yesterday.'.length);
  });

  it('starts a stream from an earlier day with the days after it above, today shown even when blank', async () => {
    await put('Library/daily/2026-10-29.md', '');
    await put('Library/daily/2026-10-27.md', '');
    const head = await put('Library/daily/2026-10-26.md', 'Monday.');
    await put('Library/daily/2026-10-25.md', 'Before.');
    const stack = await service.stack(root, 'daily', head);
    expect(stack.sections.map((section) => [section.label, section.role])).toEqual([
      ['2026-10-29', 'part'],
      ['2026-10-26', 'head'],
      ['2026-10-25', 'part'],
    ]);
    expect(stack.sections[1].detail).toBe('Monday');
  });

  it('notices a past page that gains a body', async () => {
    const head = await put('Library/daily/2026-10-29.md', '');
    await put('Library/daily/2026-10-28.md', '');
    expect((await service.stack(root, 'daily', head)).sections).toHaveLength(1);
    await put('Library/daily/2026-10-28.md', 'Written on another Mac.');
    expect((await service.stack(root, 'daily', head)).sections.map((section) => section.label)).toEqual(['2026-10-29', '2026-10-28']);
  });

  const meet = (stem: string) => `---\nsource: meet\ntitle: "${stem}"\n---\n# ${stem}\n\n## Summary\n\nShort.\n`;

  it('lists a recording summary, then its transcript, open by default', async () => {
    const stem = '2026-10-26 0930 Josh x Lucas (Meet)';
    const head = await put(`Library/recordings/${stem}.md`, meet(stem));
    const transcript = await put(`Library/recordings/transcripts/${stem} transcript.md`, '---\nsource: meet\n---\n## Details\n\nNotes.\n\n## Transcript\n\nHello.\n');
    const stack = await service.stack(root, 'recording', head);
    expect(stack.kind).toBe('recording');
    expect(stack.folders).toEqual([path.join(root, 'Library/recordings'), path.join(root, 'Library/recordings/transcripts')]);
    expect(stack.sections.map((section) => [section.path, section.label, section.role, section.defaultOpen, section.readOnly, section.textHeading])).toEqual([
      [head, stem, 'head', true, false, null],
      [transcript, 'Transcript', 'part', true, false, { level: 2, line: 0 }],
    ]);
  });

  it('shows a recording not split yet alone, and never follows a linked transcript', async () => {
    const stem = '2026-10-20 1604 Deployment Synch (Meet)';
    const head = await put(`Library/recordings/${stem}.md`, `${meet(stem)}\n## Transcript\n\nHello.\n`);
    expect((await service.stack(root, 'recording', head)).sections.map((section) => section.path)).toEqual([head]);
    const real = await put(`Elsewhere/${stem} transcript.md`, '## Transcript\n');
    await mkdir(path.join(root, 'Library/recordings/transcripts'));
    await symlink(real, path.join(root, `Library/recordings/transcripts/${stem} transcript.md`));
    expect((await service.stack(root, 'recording', head)).sections).toHaveLength(1);
    const deeper = await put(`Library/recordings/old/${stem}.md`, meet(stem));
    await expect(service.stack(root, 'recording', deeper)).rejects.toThrow('does not start a stack');
  });

  const session = (started: string, last: string, prompts: number) =>
    `---\ntype: thread-transcript\ntool: claude\nstarted: "${started}"\nlast: "${last}"\nprompts: ${prompts}\n---\n\n# SF Site One · Claude · ${started.slice(0, 10)}\n\nText.\n`;

  it('lists a thread card, then its sessions newest first, only the newest open', async () => {
    const head = await put('Library/chats/sf-site-one.md', '---\ntype: thread\ntitle: SF Site One\n---\n\n# SF Site One\n');
    const older = await put('Library/chats/sf-site-one/2026-10-16-claude-1486ab75.md', session('2026-10-16 16:25', '2026-10-19 15:57', 16));
    const newer = await put('Library/chats/sf-site-one/2026-10-21-claude-f30001cd.md', session('2026-10-21 09:14', '2026-10-28 13:14', 62));
    const sameDay = await put('Library/chats/sf-site-one/2026-10-21-codex-0a.md', session('2026-10-21 18:00', '2026-10-21 18:30', 1).replace('tool: claude', 'tool: codex'));
    await put('Library/chats/sf-site-one/notes.txt', 'Not a session.');
    await mkdir(path.join(root, 'Library/chats/sf-site-one/attachments'));
    const stack = await service.stack(root, 'chat', head);
    expect(stack.folders).toEqual([path.join(root, 'Library/chats'), path.join(root, 'Library/chats/sf-site-one')]);
    expect(stack.sections.map((section) => [section.path, section.label, section.detail, section.role, section.defaultOpen])).toEqual([
      [head, 'sf-site-one', null, 'head', true],
      [sameDay, '2026-10-21 · Codex', '1 prompt · last active 2026-10-21 18:30', 'part', true],
      [newer, '2026-10-21 · Claude', '62 prompts · last active 2026-10-28 13:14', 'part', false],
      [older, '2026-10-16 · Claude', '16 prompts · last active 2026-10-19 15:57', 'part', false],
    ]);
    expect(stack.sections[1].textHeading).toEqual({ level: 1, line: 1 });
    // threads.py rewrites the card and every session, so all of them read as read-only.
    expect(stack.sections.every((section) => section.readOnly)).toBe(true);
  });

  it('shows a card that is not a thread alone, and a thread with no sessions folder alone', async () => {
    const note = await put('Library/chats/notes.md', '# Notes\n');
    await put('Library/chats/notes/2026-10-21-claude-1.md', session('2026-10-21 09:14', '2026-10-21 10:00', 2));
    expect((await service.stack(root, 'chat', note)).sections.map((section) => section.path)).toEqual([note]);
    const lonely = await put('Library/chats/lonely.md', '---\ntype: thread\n---\n# Lonely\n');
    expect((await service.stack(root, 'chat', lonely)).sections.map((section) => section.path)).toEqual([lonely]);
  });

  it('refuses heads that do not start a stack, folders it did not open, and links', async () => {
    const note = await put('Notes/2026-10-29.md', 'Not daily.');
    await expect(service.stack(root, 'daily', note)).rejects.toThrow('does not start a stack');
    await expect(service.stack(root, 'daily', 'Library/daily/2026-10-29.md')).rejects.toThrow();
    await expect(service.stack(path.join(temporary, 'elsewhere'), 'daily', note)).rejects.toThrow();
    await expect(service.stack(root, 'recording', note)).rejects.toThrow();
    await expect(service.stack(root, 'chat', note)).rejects.toThrow();
    const real = await put('Elsewhere/2026-10-29.md', 'Outside.');
    await mkdir(path.join(root, 'Library'), { recursive: true });
    await symlink(path.dirname(real), path.join(root, 'Library/daily'));
    await expect(service.stack(root, 'daily', path.join(root, 'Library/daily/2026-10-29.md'))).rejects.toThrow(/Symlinks/);
  });
});
