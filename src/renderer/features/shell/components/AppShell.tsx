import * as React from 'react';
import { locationName } from '@/renderer/features/disk-explorer/components/tabLabels';
import { useDiskSync } from '@/renderer/features/disk-explorer/hooks/useDiskSync';
import {
  selectCurrentLocation,
  useTabsStore,
} from '@/renderer/features/disk-explorer/store/tabsStore';
import { useShell } from '../context/ShellContext';
import {
  DEFAULT_SHELL_PREFERENCES,
  SHELL_LIMITS,
  useShellStore,
} from '../store/shellStore';
import {
  DaySidebar,
  daySidebarMaxWidth,
  daySidebarShown,
  daySidebarWidth,
  DAY_SIDEBAR_LIMITS,
  useDaySidebarStore,
} from '@/renderer/features/day-sidebar';
import { cn } from '@/renderer/shared/utils';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { Titlebar } from './Titlebar';
import { WorkspaceSidebar } from './WorkspaceSidebar';

export const SHELL_BREAKPOINTS = {
  medium: 800,
  wide: 1200,
} as const;

export type ShellLayout = 'narrow' | 'medium' | 'wide';

export function shellLayoutForWidth(width: number): ShellLayout {
  if (width >= SHELL_BREAKPOINTS.wide) return 'wide';
  if (width >= SHELL_BREAKPOINTS.medium) return 'medium';
  return 'narrow';
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? SHELL_BREAKPOINTS.wide : window.innerWidth;
}

function useShellViewport(): { layout: ShellLayout; width: number } {
  const [width, setWidth] = React.useState(viewportWidth);

  React.useEffect(() => {
    const update = () => setWidth(viewportWidth());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return { layout: shellLayoutForWidth(width), width };
}

/** The medium layout keeps at least about 560px for the page. */
const MEDIUM_SIDEBAR_MAX = 240;

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Escape closes an overlay, and Tab stays inside it. */
function overlayKeyDown(
  overlay: React.RefObject<HTMLElement>,
  close: () => void
): (event: React.KeyboardEvent<HTMLDivElement>) => void {
  return (event) => {
    // A menu opened from the overlay portals out of it and closes on its own Escape.
    if (!overlay.current?.contains(event.target as Node)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...overlay.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const persistedSidebarOpen = useShellStore((state) => state.sidebarOpen);
  const sidebarWidth = useShellStore((state) => state.sidebarWidth);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const narrowSidebarOpen = useShellStore(
    (state) => state.narrowSidebarOpen
  );
  const setNarrowLayout = useShellStore((state) => state.setNarrowLayout);
  const closeNarrowSidebarState = useShellStore(
    (state) => state.closeNarrowSidebar
  );
  const setSidebarWidth = useShellStore((state) => state.setSidebarWidth);
  const { location } = useShell();
  const pageName = useTabsStore((state) => {
    const shown = selectCurrentLocation(state);
    return shown ? locationName(shown) : null;
  });
  const { layout, width: viewport } = useShellViewport();
  const narrowSidebarRef = React.useRef<HTMLDivElement>(null);
  const sidebarToggleRef = React.useRef<HTMLButtonElement>(null);
  const workspaceRef = React.useRef<HTMLElement>(null);
  const workspaceMainRef = React.useRef<HTMLElement>(null);
  const daySidebarRef = React.useRef<HTMLDivElement>(null);
  const locationKey = `${location.pathname}${location.search}`;
  const previousLocationKey = React.useRef(locationKey);
  const isNarrow = layout === 'narrow';
  const sidebarOpen = isNarrow
    ? narrowSidebarOpen
    : persistedSidebarOpen;
  const effectiveSidebarWidth = isNarrow
    ? Math.min(sidebarWidth, Math.max(0, viewport - 48))
    : layout === 'medium'
      ? Math.min(sidebarWidth, MEDIUM_SIDEBAR_MAX)
      : sidebarWidth;
  const sidebarMax =
    layout === 'medium' ? MEDIUM_SIDEBAR_MAX : SHELL_LIMITS.sidebar.max;
  const daySidebarOpen = useDaySidebarStore((state) => state.open);
  const daySidebarNarrowOpen = useDaySidebarStore((state) => state.narrowOpen);
  const daySidebarPreferredWidth = useDaySidebarStore((state) => state.width);
  const setDaySidebarWidth = useDaySidebarStore((state) => state.setWidth);
  const rightOpen = daySidebarShown(
    { open: daySidebarOpen, narrowOpen: daySidebarNarrowOpen },
    sidebarOpen,
    isNarrow,
    viewport
  );
  const rightWidth = isNarrow
    ? Math.min(daySidebarWidth(daySidebarPreferredWidth, viewport), Math.max(0, viewport - 48))
    : daySidebarWidth(daySidebarPreferredWidth, viewport);
  const rightToggleRef = React.useRef<HTMLButtonElement>(null);

  useDiskSync();

  // The window menu, Mission Control and Cmd+` name the window by its page.
  React.useEffect(() => {
    document.title = pageName ?? 'Opal';
  }, [pageName]);

  React.useEffect(() => {
    const { setFullScreen } = useShellStore.getState();
    void window.systemAPI?.isFullScreen?.().then(setFullScreen);
    return window.systemAPI?.onFullScreenChange?.(setFullScreen);
  }, []);

  const closeNarrowSidebar = React.useCallback(
    (focusTarget: 'toggle' | 'workspace' | 'none' = 'toggle') => {
      closeNarrowSidebarState();
      if (focusTarget !== 'none') {
        window.requestAnimationFrame(() => {
          const target =
            focusTarget === 'workspace'
              ? workspaceMainRef.current
              : sidebarToggleRef.current;
          target?.focus();
        });
      }
    },
    [closeNarrowSidebarState]
  );

  const closeDayOverlay = React.useCallback((focusWorkspace = false) => {
    useDaySidebarStore.getState().setNarrowOpen(false);
    if (focusWorkspace) {
      window.requestAnimationFrame(() => workspaceMainRef.current?.focus());
    }
  }, []);

  // However the right overlay closes, focus that was in it goes back to its toggle.
  const wasDayOverlay = React.useRef(false);
  React.useEffect(() => {
    const overlay = isNarrow && rightOpen;
    if (wasDayOverlay.current && !overlay && document.activeElement === document.body) {
      rightToggleRef.current?.focus();
    }
    wasDayOverlay.current = overlay;
  }, [isNarrow, rightOpen]);

  React.useEffect(() => {
    setNarrowLayout(isNarrow);
  }, [isNarrow, setNarrowLayout]);

  React.useEffect(() => {
    const routeChanged = previousLocationKey.current !== locationKey;
    previousLocationKey.current = locationKey;
    if (!routeChanged || !isNarrow) return;
    if (useShellStore.getState().narrowSidebarOpen) {
      closeNarrowSidebar('workspace');
    }
    if (useDaySidebarStore.getState().narrowOpen) {
      closeDayOverlay(true);
    }
  }, [closeDayOverlay, closeNarrowSidebar, isNarrow, locationKey]);

  React.useLayoutEffect(() => {
    // An overlay shuts everything beside it; the right sidebar sits outside
    // the page column, so the left overlay shuts it too.
    const overlay = !isNarrow
      ? null
      : narrowSidebarOpen
        ? narrowSidebarRef.current
        : rightOpen
          ? daySidebarRef.current
          : null;
    const behind = [workspaceRef.current, daySidebarRef.current].filter(
      (element): element is HTMLElement =>
        element !== null && element !== overlay
    );
    const release = () => {
      for (const element of behind) {
        element.removeAttribute('inert');
        element.removeAttribute('aria-hidden');
      }
    };
    if (behind.length === 0) return;

    if (!overlay) {
      release();
      return;
    }

    overlay.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    for (const element of behind) {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    }

    return release;
  }, [isNarrow, narrowSidebarOpen, rightOpen]);

  const handleToggleSidebar = () => {
    toggleSidebar();
  };

  return (
    <div
      data-testid="app-shell"
      data-layout={layout}
      className="relative flex h-screen w-screen overflow-hidden bg-chrome text-foreground"
    >
      {isNarrow && (sidebarOpen || rightOpen) ? (
        <div
          aria-hidden
          onClick={() => (sidebarOpen ? closeNarrowSidebar() : closeDayOverlay())}
          className="fixed inset-0 z-30 bg-black/20 animate-in fade-in-0 duration-disclosure"
        />
      ) : null}

      {sidebarOpen ? (
        <div
          ref={isNarrow ? narrowSidebarRef : undefined}
          role={isNarrow ? 'dialog' : undefined}
          aria-modal={isNarrow ? true : undefined}
          aria-label={isNarrow ? 'Workspace navigation' : undefined}
          onKeyDown={isNarrow ? overlayKeyDown(narrowSidebarRef, () => closeNarrowSidebar()) : undefined}
          className={cn(
            'relative h-full shrink-0',
            isNarrow
              ? 'fixed inset-y-0 left-0 z-40 shadow-dialog animate-in slide-in-from-left-2 duration-disclosure ease-emphasized'
              : 'z-10'
          )}
          style={{ width: effectiveSidebarWidth }}
        >
          <WorkspaceSidebar
            // Only the narrow overlay closes on a pick and hands focus to the
            // page; beside the page, focus stays where the user put it.
            onNavigate={isNarrow ? () => closeNarrowSidebar('workspace') : undefined}
            onToggleSidebar={
              isNarrow ? () => closeNarrowSidebar() : handleToggleSidebar
            }
          />
          {!isNarrow ? (
            <SidebarResizeHandle
              label="Resize workspace sidebar"
              value={effectiveSidebarWidth}
              min={SHELL_LIMITS.sidebar.min}
              max={sidebarMax}
              defaultValue={DEFAULT_SHELL_PREFERENCES.sidebarWidth}
              onChange={setSidebarWidth}
            />
          ) : null}
        </div>
      ) : null}

      {/* The chrome ground holds the page as an inset card with a hairline ring. */}
      <section
        ref={workspaceRef}
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        <Titlebar
          compact={isNarrow}
          sidebarOpen={sidebarOpen}
          rightSidebarOpen={rightOpen}
          sidebarToggleRef={sidebarToggleRef}
          rightSidebarToggleRef={rightToggleRef}
          onToggleSidebar={handleToggleSidebar}
        />
        <main
          ref={workspaceMainRef}
          tabIndex={-1}
          data-testid="workspace-surface"
          aria-label="Page"
          className={cn(
            'mb-page min-h-0 min-w-0 flex-1 overflow-hidden rounded-card border border-page-ring bg-canvas outline-none',
            (isNarrow || !sidebarOpen) && 'ml-page',
            // The right sidebar's column keeps its own gap to the page; its overlay does not.
            (isNarrow || !rightOpen) && 'mr-page'
          )}
        >
          {children}
        </main>
      </section>

      {rightOpen ? (
        <div
          ref={daySidebarRef}
          role={isNarrow ? 'dialog' : undefined}
          aria-modal={isNarrow ? true : undefined}
          aria-label={isNarrow ? 'Day sidebar' : undefined}
          onKeyDown={isNarrow ? overlayKeyDown(daySidebarRef, () => closeDayOverlay()) : undefined}
          className={cn(
            'relative h-full shrink-0',
            isNarrow
              ? 'fixed inset-y-0 right-0 z-40 shadow-dialog animate-in slide-in-from-right-2 duration-disclosure ease-emphasized'
              : 'z-10'
          )}
          style={{ width: rightWidth }}
        >
          {!isNarrow ? (
            <SidebarResizeHandle
              edge="start"
              label="Resize right sidebar"
              value={rightWidth}
              min={DAY_SIDEBAR_LIMITS.min}
              max={daySidebarMaxWidth(viewport)}
              defaultValue={daySidebarWidth(null, viewport)}
              onChange={setDaySidebarWidth}
              onReset={() => setDaySidebarWidth(null)}
            />
          ) : null}
          <DaySidebar width={rightWidth} />
        </div>
      ) : null}
    </div>
  );
}

export type { AppShellProps };
