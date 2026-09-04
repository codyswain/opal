import * as React from 'react';
import { useShell } from '../context/ShellContext';
import {
  SHELL_LIMITS,
  useShellStore,
} from '../store/shellStore';
import { cn } from '@/renderer/shared/utils';
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

interface SidebarResizeHandleProps {
  value: number;
  max: number;
  onChange: (width: number) => void;
}

const DEFAULT_SIDEBAR_WIDTH = 220;

function SidebarResizeHandle({
  max,
  onChange,
  value,
}: SidebarResizeHandleProps) {
  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = value;
    const onPointerMove = (moveEvent: PointerEvent) => {
      onChange(
        Math.min(
          max,
          Math.max(
            SHELL_LIMITS.sidebar.min,
            startWidth + moveEvent.clientX - startX
          )
        )
      );
    };
    const stop = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    onChange(
      Math.min(
        max,
        Math.max(SHELL_LIMITS.sidebar.min, value + direction * 8)
      )
    );
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize workspace sidebar"
      aria-orientation="vertical"
      aria-valuemin={SHELL_LIMITS.sidebar.min}
      aria-valuemax={max}
      aria-valuenow={value}
      onDoubleClick={() => onChange(DEFAULT_SIDEBAR_WIDTH)}
      onKeyDown={onKeyDown}
      onPointerDown={beginResize}
      className="no-drag absolute inset-y-0 right-[-2px] z-10 w-1 cursor-col-resize bg-transparent outline-none transition-colors hover:bg-focus/40 focus-visible:bg-focus"
    />
  );
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
  const { location, route } = useShell();
  const { layout, width: viewport } = useShellViewport();
  const narrowSidebarRef = React.useRef<HTMLDivElement>(null);
  const sidebarToggleRef = React.useRef<HTMLButtonElement>(null);
  const workspaceRef = React.useRef<HTMLElement>(null);
  const workspaceMainRef = React.useRef<HTMLElement>(null);
  const locationKey = `${location.pathname}${location.search}`;
  const previousLocationKey = React.useRef(locationKey);
  const isNarrow = layout === 'narrow';
  const sidebarOpen = isNarrow
    ? narrowSidebarOpen
    : persistedSidebarOpen;
  const effectiveSidebarWidth = isNarrow
    ? Math.min(sidebarWidth, Math.max(0, viewport - 48))
    : layout === 'medium'
      ? Math.min(sidebarWidth, 200)
      : sidebarWidth;
  const sidebarMax =
    layout === 'medium' ? 200 : SHELL_LIMITS.sidebar.max;

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

  React.useEffect(() => {
    setNarrowLayout(isNarrow);
  }, [isNarrow, setNarrowLayout]);

  React.useEffect(() => {
    const routeChanged = previousLocationKey.current !== locationKey;
    previousLocationKey.current = locationKey;
    if (
      routeChanged &&
      isNarrow &&
      useShellStore.getState().narrowSidebarOpen
    ) {
      closeNarrowSidebar('workspace');
    }
  }, [closeNarrowSidebar, isNarrow, locationKey]);

  React.useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    if (!isNarrow || !narrowSidebarOpen) {
      workspace.removeAttribute('inert');
      workspace.removeAttribute('aria-hidden');
      return;
    }

    narrowSidebarRef.current
      ?.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
      ?.focus();
    workspace.setAttribute('inert', '');
    workspace.setAttribute('aria-hidden', 'true');

    return () => {
      workspace.removeAttribute('inert');
      workspace.removeAttribute('aria-hidden');
    };
  }, [isNarrow, narrowSidebarOpen]);

  const handleToggleSidebar = () => {
    toggleSidebar();
  };

  const handleNarrowSidebarKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeNarrowSidebar();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [
      ...(narrowSidebarRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      ) ?? []),
    ];
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

  return (
    <div
      data-testid="app-shell"
      data-layout={layout}
      className="relative flex h-screen w-screen overflow-hidden bg-canvas text-foreground"
    >
      {isNarrow && sidebarOpen ? (
        <div
          aria-hidden
          onClick={() => closeNarrowSidebar()}
          className="fixed inset-0 z-30 bg-black/20 animate-in fade-in-0 duration-disclosure"
        />
      ) : null}

      {sidebarOpen ? (
        <div
          ref={isNarrow ? narrowSidebarRef : undefined}
          role={isNarrow ? 'dialog' : undefined}
          aria-modal={isNarrow ? true : undefined}
          aria-label={isNarrow ? 'Workspace navigation' : undefined}
          onKeyDown={isNarrow ? handleNarrowSidebarKeyDown : undefined}
          className={cn(
            'relative h-full shrink-0 border-r border-border-subtle',
            isNarrow
              ? 'fixed inset-y-0 left-0 z-40 shadow-dialog animate-in slide-in-from-left-2 duration-disclosure'
              : 'z-10'
          )}
          style={{ width: effectiveSidebarWidth }}
        >
          <WorkspaceSidebar
            onNavigate={() => closeNarrowSidebar('workspace')}
            onClose={
              isNarrow ? () => closeNarrowSidebar() : undefined
            }
          />
          {!isNarrow ? (
            <SidebarResizeHandle
              value={effectiveSidebarWidth}
              max={sidebarMax}
              onChange={setSidebarWidth}
            />
          ) : null}
        </div>
      ) : null}

      <section
        ref={workspaceRef}
        className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas"
      >
        <Titlebar
          compactActions={isNarrow}
          sidebarOpen={sidebarOpen}
          sidebarToggleRef={sidebarToggleRef}
          onToggleSidebar={handleToggleSidebar}
        />
        <main
          ref={workspaceMainRef}
          tabIndex={-1}
          data-testid="workspace-surface"
          aria-label={`${route.header.title} workspace`}
          className="min-h-0 min-w-0 flex-1 overflow-hidden outline-none"
        >
          {children}
        </main>
      </section>
    </div>
  );
}

export type { AppShellProps };
