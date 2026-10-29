import { FilesRoute } from "@/renderer/features/disk-explorer/components/FilesRoute";
import * as React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { useTabsStore } from "@/renderer/features/disk-explorer/store/tabsStore";
import { useSettingsStore } from "@/renderer/features/settings";
import { fileLocation } from "@/renderer/features/disk-explorer/navigation/filesLocation";
import {
  ShellProvider,
  WorkspaceSidebar,
  useShellStore,
} from "@/renderer/features/shell";
import { ThemeProvider } from "@/renderer/features/theme";
import { TooltipProvider } from "@/renderer/shared/ui";
import { entry, installDiskApi } from "@/tests/helpers/diskApi";
import { installActivityApi } from "@/tests/helpers/activityApi";
import { installCollectionsApi } from "@/tests/helpers/collectionsApi";
import { localDate } from "@/common/vaultModel";
import { openTabs, resetTabs, tabPaths } from "@/tests/helpers/tabs";

const ROOT = "/Vault";
const DESIGN = "/Vault/Design";
const ROOT_ENTRIES = [
  entry({ path: DESIGN, name: "Design", kind: "directory", isDirectory: true }),
  entry({ path: "/Vault/readme.md", name: "readme.md", kind: "markdown" }),
];

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderSidebar(withFiles = false, initialPath = "/files") {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ThemeProvider>
        <TooltipProvider>
          <ShellProvider>
            <div className="h-[600px] w-[220px]">
              <WorkspaceSidebar />
            </div>
            <LocationProbe />
            {withFiles ? <FilesRoute /> : null}
          </ShellProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  installActivityApi();
  installCollectionsApi();
  installDiskApi({
    listRoots: vi.fn(async () => ({
      success: true as const,
      data: [ROOT],
    })),
    readDirectory: vi.fn(async (path: string) => ({
      success: true as const,
      data: { path, entries: path === ROOT ? ROOT_ENTRIES : [] },
    })),
  });
  resetTabs();
  useDiskStore.setState({
    roots: [],
    rootsLoaded: false,
    listings: {},
    expanded: {},
    loading: { isLoading: false, error: null },
  });
});

describe("WorkspaceSidebar", () => {
  it("opens today's page from the Today shortcut, at the path the main process returns", async () => {
    const today = localDate();
    const page = `${ROOT}/Library/daily/${today}.md`;
    const createDay = vi.fn(async () => ({ success: true as const, data: { path: page } }));
    (window as unknown as { vaultAPI: unknown }).vaultAPI = {
      discover: vi.fn(async () => ({ success: true as const, data: [{ path: ROOT, name: "Vault" }] })),
      createDay,
    };
    const user = userEvent.setup();
    renderSidebar(false, "/");
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(createDay).toHaveBeenCalledWith(ROOT, today);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `file=${encodeURIComponent(page)}`,
      ),
    );
    // Today counts as an open, so it shows in Recent.
    expect(window.activityAPI.record).toHaveBeenCalledWith(page, "opened");

    // Cmd+click opens Today in a new tab instead.
    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("button", { name: "Today" }));
    await user.keyboard("{/Meta}");
    await waitFor(() => expect(tabPaths()).toEqual([page, page]));
  });

  it("opens the Settings dialog from the gear", async () => {
    useSettingsStore.setState({ open: false });
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(useSettingsStore.getState().open).toBe(true);
    expect(screen.getByTestId("location")).toHaveTextContent("/files");
  });

  it("marks Today active while today's daily page is open, also when a relaunch restored it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 29, 23, 59));
      const today = () => screen.getByRole("button", { name: "Today" });
      // A restored tab, which Today did not open.
      openTabs([`${ROOT}/Library/daily/2026-10-29.md`]);
      renderSidebar();
      expect(today()).toHaveClass("bg-surface-selected");

      act(() => useTabsStore.getState().open(fileLocation(`${ROOT}/readme.md`)));
      expect(today()).not.toHaveClass("bg-surface-selected");
      // Until the cleanup commit, the old page counts too; the day's log does not.
      act(() => useTabsStore.getState().open(fileLocation(`${ROOT}/Inbox/Logs/2026-10-29.md`)));
      expect(today()).toHaveClass("bg-surface-selected");
      act(() => useTabsStore.getState().open(fileLocation(`${ROOT}/Library/logs/2026-10-29 log.md`)));
      expect(today()).not.toHaveClass("bg-surface-selected");

      // At midnight the page becomes yesterday's.
      act(() => useTabsStore.getState().open(fileLocation(`${ROOT}/Library/daily/2026-10-29.md`)));
      expect(today()).toHaveClass("bg-surface-selected");
      vi.setSystemTime(new Date(2026, 9, 30, 0, 1));
      act(() => { window.dispatchEvent(new Event("focus")); });
      expect(today()).not.toHaveClass("bg-surface-selected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the same nav and file tree on every route, without Library", async () => {
    useDiskStore.setState({
      roots: [ROOT],
      listings: { [ROOT]: ROOT_ENTRIES },
    });
    renderSidebar(false, "/");

    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recent" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();
    expect(screen.queryByText("Open folders")).toBeNull();
    expect(screen.queryByRole("button", { name: /workspace folder/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /theme/i })).toBeNull();
    expect(screen.getByRole("tree", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByTestId(`disk-tree-item-${DESIGN}`)).toBeInTheDocument();
    expect(screen.getByTestId("disk-tree-item-/Vault/readme.md")).toHaveTextContent("readme");
  });

  it("holds the sidebar toggle, Back and Forward in its top row", async () => {
    const onToggleSidebar = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/files"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TooltipProvider>
          <ShellProvider>
            <WorkspaceSidebar onToggleSidebar={onToggleSidebar} />
          </ShellProvider>
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go forward" })).toBeInTheDocument();
    expect(screen.getByTestId("traffic-light-spacer")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);

    act(() => useShellStore.getState().setFullScreen(true));
    expect(screen.queryByTestId("traffic-light-spacer")).toBeNull();
    act(() => useShellStore.getState().setFullScreen(false));
  });

  it("highlights Recent only while browsing Recent", async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ roots: [ROOT], rootsLoaded: true });
    renderSidebar(true);
    const recent = screen.getByRole("button", { name: "Recent" });
    expect(recent).not.toHaveClass("bg-surface-selected");

    await user.click(recent);
    expect(await screen.findByRole("heading", { name: "Recent" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/files?mode=browse&collection=recent",
    );
    expect(recent).toHaveClass("bg-surface-selected");
    expect(window.activityAPI.record).not.toHaveBeenCalled();

    // Opening a page from Recent leaves Recent one Back step away.
    act(() => useTabsStore.getState().open(fileLocation(`${ROOT}/readme.md`)));
    expect(recent).not.toHaveClass("bg-surface-selected");
  });
});
