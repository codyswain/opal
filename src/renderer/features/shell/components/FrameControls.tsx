import * as React from 'react';
import { ChevronLeft, ChevronRight, PanelLeft } from 'lucide-react';
import {
  selectCanGoBack,
  selectCanGoForward,
  useTabsStore,
} from '@/renderer/features/disk-explorer/store/tabsStore';
import { IconButton } from '@/renderer/shared/ui';
import { useShellStore } from '../store/shellStore';

/**
 * Room for the macOS traffic lights, which main.ts centers in the 40px top
 * row. Full screen hides them, so the room goes too.
 */
export function TrafficLightInset() {
  const fullScreen = useShellStore((state) => state.fullScreen);
  if (fullScreen) return null;
  return (
    <span
      aria-hidden
      data-testid="traffic-light-spacer"
      className="w-[70px] shrink-0"
    />
  );
}

interface FrameControlsProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  toggleRef?: React.Ref<HTMLButtonElement>;
}

/**
 * Sidebar toggle, Back and Forward, as in Safari. Back and Forward walk the
 * active tab's own history.
 */
export function FrameControls({
  onToggleSidebar,
  sidebarOpen,
  toggleRef,
}: FrameControlsProps) {
  const canGoBack = useTabsStore(selectCanGoBack);
  const canGoForward = useTabsStore(selectCanGoForward);

  return (
    <div className="no-drag flex shrink-0 items-center gap-0.5">
      <IconButton
        ref={toggleRef}
        label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        shortcut="⌘\"
        onClick={onToggleSidebar}
      >
        <PanelLeft aria-hidden className="h-4 w-4" />
      </IconButton>
      <IconButton
        label="Go back"
        shortcut="⌘["
        disabled={!canGoBack}
        onClick={() => useTabsStore.getState().back()}
      >
        <ChevronLeft aria-hidden className="h-4 w-4" />
      </IconButton>
      <IconButton
        label="Go forward"
        shortcut="⌘]"
        disabled={!canGoForward}
        onClick={() => useTabsStore.getState().forward()}
      >
        <ChevronRight aria-hidden className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

export type { FrameControlsProps };
