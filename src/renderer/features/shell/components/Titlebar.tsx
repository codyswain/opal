import * as React from "react";
import { PanelRight } from "lucide-react";
import { toggleDaySidebar } from "@/renderer/features/day-sidebar/store/daySidebarStore";
import { TabStrip } from "@/renderer/features/disk-explorer/components/TabStrip";
import { IconButton } from "@/renderer/shared/ui";
import { FrameControls, SearchButton, TrafficLightInset } from "./FrameControls";

interface TitlebarProps {
  sidebarOpen: boolean;
  /** With the right sidebar open, its own top row holds its toggle. */
  rightSidebarOpen?: boolean;
  onToggleSidebar: () => void;
  sidebarToggleRef?: React.Ref<HTMLButtonElement>;
  rightSidebarToggleRef?: React.Ref<HTMLButtonElement>;
}

/**
 * The page column's one 40px row: the tabs and New Tab, then the right
 * sidebar's toggle while that sidebar is closed. While the left sidebar is
 * hidden, its top row's controls (the toggle, Back, Forward and Search) come
 * first. The tabs have the rest of the row, and shrink and scroll once they
 * fill it. Empty space drags the window; every control is no-drag.
 */
export function Titlebar({
  onToggleSidebar,
  rightSidebarOpen = false,
  rightSidebarToggleRef,
  sidebarOpen,
  sidebarToggleRef,
}: TitlebarProps) {
  return (
    <header
      data-testid="titlebar"
      className="drag-handle flex h-header shrink-0 items-center gap-2 bg-chrome px-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {/* With the sidebar open, its own top row holds these. */}
        {!sidebarOpen ? (
          <>
            <TrafficLightInset />
            <FrameControls
              sidebarOpen={false}
              toggleRef={sidebarToggleRef}
              onToggleSidebar={onToggleSidebar}
            />
            <div className="no-drag flex shrink-0 items-center">
              <SearchButton />
            </div>
          </>
        ) : null}
        <TabStrip />
      </div>
      {!rightSidebarOpen ? (
        <div className="flex shrink-0 justify-end">
          <IconButton
            ref={rightSidebarToggleRef}
            label="Show right sidebar"
            shortcut="⌘⇧\"
            aria-controls="day-sidebar"
            aria-expanded={false}
            onClick={() => toggleDaySidebar()}
          >
            <PanelRight aria-hidden className="h-4 w-4" />
          </IconButton>
        </div>
      ) : null}
    </header>
  );
}

export type { TitlebarProps };
