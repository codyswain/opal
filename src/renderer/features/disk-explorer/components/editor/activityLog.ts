import { EditorState, StateField, type Text } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

const HEADING = /^## Activity Log[ \t]*$/;

/** Daily logs keep an Activity Log that only the vault's hook script writes. */
export function isDailyLog(path: string): boolean {
  return /(^|\/)Inbox\/Logs\/[^/]+\.md$/.test(path);
}

/** Where the "## Activity Log" heading line starts, or null without one. */
export function activityLogStart(doc: Text): number | null {
  let position = 0;
  for (const line of doc.iterLines()) {
    if (HEADING.test(line)) return position;
    position += line.length + 1;
  }
  return null;
}

/** Where the Activity Log starts on a daily log's page; the field is only there on daily logs. */
export const activityLogSection = StateField.define<number | null>({
  create: (state) => activityLogStart(state.doc),
  update: (start, tr) => (tr.docChanged ? activityLogStart(tr.newDoc) : start),
});

const muted = Decoration.line({ class: 'cm-activity-log' });

// Whole lines, so list markers drawn in place of the Markdown are muted too.
// Recomputed on every doc change, so lines appended at the end are muted as well.
const sectionDecorations = EditorView.decorations.compute(['doc', activityLogSection], (state) => {
  const start = state.field(activityLogSection);
  if (start === null) return Decoration.none;
  const lines = [];
  for (let number = state.doc.lineAt(start).number; number <= state.doc.lines; number += 1) lines.push(muted.range(state.doc.line(number).from));
  return Decoration.set(lines);
});

/**
 * Makes the Activity Log section, from its heading line to the end of the
 * page, read-only. Typing there is dropped, and so is anything that would
 * change the heading line: deleting the line break before it, typing at its
 * start, or adding text after the last line. Disk changes pass with
 * `filter: false`.
 */
export function readOnlyActivityLog() {
  return [
    activityLogSection,
    sectionDecorations,
    EditorState.changeFilter.of((tr) => {
      const start = tr.startState.field(activityLogSection);
      if (start === null) return true;
      let allowed = true;
      tr.changes.iterChangedRanges((_from, to) => {
        if (to >= start) allowed = false;
      });
      return allowed;
    }),
  ];
}
