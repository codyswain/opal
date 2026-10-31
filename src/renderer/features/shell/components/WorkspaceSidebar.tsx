import * as React from "react";
import { toast } from "sonner";
import { ChevronsDownUp, Clock, Settings, Sun } from "lucide-react";
import { dailyPageDate } from "@/renderer/features/day-sidebar/dayRule";
import { useToday } from "@/renderer/features/day-sidebar/hooks/useDay";
import { browseRecent } from "@/renderer/features/disk-explorer/navigation";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { canCollapseTree } from "@/renderer/features/disk-explorer/store/treeExpansion";
import {
  selectCurrentLocation,
  selectOpenedPath,
  useTabsStore,
} from "@/renderer/features/disk-explorer/store/tabsStore";
import { useSettingsStore } from "@/renderer/features/settings/store/settingsStore";
import { IconButton } from "@/renderer/shared/ui";
import { useShell } from "../context/ShellContext";
import { openToday } from "../utils/openToday";
import { FileTree } from "./FileTree";
import { FrameControls, SearchButton, TrafficLightInset } from "./FrameControls";
import { PinnedSection } from "./PinnedSection";
import { SidebarItem } from "./SidebarItem";
import { SidebarSection } from "./SidebarSection";

interface WorkspaceSidebarProps {
  onNavigate?: () => void;
  /** Hides the sidebar, or closes it in the narrow layout. */
  onToggleSidebar?: () => void;
}

/**
 * Collapse all folders, beside Search. It shows only while the pointer is
 * over the sidebar or focus is in it, and only when a folder is open, so the
 * row stays quiet. View > Collapse All Folders does the same.
 */
function CollapseFoldersButton() {
  const shown = useDiskStore((state) => canCollapseTree(state.roots, state.expanded));
  if (!shown) return null;
  return (
    <IconButton
      label="Collapse all folders"
      shortcut="⌥⌘←"
      data-testid="collapse-all-folders"
      onClick={() => useDiskStore.getState().collapseAll()}
      className="sidebar-collapse-all opacity-0 focus-visible:opacity-100 group-hover/sidebar:opacity-100 group-focus-within/sidebar:opacity-100"
    >
      <ChevronsDownUp aria-hidden className="h-4 w-4" />
    </IconButton>
  );
}

/** Cmd+click and middle-click open in a new tab, as everywhere else. */
function wantsNewTab(event: React.MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.button === 1;
}

export function WorkspaceSidebar({
  onNavigate,
  onToggleSidebar,
}: WorkspaceSidebarProps) {
  const isRecent = useTabsStore((state) => {
    const shown = selectCurrentLocation(state);
    return shown?.mode === "browse" && shown.collection.kind === "recent";
  });
  const openedPath = useTabsStore(selectOpenedPath);
  const { navigateFiles } = useShell();
  const today = useToday();
  // A daily page restored on relaunch counts too, and the mark moves on at midnight.
  const isToday = dailyPageDate(openedPath) === today;

  const goToToday = async (newTab: boolean) => {
    try {
      if (await openToday((intent) => navigateFiles(intent, { newTab }))) onNavigate?.();
      else toast.error("Open your vault folder first.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open today's page.");
    }
  };

  const goToRecent = (newTab: boolean) => {
    navigateFiles(browseRecent(), { newTab });
    onNavigate?.();
  };

  const openSettings = () => {
    onNavigate?.();
    useSettingsStore.getState().show();
  };

  return (
    <aside
      data-testid="workspace-sidebar"
      aria-label="Workspace"
      className="group/sidebar flex h-full min-h-0 w-full flex-col bg-chrome text-foreground"
    >
      <div className="sidebar-top-row drag-handle flex h-header shrink-0 items-center gap-1 px-2">
        <TrafficLightInset />
        <FrameControls sidebarOpen onToggleSidebar={() => onToggleSidebar?.()} />
        <div className="no-drag ml-auto flex shrink-0 items-center gap-0.5">
          <CollapseFoldersButton />
          <SearchButton />
        </div>
      </div>

      <nav aria-label="Primary" className="shrink-0 pt-1">
        <SidebarSection>
          <SidebarItem
            icon={Sun}
            label="Today"
            active={isToday}
            onActivate={(event) => void goToToday(wantsNewTab(event))}
          />
          <SidebarItem
            icon={Clock}
            label="Recent"
            active={isRecent}
            onActivate={(event) => goToRecent(wantsNewTab(event))}
          />
        </SidebarSection>
      </nav>

      <PinnedSection onNavigate={onNavigate} />

      <div className="min-h-0 flex-1 pt-4">
        <FileTree onNavigate={onNavigate} />
      </div>

      <div className="shrink-0 p-2">
        <SidebarItem icon={Settings} label="Settings" onActivate={openSettings} />
      </div>
    </aside>
  );
}

export type { WorkspaceSidebarProps };
