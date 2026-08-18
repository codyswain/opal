import { COMMAND_IDS } from '@/common/commandIds';

export interface MenuCommand {
  id: string;
  label: string;
  accelerator?: string;
}

export interface MenuTemplateItem {
  label?: string;
  role?: string;
  accelerator?: string;
  /** Set when selecting this item should dispatch a renderer command. */
  commandId?: string;
  type?: 'separator';
}

export interface MenuTemplateEntry {
  label: string;
  submenu: MenuTemplateItem[];
}

/**
 * Turns the registered command list into an Electron menu template.
 *
 * Free of any Electron import so it can be unit-tested. AppMenu.ts converts the
 * result into a real Menu.
 *
 * A command that was not supplied is omitted entirely rather than rendered
 * disabled: a greyed-out entry implies "not right now", but the real cause is
 * that the renderer never registered it, which the user cannot act on.
 */
export function buildMenuTemplate(
  commands: MenuCommand[],
  options: { appName: string }
): MenuTemplateEntry[] {
  const byId = new Map(commands.map((command) => [command.id, command]));

  const item = (id: string): MenuTemplateItem[] => {
    const command = byId.get(id);
    if (!command) return [];
    return [{ label: command.label, accelerator: command.accelerator, commandId: command.id }];
  };

  return [
    {
      label: options.appName,
      submenu: [
        { role: 'about', label: `About ${options.appName}` },
        { type: 'separator' },
        ...item(COMMAND_IDS.openSettings),
        { type: 'separator' },
        { role: 'hide', label: `Hide ${options.appName}` },
        { role: 'hideOthers', label: 'Hide Others' },
        { role: 'unhide', label: 'Show All' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${options.appName}` },
      ],
    },
    {
      label: 'File',
      submenu: [
        ...item(COMMAND_IDS.openFolder),
        { type: 'separator' },
        { role: 'close', label: 'Close Window' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...item(COMMAND_IDS.toggleLeftPane),
        ...item(COMMAND_IDS.toggleRightPane),
        ...item(COMMAND_IDS.toggleBottomPane),
        { type: 'separator' },
        ...item(COMMAND_IDS.toggleTheme),
        { type: 'separator' },
        { role: 'reload', label: 'Reload' },
        { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full Screen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: 'Minimize' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Bring All to Front' },
      ],
    },
  ];
}
