/**
 * Command identifiers shared by the main-process menu and the renderer's
 * command palette.
 *
 * Lives in common/ precisely so both processes import the same constants: a
 * menu item whose id does not match a registered command is a dead entry that
 * no test in either process would otherwise catch.
 */
export const COMMAND_IDS = {
  openSettings: 'app.openSettings',
  openFolder: 'files.openFolder',
  toggleLeftPane: 'pane.toggleLeft',
  toggleRightPane: 'pane.toggleRight',
  toggleBottomPane: 'pane.toggleBottom',
  toggleTheme: 'theme.toggle',
} as const;

export type CommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];
