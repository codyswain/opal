import type { Command } from './commandRegistry';

/**
 * Ranks a command against typed text. A prefix match on the name wins, then
 * a word-start match, then any substring, then a keyword hit, then a loose
 * in-order subsequence; 0 means no match.
 */
export function scoreCommand(command: Command, term: string): number {
  const query = term.trim().toLowerCase();
  if (!query) return 1;
  const name = command.name.toLowerCase();
  if (name.startsWith(query)) return 100;
  if (name.split(/\s+/).some((word) => word.startsWith(query))) return 80;
  if (name.includes(query)) return 60;
  if (command.keywords.some((keyword) => keyword.toLowerCase().includes(query))) return 40;
  let cursor = 0;
  for (const character of name) {
    if (character === query[cursor]) cursor += 1;
    if (cursor === query.length) return 20;
  }
  return 0;
}

export function rankCommands(commands: readonly Command[], term: string, limit = Infinity): Command[] {
  return commands
    .map((command) => ({ command, score: scoreCommand(command, term) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.command.name.localeCompare(right.command.name))
    .slice(0, limit)
    .map(({ command }) => command);
}

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** "CmdOrCtrl+Shift+T" becomes "⌘⇧T" on a Mac and "Ctrl+Shift+T" elsewhere. */
export function formatShortcut(accelerator: string): string {
  const parts = accelerator.split('+');
  if (!MAC) return parts.map((part) => (part === 'CmdOrCtrl' ? 'Ctrl' : part)).join('+');
  const glyphs: Record<string, string> = { CmdOrCtrl: '⌘', Cmd: '⌘', Command: '⌘', Ctrl: '⌃', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' };
  return parts.map((part) => glyphs[part] ?? part.toUpperCase()).join('');
}
