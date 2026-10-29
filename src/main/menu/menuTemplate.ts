import { COMMAND_IDS, TAB_POSITION_COMMAND_IDS } from "@/common/commandIds";

export interface MenuCommand {
  id: string;
  label: string;
  accelerator?: string;
  /** More accelerators for the same command, as hidden items (Ctrl+Tab). */
  aliases?: string[];
}

export interface MenuTemplateItem {
  label?: string;
  role?: string;
  accelerator?: string;
  /** Set when selecting this item should dispatch a renderer command. */
  commandId?: string;
  /** False for an item that exists only for its accelerator. */
  visible?: boolean;
  type?: "separator";
}

export interface MenuTemplateEntry {
  label: string;
  submenu: MenuTemplateItem[];
}

const SEPARATOR: MenuTemplateItem = { type: "separator" };

/**
 * Drops separators that would show at either end of a menu or next to each
 * other, which happens when the commands between them were not supplied.
 * Hidden items do not count as content.
 */
function tidy(items: MenuTemplateItem[]): MenuTemplateItem[] {
  const tidied: MenuTemplateItem[] = [];
  let pendingSeparator = false;
  let shown = false;
  for (const item of items) {
    if (item.type === "separator") {
      pendingSeparator = shown;
      continue;
    }
    if (item.visible !== false) {
      if (pendingSeparator) tidied.push(SEPARATOR);
      pendingSeparator = false;
      shown = true;
    }
    tidied.push(item);
  }
  return tidied;
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
 *
 * Tab and history commands live here, not in a renderer key handler, because
 * menu accelerators still fire while the editor has focus.
 */
export function buildMenuTemplate(
  commands: MenuCommand[],
  options: { appName: string },
): MenuTemplateEntry[] {
  const byId = new Map(commands.map((command) => [command.id, command]));

  const item = (id: string, visible = true): MenuTemplateItem[] => {
    const command = byId.get(id);
    if (!command) return [];
    const entry = (accelerator: string | undefined, shown: boolean) => ({
      label: command.label,
      accelerator,
      commandId: command.id,
      ...(shown ? {} : { visible: false }),
    });
    return [
      entry(command.accelerator, visible),
      ...(command.aliases ?? []).map((alias) => entry(alias, false)),
    ];
  };
  const hidden = (id: string) => item(id, false);

  const menus: MenuTemplateEntry[] = [
    {
      label: options.appName,
      submenu: [
        { role: "about", label: `About ${options.appName}` },
        SEPARATOR,
        ...item(COMMAND_IDS.openSettings),
        SEPARATOR,
        { role: "hide", label: `Hide ${options.appName}` },
        { role: "hideOthers", label: "Hide Others" },
        { role: "unhide", label: "Show All" },
        SEPARATOR,
        { role: "quit", label: `Quit ${options.appName}` },
      ],
    },
    {
      label: "File",
      submenu: [
        ...item(COMMAND_IDS.newTab),
        ...item(COMMAND_IDS.newNote),
        ...item(COMMAND_IDS.openFolder),
        SEPARATOR,
        // Cmd+W closes the tab, as in Safari; the window has Shift+Cmd+W.
        ...item(COMMAND_IDS.closeTab),
        { role: "close", label: "Close Window", accelerator: "CmdOrCtrl+Shift+W" },
        ...item(COMMAND_IDS.reopenClosedTab),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo", label: "Undo" },
        { role: "redo", label: "Redo" },
        SEPARATOR,
        { role: "cut", label: "Cut" },
        { role: "copy", label: "Copy" },
        { role: "paste", label: "Paste" },
        { role: "selectAll", label: "Select All" },
      ],
    },
    {
      label: "View",
      submenu: [
        ...item(COMMAND_IDS.toggleLeftPane),
        ...item(COMMAND_IDS.toggleRightPane),
        ...item(COMMAND_IDS.toggleProperties),
        SEPARATOR,
        ...item(COMMAND_IDS.collapseAllFolders),
        SEPARATOR,
        ...item(COMMAND_IDS.nextSection),
        ...item(COMMAND_IDS.previousSection),
        SEPARATOR,
        { role: "reload", label: "Reload" },
        { role: "toggleDevTools", label: "Toggle Developer Tools" },
        SEPARATOR,
        { role: "resetZoom", label: "Actual Size" },
        { role: "zoomIn", label: "Zoom In" },
        { role: "zoomOut", label: "Zoom Out" },
        SEPARATOR,
        { role: "togglefullscreen", label: "Toggle Full Screen" },
      ],
    },
    {
      label: "Go",
      submenu: [...item(COMMAND_IDS.back), ...item(COMMAND_IDS.forward)],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize", label: "Minimize" },
        { role: "zoom", label: "Zoom" },
        SEPARATOR,
        ...item(COMMAND_IDS.previousTab),
        ...item(COMMAND_IDS.nextTab),
        ...TAB_POSITION_COMMAND_IDS.flatMap(hidden),
        ...hidden(COMMAND_IDS.lastTab),
        SEPARATOR,
        { role: "front", label: "Bring All to Front" },
      ],
    },
  ];

  // A menu whose every item was omitted would render as an empty, unclickable
  // title — and Electron stalls building one on macOS. Drop those instead.
  return menus
    .map((menu) => ({ ...menu, submenu: tidy(menu.submenu) }))
    .filter((menu) => menu.submenu.length > 0);
}
