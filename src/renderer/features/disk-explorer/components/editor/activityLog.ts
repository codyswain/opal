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

const sectionStart = StateField.define<number | null>({
  create: (state) => activityLogStart(state.doc),
  update: (start, tr) => (tr.docChanged ? activityLogStart(tr.newDoc) : start),
});

const muted = Decoration.mark({ class: 'cm-activity-log' });

// Recomputed on every doc change, so text appended at the end is muted too.
const sectionDecorations = EditorView.decorations.compute(['doc', sectionStart], (state) => {
  const start = state.field(sectionStart);
  return start === null ? Decoration.none : Decoration.set(muted.range(start, state.doc.length));
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
    sectionStart,
    sectionDecorations,
    EditorState.changeFilter.of((tr) => {
      const start = tr.startState.field(sectionStart);
      if (start === null) return true;
      let allowed = true;
      tr.changes.iterChangedRanges((_from, to) => {
        if (to >= start) allowed = false;
      });
      return allowed;
    }),
  ];
}
