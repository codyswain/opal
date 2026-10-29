import * as React from "react";
import { PanelRight, Search } from "lucide-react";
import { usePaletteStore } from "@/renderer/features/commands/store/paletteStore";
import { toggleDaySidebar } from "@/renderer/features/day-sidebar/store/daySidebarStore";
import { TabStrip } from "@/renderer/features/disk-explorer/components/TabStrip";
import { IconButton } from "@/renderer/shared/ui";
import { cn } from "@/renderer/shared/utils";
import { FrameControls, TrafficLightInset } from "./FrameControls";

interface TitlebarProps {
  sidebarOpen: boolean;
  /** With the right sidebar open, its own top row holds its toggle. */
  rightSidebarOpen?: boolean;
  /** Narrow windows fold the search field to its icon. */
  compact: boolean;
  onToggleSidebar: () => void;
  sidebarToggleRef?: React.Ref<HTMLButtonElement>;
  rightSidebarToggleRef?: React.Ref<HTMLButtonElement>;
}

const openPalette = () => usePaletteStore.getState().show();

function SearchField({ compact }: { compact: boolean }) {
  if (compact) {
    return (
      <IconButton label="Search" shortcut="⌘K" onClick={openPalette}>
        <Search aria-hidden className="h-4 w-4" />
      </IconButton>
    );
  }
  return (
    <button
      type="button"
      aria-label="Search"
      aria-keyshortcuts="Meta+K"
      onClick={openPalette}
      className="flex h-control-compact w-[12.5rem] items-center gap-2 rounded-control bg-surface-hover px-2 text-ui text-foreground-tertiary outline-none transition-hover hover:bg-surface-active hover:text-foreground-secondary focus-visible:ring-2 focus-visible:ring-foreground/25"
    >
      <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-icon" />
      <span className="flex-1 text-left">Search</span>
      <kbd className="font-sans text-metadata text-foreground-tertiary">⌘K</kbd>
    </button>
  );
}

/**
 * The page column's one 40px row: the tabs and New Tab, then a search field
 * centred in the row that opens the palette, then the right sidebar's toggle
 * while that sidebar is closed. The row is a grid whose first column grows
 * past half only when the tabs need it, so the field stays put until the tabs
 * push it right, and the tabs shrink and scroll once it meets the edge. Empty
 * space drags the window; every control is no-drag.
 */
export function Titlebar({
  compact,
  onToggleSidebar,
  rightSidebarOpen = false,
  rightSidebarToggleRef,
  sidebarOpen,
  sidebarToggleRef,
}: TitlebarProps) {
  return (
    <header
      data-testid="titlebar"
      className="drag-handle grid h-header shrink-0 grid-cols-[minmax(max-content,1fr)_auto_minmax(0,1fr)] items-center gap-2 bg-chrome px-2 [container-type:inline-size]"
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-1",
          compact
            ? "max-w-[calc(100cqw-2.75rem)]"
            : "max-w-[calc(100cqw-13.5rem)]",
        )}
      >
        {/* With the sidebar open, its own top row holds these. */}
        {!sidebarOpen ? (
          <>
            <TrafficLightInset />
            <FrameControls
              sidebarOpen={false}
              toggleRef={sidebarToggleRef}
              onToggleSidebar={onToggleSidebar}
            />
          </>
        ) : null}
        <TabStrip />
      </div>
      <SearchField compact={compact} />
      <div className="flex min-w-0 justify-end">
        {!rightSidebarOpen ? (
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
        ) : null}
      </div>
    </header>
  );
}

export type { TitlebarProps };
