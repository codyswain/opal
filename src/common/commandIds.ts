/**
 * Command identifiers shared by the main-process menu and the renderer's
 * command palette.
 *
 * Lives in common/ precisely so both processes import the same constants: a
 * menu item whose id does not match a registered command is a dead entry that
 * no test in either process would otherwise catch.
 */
export const COMMAND_IDS = {
  openSettings: "app.openSettings",
  openFolder: "files.openFolder",
  newNote: "files.newNote",
  toggleLeftPane: "pane.toggleLeft",
  toggleRightPane: "pane.toggleRight",
  toggleProperties: "page.toggleProperties",
  newTab: "tabs.new",
  closeTab: "tabs.close",
  reopenClosedTab: "tabs.reopenClosed",
  previousTab: "tabs.previous",
  nextTab: "tabs.next",
  lastTab: "tabs.showLast",
  back: "history.back",
  forward: "history.forward",
} as const;

/** Cmd+1 to Cmd+8 select a tab by position; Cmd+9 is the last tab. */
export const TAB_POSITION_COMMAND_IDS = [1, 2, 3, 4, 5, 6, 7, 8].map(
  (position) => `tabs.show${position}`,
);

export type CommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];
