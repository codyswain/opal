import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { ImportedFile } from '@/types/files';
import { linksResolved } from './wikiLinks';

/**
 * Puts a stored file in the page on a line of its own after the caret's
 * line: an image as an embed, any other file as a link named after it, both
 * by the file's path from the top of the vault. In a quote the line keeps
 * its ">", and under a list item it lines up with the item's text. Each
 * insert is its own undo step, and the link counts as resolved at once.
 */
export function insertEmbed(view: EditorView, file: ImportedFile, kind: 'image' | 'file'): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const quote = /^(?:[ \t]*>[ \t]?)*/.exec(line.text)?.[0] ?? '';
  const rest = line.text.slice(quote.length);
  const item = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.exec(rest)?.[0];
  const indent = item ? ' '.repeat(item.length) : /^[ \t]*/.exec(rest)?.[0] ?? '';
  const embed = kind === 'image' ? `![[${file.vaultPath}]]` : `[[${file.vaultPath}|${file.name.replace(/[[\]|]/g, '')}]]`;
  // An empty line takes the embed itself.
  const insert = /[^\s>]/.test(line.text) ? `\n${quote}${indent}${embed}` : embed;
  view.dispatch({
    changes: { from: line.to, insert },
    selection: { anchor: line.to + insert.length },
    effects: linksResolved.of({ [file.vaultPath]: file.path }),
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
    userEvent: 'input',
  });
}
