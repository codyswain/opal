import React, { useEffect } from "react";
import { toast } from "sonner";
import { COMMAND_IDS } from "@/common/commandIds";
import { folderScope } from "@/common/collectionQuery";
import { parentFsPath } from "@/common/fsPaths";
import { recordOpened } from "@/renderer/features/disk-explorer/activity/recordActivity";
import {
  browseCollection,
  browseFiles,
  browseRecent,
  focusFile,
  queryCollection,
  RECENT_COLLECTION,
} from "@/renderer/features/disk-explorer/navigation";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { useTabsStore } from "@/renderer/features/disk-explorer/store/tabsStore";
import { useViewDraftsStore } from "@/renderer/features/disk-explorer/store/viewDraftsStore";
import { useShell } from "@/renderer/features/shell/context/ShellContext";
import { useShellStore } from "@/renderer/features/shell/store/shellStore";
import { useTheme } from "@/renderer/features/theme";
import { usePref } from "@/renderer/shared/prefs/usePref";
import { commandRegistry, type Command } from "../services/commandRegistry";
import { usePaletteStore } from "../store/paletteStore";
import { usePrivacyStore } from "@/renderer/features/privacy/privacyStore";

export const PALETTE_COMMAND_ID = "palette.open";

/**
 * Registers every application command once and owns the palette shortcuts.
 * Lives inside the theme and shell providers so commands can navigate and
 * change the theme; the menu in main learns the same list through
 * `reportCommands`, so the two can never disagree.
 */
export const AppCommands: React.FC = () => {
  const { navigateFiles, navigateTo } = useShell();
  const { resolvedTheme, setTheme } = useTheme();
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const toggleInspector = useShellStore((state) => state.toggleInspector);
  const [bottomPaneOpen, setBottomPaneOpen] = usePref("isBottomPaneOpen", true);
  const shielded = usePrivacyStore((state) => state.shielded);

  useEffect(() => {
    const currentFolder = () =>
      useDiskStore.getState().currentDirectory ??
      useDiskStore.getState().roots[0] ??
      null;
    const commands: Command[] = [
      {
        id: "nav.today",
        name: "Go to Today",
        type: "navigation",
        keywords: ["home", "journal", "daily"],
        perform: () => navigateTo("/today"),
      },
      {
        id: COMMAND_IDS.togglePrivacy,
        name: shielded ? "Reveal Opal contents" : "Hide Opal contents",
        type: "action",
        shortcut: ["CmdOrCtrl+Shift+H"],
        keywords: ["privacy", "shield", "screen"],
        perform: () => usePrivacyStore.getState().toggle(),
      },
      {
        id: PALETTE_COMMAND_ID,
        name: "Search files and commands",
        type: "action",
        shortcut: ["CmdOrCtrl+K"],
        keywords: ["palette", "search", "find", "quick open"],
        perform: () => usePaletteStore.getState().show(),
      },
      {
        id: "nav.files",
        name: "Go to Library",
        type: "navigation",
        keywords: ["browse", "folder"],
        perform: () => {
          const folder = currentFolder();
          if (folder) navigateFiles(browseFiles(folder));
          else navigateTo("/files");
        },
      },
      {
        id: "nav.recent",
        name: "Go to Recent",
        type: "navigation",
        keywords: ["history", "activity"],
        perform: () => navigateFiles(browseRecent()),
      },
      {
        id: "nav.chat",
        name: "Go to Chat",
        type: "navigation",
        keywords: ["ask", "ai", "question"],
        perform: () => navigateTo("/chat"),
      },
      {
        id: COMMAND_IDS.openSettings,
        name: "Settings…",
        type: "navigation",
        shortcut: ["CmdOrCtrl+,"],
        keywords: ["settings", "preferences", "api key"],
        perform: () => navigateTo("/settings"),
      },
      {
        id: COMMAND_IDS.openFolder,
        name: "Open Folder on Disk",
        type: "navigation",
        shortcut: ["CmdOrCtrl+O"],
        keywords: ["files", "folder", "open", "disk", "add"],
        perform: () => {
          void useDiskStore.getState().openFolder();
        },
      },
      {
        id: "files.newNote",
        name: "New Note",
        type: "action",
        shortcut: ["CmdOrCtrl+N"],
        keywords: ["create", "markdown", "write"],
        perform: () => {
          const folder = currentFolder();
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
            navigateFiles(
              focusFile(
                parentFsPath(result.data.path) ?? folder,
                result.data.path,
              ),
            );
          });
        },
      },
      {
        id: "files.newView",
        name: "New View",
        type: "action",
        keywords: ["filter", "collection", "saved", "query"],
        perform: () => {
          const folder = useDiskStore.getState().currentDirectory;
          const id = useViewDraftsStore
            .getState()
            .create(
              folder ? { scope: folderScope(folder), origin: folder } : {},
            );
          navigateFiles(browseCollection(queryCollection(id)));
        },
      },
      {
        id: "chat.indexLibrary",
        name: "Index Library for Chat",
        type: "action",
        keywords: ["embed", "openai", "update index"],
        perform: () => {
          void window.chatAPI.indexUpdate().then((result) => {
            if (!result.success) toast.error(result.error);
          });
        },
      },
      {
        id: "tabs.reopenClosed",
        name: "Reopen Closed Tab",
        type: "action",
        shortcut: ["CmdOrCtrl+Shift+T"],
        keywords: ["tab", "restore", "undo close"],
        perform: () => {
          const path = useTabsStore.getState().reopenClosed();
          if (!path) return;
          const folder = parentFsPath(path);
          if (folder) navigateFiles(focusFile(folder, path));
        },
      },
      {
        id: "tabs.closeAll",
        name: "Close All Tabs",
        type: "action",
        keywords: ["tab", "close"],
        perform: () => {
          useTabsStore.getState().closeAll();
          navigateFiles(
            browseCollection(
              useDiskStore.getState().currentCollection ?? RECENT_COLLECTION,
            ),
          );
        },
      },
      {
        id: COMMAND_IDS.toggleLeftPane,
        name: "Toggle Sidebar",
        type: "paneToggle",
        shortcut: ["CmdOrCtrl+B"],
        keywords: ["pane", "toggle", "left"],
        perform: toggleSidebar,
      },
      {
        id: COMMAND_IDS.toggleRightPane,
        name: "Toggle Details Pane",
        type: "paneToggle",
        shortcut: ["CmdOrCtrl+Alt+B"],
        keywords: ["pane", "toggle", "right", "inspector"],
        perform: toggleInspector,
      },
      {
        id: COMMAND_IDS.toggleBottomPane,
        name: "Toggle Bottom Pane",
        type: "paneToggle",
        shortcut: ["CmdOrCtrl+J"],
        keywords: ["pane", "toggle"],
        perform: () => setBottomPaneOpen(!bottomPaneOpen),
      },
      {
        id: COMMAND_IDS.toggleTheme,
        name:
          resolvedTheme === "dark"
            ? "Switch to Light Mode"
            : "Switch to Dark Mode",
        type: "action",
        keywords: ["theme", "dark", "light", "appearance"],
        perform: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
      },
    ];
    commands.forEach((command) => commandRegistry.registerCommand(command));
    // Tell main what exists, so the menu and the palette can never disagree.
    window.systemAPI.reportCommands(
      commands.map((command) => ({
        id: command.id,
        label: command.name,
        accelerator: command.shortcut?.[0],
      })),
    );
    return () => {
      commands.forEach((command) => commandRegistry.unregisterCommand(command));
    };
  }, [
    navigateFiles,
    navigateTo,
    toggleSidebar,
    toggleInspector,
    bottomPaneOpen,
    setBottomPaneOpen,
    resolvedTheme,
    setTheme,
    shielded,
  ]);

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
