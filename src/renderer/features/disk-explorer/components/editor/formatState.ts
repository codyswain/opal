import { redoDepth, undoDepth } from '@codemirror/commands';
import type { EditorState } from '@codemirror/state';
import { allStyled, headingOf, inlineSpans, linkAt, listItemOf, selectedLines, selectedText, type ListKind, type SelectedText } from './formatCommands';

/** What a document's toolbar shows as on. A style counts only when the whole selection has it. */
export interface FormatState {
  /** Normal text is 0; null when the selected lines differ. */
  heading: number | null;
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  list: ListKind | null;
  /** Whether a selected line is a list item, so indent and outdent apply. */
  inList: boolean;
  link: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

/** Whether the selected text, or the text just before the caret, has the formatting `name`. */
function styled(state: EditorState, texts: readonly SelectedText[] | null, name: string): boolean {
  const { head } = state.selection.main;
  if (!texts) return inlineSpans(state, head, head).some((span) => span.name === name && span.textFrom <= head && head <= span.textTo);
  return texts.length > 0 && texts.every((text) => allStyled(state, text, name));
}

export function formatState(state: EditorState): FormatState {
  const lines = selectedLines(state);
  const written = lines.length === 1 ? lines : lines.filter((line) => /[^\s>]/.test(line.text));
  const levels = new Set(written.map((line) => headingOf(state, line)?.level ?? 0));
  const items = written.map((line) => listItemOf(state, line));
  const kind = items[0]?.kind ?? null;
  const { main } = state.selection;
  const texts = main.empty ? null : selectedText(state, main);
  const link = linkAt(state, main.from);
  return {
    heading: levels.size === 1 ? [...levels][0] : null,
    bold: styled(state, texts, 'StrongEmphasis'),
    italic: styled(state, texts, 'Emphasis'),
    strikethrough: styled(state, texts, 'Strikethrough'),
    list: kind && items.every((item) => item?.kind === kind) ? kind : null,
    inList: items.some(Boolean),
    link: link !== null && main.to <= link.textTo,
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
  };
}

/** Whether two states would draw the toolbar the same. */
export function sameFormat(a: FormatState | null, b: FormatState): boolean {
  return a !== null && (Object.keys(b) as (keyof FormatState)[]).every((key) => a[key] === b[key]);
}
