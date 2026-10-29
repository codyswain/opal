import { EditorState, Facet, StateField, type Text } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { readOnlyRule } from '@/common/stackModel';

const HEADING = /^## Activity Log[ \t]*$/;

/**
 * A page Opal shows read-only, such as a day's activity log, which only the
 * vault's scripts write. The rule is shared with the main process, so a page
 * reads the same alone and in a stack.
 */
export function isLogPage(path: string): boolean {
  return readOnlyRule(path);
}

/**
 * Daily logs from before the Library move keep an Activity Log section that
 * only the vault's hook script writes. Removed in the cleanup commit.
 */
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

/** Set on a log page, where the read-only part starts at the top. */
const wholePage = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });

/** Where the read-only part of the page starts; the field is only there on log pages and daily logs. */
export const activityLogSection = StateField.define<number | null>({
  create: (state) => (state.facet(wholePage) ? 0 : activityLogStart(state.doc)),
  update: (start, tr) => (tr.state.facet(wholePage) ? 0 : tr.docChanged ? activityLogStart(tr.newDoc) : start),
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

// Typing in the read-only part is dropped. Disk changes pass with `filter: false`.
const dropLockedChanges = EditorState.changeFilter.of((tr) => {
  const start = tr.startState.field(activityLogSection);
  if (start === null) return true;
  let allowed = true;
  tr.changes.iterChangedRanges((_from, to) => {
    if (to >= start) allowed = false;
  });
  return allowed;
});

/**
 * Makes the Activity Log section, from its heading line to the end of the
 * page, read-only. Typing there is dropped, and so is anything that would
 * change the heading line: deleting the line break before it, typing at its
 * start, or adding text after the last line.
 */
export function readOnlyActivityLog() {
  return [activityLogSection, sectionDecorations, dropLockedChanges];
}

/** Makes a whole log page read-only. It reads as rendered and still follows lines the scripts append. */
export function readOnlyLogPage() {
  return [wholePage.of(true), activityLogSection, dropLockedChanges, EditorState.readOnly.of(true)];
}
