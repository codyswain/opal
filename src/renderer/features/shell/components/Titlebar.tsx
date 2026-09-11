import * as React from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
} from "lucide-react";
import {
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/renderer/shared/ui";
import { useShell } from "../context/ShellContext";
import { usePrivacyStore } from "@/renderer/features/privacy/privacyStore";

interface TitlebarProps {
  sidebarOpen: boolean;
  compactActions: boolean;
  onToggleSidebar: () => void;
  sidebarToggleRef?: React.Ref<HTMLButtonElement>;
}

function Breadcrumbs() {
  const {
    route: {
      header: { breadcrumbs, title },
    },
  } = useShell();

  if (!breadcrumbs || breadcrumbs.length === 0) {
    return (
      <h1 className="truncate text-ui font-medium text-foreground">{title}</h1>
    );
  }

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
      {breadcrumbs.map((breadcrumb, index) => (
        <React.Fragment key={breadcrumb.id}>
          {index > 0 ? (
            <ChevronRight
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary"
            />
          ) : null}
          {breadcrumb.to ? (
            <Link
              to={breadcrumb.to}
              className="no-drag min-w-0 truncate rounded-row px-1 text-ui text-foreground-secondary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
            >
              {breadcrumb.label}
            </Link>
          ) : breadcrumb.onActivate ? (
            <button
              type="button"
              onClick={breadcrumb.onActivate}
              className="no-drag min-w-0 truncate rounded-row px-1 text-ui text-foreground-secondary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
            >
              {breadcrumb.label}
            </button>
          ) : (
            <span className="min-w-0 truncate px-1 text-ui text-foreground-secondary">
              {breadcrumb.label}
            </span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

export function Titlebar({
  compactActions,
  onToggleSidebar,
  sidebarOpen,
  sidebarToggleRef,
}: TitlebarProps) {
  const { goBack, goForward, route } = useShell();
  const { actions, leadingActions, tabs } = route.header;

  return (
    <header
      data-testid="titlebar"
      className="drag-handle shrink-0 border-b border-border-subtle bg-canvas"
    >
      <div className="flex h-header min-w-0 items-center gap-1 px-2">
        {!sidebarOpen ? (
          <span
            aria-hidden
            data-testid="traffic-light-spacer"
            className="w-[68px] shrink-0"
          />
        ) : null}
        <div className="no-drag flex shrink-0 items-center">
          <IconButton label="Go back" onClick={goBack}>
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Go forward" onClick={goForward}>
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            ref={sidebarToggleRef}
            label={
              sidebarOpen ? "Hide workspace sidebar" : "Show workspace sidebar"
            }
            active={sidebarOpen}
            onClick={onToggleSidebar}
          >
            {sidebarOpen ? (
              <PanelLeftClose aria-hidden className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftOpen aria-hidden className="h-3.5 w-3.5" />
            )}
          </IconButton>
        </div>

        {leadingActions ? (
          <div className="no-drag flex shrink-0 items-center">
            {leadingActions}
          </div>
        ) : null}

        <div className="min-w-0 flex-1 px-1">
          <Breadcrumbs />
        </div>

        <div className="no-drag">
          <IconButton
            label="Hide Opal contents"
            shortcut="⌘⇧H"
            onClick={() => usePrivacyStore.getState().shield()}
          >
            <Shield aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
          </IconButton>
        </div>

        {actions ? (
          compactActions ? (
            <Popover>
              <PopoverTrigger asChild>
                <IconButton label="Page actions">
                  <MoreHorizontal aria-hidden className="h-4 w-4" />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto min-w-44">
                <div className="flex flex-col gap-1">{actions}</div>
              </PopoverContent>
            </Popover>
          ) : (
            <div className="no-drag flex shrink-0 items-center gap-1">
              {actions}
            </div>
          )
        ) : null}
      </div>
      {tabs ? (
        <div className="no-drag min-h-row-compact border-t border-border-subtle">
          {tabs}
        </div>
      ) : null}
    </header>
  );
}

export type { TitlebarProps };
