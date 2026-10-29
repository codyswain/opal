import * as React from "react";
import { toast } from "sonner";
import { Clock, Settings, Sun } from "lucide-react";
import { localDate } from "@/common/vaultModel";
import {
  FILES_ROUTE_PATH,
  RECENT_COLLECTION,
  serializeFilesLocation,
} from "@/renderer/features/disk-explorer/navigation";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import {
  selectOpenedPath,
  useTabsStore,
} from "@/renderer/features/disk-explorer/store/tabsStore";
import { useSettingsStore } from "@/renderer/features/settings/store/settingsStore";
import { useShell } from "../context/ShellContext";
import { openToday } from "../utils/openToday";
import { FileTree } from "./FileTree";
import { FrameControls, TrafficLightInset } from "./FrameControls";
import { SidebarItem } from "./SidebarItem";
import { SidebarSection } from "./SidebarSection";

interface WorkspaceSidebarProps {
  onNavigate?: () => void;
  /** Hides the sidebar, or closes it in the narrow layout. */
  onToggleSidebar?: () => void;
}

const RECENT_DESTINATION = {
  pathname: FILES_ROUTE_PATH,
  search: serializeFilesLocation({ mode: "browse", collection: RECENT_COLLECTION }),
};

export function WorkspaceSidebar({
  onNavigate,
  onToggleSidebar,
}: WorkspaceSidebarProps) {
  const roots = useDiskStore((state) => state.roots);
  const isRecent = useDiskStore(
    (state) => state.currentCollection?.kind === "recent",
  );
  const openedPath = useTabsStore(selectOpenedPath);
  const { navigateFiles } = useShell();
  const todayLog = `/Inbox/Logs/${localDate()}.md`;
  const isToday = roots.some((root) => openedPath === `${root}${todayLog}`);

  const goToToday = async () => {
    try {
      if (await openToday(navigateFiles)) onNavigate?.();
      else toast.error("Open your vault folder first.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open today's page.");
    }
  };

  const openSettings = () => {
    onNavigate?.();
    useSettingsStore.getState().show();
  };

  return (
    <aside
      data-testid="workspace-sidebar"
      aria-label="Workspace"
      className="scrollbar-on-hover flex h-full min-h-0 w-full flex-col bg-chrome text-foreground"
    >
      <div className="drag-handle flex h-header shrink-0 items-center gap-1 px-2">
        <TrafficLightInset />
        <FrameControls sidebarOpen onToggleSidebar={() => onToggleSidebar?.()} />
      </div>

      <nav aria-label="Primary" className="shrink-0 pt-1">
        <SidebarSection>
          <SidebarItem
            icon={Sun}
            label="Today"
            active={isToday}
            onActivate={() => void goToToday()}
          />
          <SidebarItem
            to={RECENT_DESTINATION}
            icon={Clock}
            label="Recent"
            active={isRecent && !openedPath}
            onActivate={onNavigate}
          />
        </SidebarSection>
      </nav>

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
