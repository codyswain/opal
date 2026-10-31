import React, { useEffect } from "react";
import { toast } from "sonner";
import { COMMAND_IDS, TAB_POSITION_COMMAND_IDS } from "@/common/commandIds";
import { parentFsPath } from "@/common/fsPaths";
import { recordOpened } from "@/renderer/features/disk-explorer/activity/recordActivity";
import {
  browseRecent,
  focusFile,
} from "@/renderer/features/disk-explorer/navigation";
import { shownPath, toggleDaySidebar } from "@/renderer/features/day-sidebar/store/daySidebarStore";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { isPinned, usePinsStore } from "@/renderer/features/disk-explorer/store/pinsStore";
import { selectViewedPath, useStackStore } from "@/renderer/features/disk-explorer/store/stackStore";
import {
  togglePageProperties,
  usePagePropertiesStore,
} from "@/renderer/features/disk-explorer/store/pagePropertiesStore";
import {
  selectOpenedPath,
  useTabsStore,
} from "@/renderer/features/disk-explorer/store/tabsStore";
import { useShell } from "@/renderer/features/shell/context/ShellContext";
import { useShellStore } from "@/renderer/features/shell/store/shellStore";
import { openToday } from "@/renderer/features/shell/utils/openToday";
import { useSettingsStore } from "@/renderer/features/settings/store/settingsStore";
import { commandRegistry, type Command } from "../services/commandRegistry";
import { usePaletteStore } from "../store/paletteStore";

export const PALETTE_COMMAND_ID = "palette.open";

const tabs = () => useTabsStore.getState();

/**
 * Registers every application command once and owns the palette shortcuts.
 * Lives inside the shell provider so commands can navigate; the menu in main learns the same list through
 * `reportCommands`, so the two can never disagree. Tab and history keys are
 * menu accelerators, which fire even while the editor has focus.
 */
export const AppCommands: React.FC = () => {
  const { navigateFiles } = useShell();
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  // The menu item reads Show Properties or Hide Properties, so the list is reported again when it flips.
  const propertiesOpen = usePagePropertiesStore((state) => state.open);
  // Next Section and Previous Section are there only while a stack is shown, so their keys are free elsewhere.
  const stackShown = useStackStore((state) => state.move !== null);
  // Pin page or Unpin page is there only while a file is open. In a stack it
  // acts on the section in view, as the day sidebar does.
  const openedPath = useTabsStore(selectOpenedPath);
  const activeTab = useTabsStore((state) => state.activeId);
  const viewedPath = useStackStore((state) => selectViewedPath(state, { activeId: activeTab }));
  const pagePath = viewedPath ?? openedPath;
  const fileOpen = pagePath !== null;
  const pagePinned = usePinsStore((state) => isPinned(state.byRoot, pagePath));

  useEffect(() => {
    const commands: Command[] = [
      {
        id: "nav.today",
        name: "Go to Today",
        type: "navigation",
        keywords: ["home", "journal", "daily"],
        perform: ({ newTab } = {}) => {
          void openToday(navigateFiles, { newTab })
            .then((opened) => {
              if (!opened) toast.error("Open your vault folder first.");
            })
            .catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Could not open today's page."),
            );
        },
      },
      {
        id: PALETTE_COMMAND_ID,
        name: "Search files and commands",
        type: "action",
        shortcut: ["CmdOrCtrl+K"],
        keywords: ["palette", "search", "find", "quick open"],
        hidden: true,
        perform: () => usePaletteStore.getState().show(),
      },
      {
        id: "nav.recent",
        name: "Go to Recent",
        type: "navigation",
        keywords: ["history", "activity"],
        perform: ({ newTab } = {}) => navigateFiles(browseRecent(), { newTab }),
      },
      {
        id: COMMAND_IDS.back,
        name: "Back",
        type: "navigation",
        shortcut: ["CmdOrCtrl+["],
        keywords: ["history", "previous page"],
        perform: () => tabs().back(),
      },
      {
        id: COMMAND_IDS.forward,
        name: "Forward",
        type: "navigation",
        shortcut: ["CmdOrCtrl+]"],
        keywords: ["history", "next page"],
        perform: () => tabs().forward(),
      },
      {
        id: COMMAND_IDS.openSettings,
        name: "Settings…",
        type: "navigation",
        shortcut: ["CmdOrCtrl+,"],
        keywords: ["settings", "preferences", "theme", "folders", "history"],
        perform: () => useSettingsStore.getState().show(),
      },
      {
        id: COMMAND_IDS.openFolder,
        name: "Open Folder…",
        type: "navigation",
        shortcut: ["CmdOrCtrl+O"],
        keywords: ["files", "folder", "open", "disk", "add"],
        perform: () => {
          void useDiskStore.getState().openFolder();
        },
      },
      {
        id: COMMAND_IDS.newNote,
        name: "New Note",
        type: "action",
        shortcut: ["CmdOrCtrl+N"],
        keywords: ["create", "markdown", "write"],
        perform: () => {
          // Next to the open page, or at the top of the vault.
          const opened = selectOpenedPath(tabs());
          const folder =
            (opened && parentFsPath(opened)) ??
            useDiskStore.getState().roots[0] ??
            null;
          if (!folder) {
            toast.error("Open a folder first.");
            return;
          }
          void window.markdownAPI.create(folder).then((result) => {
            if (!result.success) {
              toast.error(result.error);
              return;
            }
            void useDiskStore.getState().loadDirectory(folder, { force: true });
            recordOpened(result.data.path);
            navigateFiles(focusFile(result.data.path));
          });
        },
      },
      {
        id: COMMAND_IDS.newTab,
        name: "New Tab",
        type: "action",
        shortcut: ["CmdOrCtrl+T"],
        keywords: ["tab", "open"],
        perform: () => usePaletteStore.getState().show("", { newTab: true }),
      },
      {
        id: COMMAND_IDS.closeTab,
        name: "Close Tab",
        type: "action",
        shortcut: ["CmdOrCtrl+W"],
        keywords: ["tab", "close"],
        perform: () => {
          // With no tab left, Cmd+W closes the window, as in Safari.
          const { activeId } = tabs();
          if (activeId) tabs().close(activeId);
          else window.systemAPI.closeWindow();
        },
      },
      {
        id: COMMAND_IDS.reopenClosedTab,
        name: "Reopen Closed Tab",
        type: "action",
        shortcut: ["CmdOrCtrl+Shift+T"],
        keywords: ["tab", "restore", "undo close"],
        perform: () => {
          tabs().reopenClosed();
        },
      },
      {
        id: "tabs.closeAll",
        name: "Close All Tabs",
        type: "action",
        keywords: ["tab", "close"],
        perform: () => tabs().closeAll(),
      },
      {
        id: COMMAND_IDS.previousTab,
        name: "Show Previous Tab",
        type: "navigation",
        shortcut: ["CmdOrCtrl+Shift+[", "Ctrl+Shift+Tab"],
        keywords: ["tab", "switch", "left"],
        perform: () => tabs().activatePrevious(),
      },
      {
        id: COMMAND_IDS.nextTab,
        name: "Show Next Tab",
        type: "navigation",
        shortcut: ["CmdOrCtrl+Shift+]", "Ctrl+Tab"],
        keywords: ["tab", "switch", "right"],
        perform: () => tabs().activateNext(),
      },
      ...TAB_POSITION_COMMAND_IDS.map(
        (id, index): Command => ({
          id,
          name: `Show Tab ${index + 1}`,
          type: "navigation",
          shortcut: [`CmdOrCtrl+${index + 1}`],
          keywords: [],
          hidden: true,
          perform: () => tabs().activateIndex(index),
        }),
      ),
      {
        id: COMMAND_IDS.lastTab,
        name: "Show Last Tab",
        type: "navigation",
        shortcut: ["CmdOrCtrl+9"],
        keywords: [],
        hidden: true,
        perform: () => tabs().activateIndex(-1),
      },
      {
        id: COMMAND_IDS.toggleLeftPane,
        name: "Toggle Sidebar",
        type: "paneToggle",
        shortcut: ["CmdOrCtrl+\\"],
        keywords: ["pane", "toggle", "left"],
        perform: toggleSidebar,
      },
      {
        id: COMMAND_IDS.toggleRightPane,
        name: "Toggle Right Sidebar",
        type: "paneToggle",
        shortcut: ["CmdOrCtrl+Shift+\\"],
        keywords: ["pane", "toggle", "right", "day", "log", "chats", "recordings", "digest"],
        perform: () => toggleDaySidebar(),
      },
      {
        id: COMMAND_IDS.collapseAllFolders,
        name: "Collapse All Folders",
        type: "action",
        // Left collapses a folder in the tree, so Option-Command-Left collapses them all.
        shortcut: ["Alt+CmdOrCtrl+Left"],
        keywords: ["tree", "sidebar", "files", "fold", "close folders"],
        perform: () => useDiskStore.getState().collapseAll(),
      },
      ...(stackShown
        ? [
          {
            id: COMMAND_IDS.nextSection,
            name: "Next Section",
            type: "navigation",
            // A menu accelerator for when no section has focus; a section's editor takes the key itself.
            shortcut: ["Alt+CmdOrCtrl+Down"],
            keywords: ["stack", "daily", "page", "scroll", "down"],
            perform: () => {
              useStackStore.getState().move?.("next");
            },
          } satisfies Command,
          {
            id: COMMAND_IDS.previousSection,
            name: "Previous Section",
            type: "navigation",
            shortcut: ["Alt+CmdOrCtrl+Up"],
            keywords: ["stack", "daily", "page", "scroll", "up"],
            perform: () => {
              useStackStore.getState().move?.("previous");
            },
          } satisfies Command,
        ]
        : []),
      ...(fileOpen
        ? [
          {
            id: "page.togglePin",
            name: pagePinned ? "Unpin page" : "Pin page",
            type: "action",
            keywords: ["pin", "pinned", "sidebar", "bookmark", "favorite"],
            perform: () => {
              const page = shownPath();
              if (page) usePinsStore.getState().toggle(page);
            },
          } satisfies Command,
        ]
        : []),
      {
        id: COMMAND_IDS.toggleProperties,
        name: propertiesOpen ? "Hide Properties" : "Show Properties",
        type: "action",
        shortcut: ["CmdOrCtrl+Shift+I"],
        keywords: ["properties", "frontmatter", "metadata", "file", "info", "path", "created", "modified", "size"],
        perform: togglePageProperties,
      },
    ];
    commands.forEach((command) => commandRegistry.registerCommand(command));
    // Tell main what exists, so the menu and the palette can never disagree.
    window.systemAPI.reportCommands(
      commands.map((command) => ({
        id: command.id,
        label: command.name,
        accelerator: command.shortcut?.[0],
        aliases: command.shortcut?.slice(1),
      })),
    );
    return () => {
      commands.forEach((command) => commandRegistry.unregisterCommand(command));
    };
  }, [navigateFiles, toggleSidebar, propertiesOpen, stackShown, fileOpen, pagePinned]);

  // Cmd+K and Cmd+P open the palette; Cmd+Shift+P opens it in command mode.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "k" && !event.shiftKey) {
        event.preventDefault();
        usePaletteStore.getState().toggle();
      } else if (key === "p") {
        event.preventDefault();
        usePaletteStore.getState().show(event.shiftKey ? ">" : "");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
};
