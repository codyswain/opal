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

/** The sidebar's names for its two pages stay capitalised where a label ends with one, as in "Go to Daily". */
const PAGE_NAMES = new Set(['Daily', 'Recent']);

/**
 * Commands are named in title case for the macOS menu; the palette, like the
 * rest of Opal, reads them in sentence case: "Close All Tabs" is "Close all tabs".
 */
export function sentenceCase(name: string): string {
  const words = name.split(' ');
  return words
    .map((word, index) => (index === 0 || (index === words.length - 1 && PAGE_NAMES.has(word)) ? word : word.toLowerCase()))
    .join(' ');
}

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** "CmdOrCtrl+Shift+T" becomes "⌘⇧T" on a Mac and "Ctrl+Shift+T" elsewhere. */
export function formatShortcut(accelerator: string): string {
  const parts = accelerator.split('+');
  if (!MAC) return parts.map((part) => (part === 'CmdOrCtrl' ? 'Ctrl' : part)).join('+');
  const glyphs: Record<string, string> = {
    CmdOrCtrl: '⌘', Cmd: '⌘', Command: '⌘', Ctrl: '⌃', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧',
    Left: '←', Right: '→', Up: '↑', Down: '↓',
  };
  return parts.map((part) => glyphs[part] ?? part.toUpperCase()).join('');
}
