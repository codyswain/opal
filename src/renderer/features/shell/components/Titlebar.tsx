import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import {
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/renderer/shared/ui";
import { useShell } from "../context/ShellContext";
import { FrameControls, TrafficLightInset } from "./FrameControls";

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
  const { route } = useShell();
  const { actions, leadingActions, tabs } = route.header;

  return (
    <header
      data-testid="titlebar"
      className="drag-handle shrink-0 bg-chrome"
    >
      <div className="flex h-header min-w-0 items-center gap-1 px-2">
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

        {leadingActions ? (
          <div className="no-drag flex shrink-0 items-center">
            {leadingActions}
          </div>
        ) : null}

        <div className="min-w-0 flex-1 px-1">
          <Breadcrumbs />
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
