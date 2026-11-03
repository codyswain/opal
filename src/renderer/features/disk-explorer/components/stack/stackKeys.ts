import { Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

/** Which line of a section the caret goes to when it arrives from a neighbour. */
export type SectionEdge = 'first' | 'last';

/**
 * Moves the caret out of a section. Returns false when there is no section
 * that way, so the editor's own key runs.
 */
export type CrossSection = (direction: 'next' | 'previous', column: number) => boolean;

/** Whether two places on one wrapped line are on the same visual line; without layout to measure, the logical line decides. */
function onSameVisualLine(view: EditorView, from: number, to: number): boolean {
  const a = view.coordsAtPos(from);
  const b = view.coordsAtPos(to);
  return !a || !b || Math.abs(a.top - b.top) < 2;
}

function cross(view: EditorView, direction: 'next' | 'previous', move: CrossSection): boolean {
  const { selection, doc } = view.state;
  const range = selection.main;
  if (selection.ranges.length > 1 || !range.empty) return false;
  const line = doc.lineAt(range.head);
  if (direction === 'next') {
    if (line.number !== doc.lines || !onSameVisualLine(view, range.head, doc.length)) return false;
  } else if (line.number !== 1 || !onSameVisualLine(view, range.head, 0)) {
    return false;
  }
  return move(direction, range.head - line.from);
}

/**
 * ArrowDown on a section's last line moves the caret to the first line of
 * the next unfolded section, and ArrowUp on its first line to the last line
 * of the previous one. Only with one empty selection and no modifier.
 * Cmd+Option+Down and Up are View > Next Section and Previous Section
 * (`jump`), which the section runs itself rather than leave to the menu.
 */
export function sectionKeys(move: CrossSection, jump: (direction: 'next' | 'previous') => void): Extension {
  return Prec.high(
    keymap.of([
      { key: 'ArrowDown', run: (view) => cross(view, 'next', move) },
      { key: 'ArrowUp', run: (view) => cross(view, 'previous', move) },
      { key: 'Mod-Alt-ArrowDown', run: () => { jump('next'); return true; } },
      { key: 'Mod-Alt-ArrowUp', run: () => { jump('previous'); return true; } },
    ]),
  );
}

/** Puts the caret on a section's first or last line, at `column` where the line is long enough. */
export function placeCaret(view: EditorView, edge: SectionEdge, column: number): void {
  const { doc } = view.state;
  const line = edge === 'first' ? doc.line(1) : doc.line(doc.lines);
  const head = line.from + Math.min(Math.max(0, column), line.length);
  view.focus();
  view.dispatch({ selection: { anchor: head }, scrollIntoView: true, userEvent: 'select' });
}
