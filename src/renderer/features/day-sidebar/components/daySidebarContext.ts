import * as React from 'react';

export interface DaySidebarContextValue {
  root: string;
  /** Opens a vault file in this tab, or a new one on Cmd-click or a middle click. */
  openPath: (path: string, event: React.MouseEvent) => void;
}

export const DaySidebarContext = React.createContext<DaySidebarContextValue>({
  root: '',
  openPath: () => undefined,
});

export const useDaySidebarContext = () => React.useContext(DaySidebarContext);

/** A vault file's path from the vault root, as the sidebar's tooltips name it. */
export function vaultRelative(root: string, path: string): string {
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/** Cmd+click and middle-click open in a new tab, as everywhere else. */
export function wantsNewTab(event: React.MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.button === 1;
}
