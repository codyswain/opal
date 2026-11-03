import { describe, expect, it } from 'vitest';
import { formatShortcut, rankCommands, scoreCommand } from '@/renderer/features/commands/services/matchCommand';
import type { Command } from '@/renderer/features/commands/services/commandRegistry';

const command = (name: string, keywords: string[] = []): Command => ({ id: name, name, type: 'action', keywords, perform: () => undefined });

describe('command matching', () => {
  it('prefers prefix, then word start, substring, keyword, then subsequence', () => {
    expect(scoreCommand(command('New Note'), 'new')).toBe(100);
    expect(scoreCommand(command('Go to Chat'), 'chat')).toBe(80);
    expect(scoreCommand(command('Toggle Sidebar'), 'ideb')).toBe(60);
    expect(scoreCommand(command('Settings…', ['preferences']), 'pref')).toBe(40);
    expect(scoreCommand(command('Reopen Closed Tab'), 'rct')).toBe(20);
    expect(scoreCommand(command('Go to Files'), 'zzz')).toBe(0);
    expect(scoreCommand(command('Anything'), '')).toBe(1);
  });

  it('ranks, drops non-matches, and caps the list', () => {
    const commands = [command('Toggle Sidebar'), command('New Note'), command('New View'), command('Go to Chat')];
    expect(rankCommands(commands, 'new').map((c) => c.name)).toEqual(['New Note', 'New View']);
    expect(rankCommands(commands, '', 2).map((c) => c.name)).toEqual(['Go to Chat', 'New Note']);
  });

  it('formats accelerators for the current platform', () => {
    const mac = /Mac/.test(navigator.platform);
    expect(formatShortcut('CmdOrCtrl+Shift+T')).toBe(mac ? '⌘⇧T' : 'Ctrl+Shift+T');
  });
});
