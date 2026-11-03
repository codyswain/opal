import { FilesRoute } from "@/renderer/features/disk-explorer/components/FilesRoute";
import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { useStackStore } from "@/renderer/features/disk-explorer/store/stackStore";
import { useTabsStore } from "@/renderer/features/disk-explorer/store/tabsStore";
import { useSettingsStore } from "@/renderer/features/settings";
import { fileLocation, stackLocation } from "@/renderer/features/disk-explorer/navigation/filesLocation";
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
  it("opens today's page from Daily, at the path the main process returns", async () => {
    const today = localDate();
    const page = `${ROOT}/Library/daily/${today}.md`;
    const createDay = vi.fn(async () => ({ success: true as const, data: { path: page } }));
    (window as unknown as { vaultAPI: unknown }).vaultAPI = {
      discover: vi.fn(async () => ({ success: true as const, data: [{ path: ROOT, name: "Vault" }] })),
      createDay,
    };
    const user = userEvent.setup();
    renderSidebar(false, "/");
    await user.click(screen.getByRole("button", { name: "Daily" }));
    expect(createDay).toHaveBeenCalledWith(ROOT, today);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `file=${encodeURIComponent(page)}`,
      ),
    );
    // Daily counts as an open, so it shows in Recent.
    expect(window.activityAPI.record).toHaveBeenCalledWith(page, "opened");

    // Cmd+click opens Daily in a new tab instead.
    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("button", { name: "Daily" }));
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

  it("marks Daily active while today's daily page is open, also when a relaunch restored it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 29, 23, 59));
      const today = () => screen.getByRole("button", { name: "Daily" });
      // A restored tab, which Daily did not open.
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

    expect(screen.getByRole("button", { name: "Daily" })).toBeInTheDocument();
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

describe("a new daily page", () => {
  const DAILY = `${ROOT}/Library/daily`;
  const TODAY = `${DAILY}/2026-10-30.md`;
  const TOMORROW = `${DAILY}/2026-10-31.md`;
  let createDay: ReturnType<typeof vi.fn>;
  let discover: ReturnType<typeof vi.fn>;

  const shownEntry = () => {
    const state = useTabsStore.getState();
    const tab = state.tabs.find((candidate) => candidate.id === state.activeId);
    return tab?.history[tab.index];
  };
  const newPageMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "New daily page" }));
    return screen.findByRole("menu");
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // A Friday, so tomorrow is Saturday, Oct 31.
    vi.setSystemTime(new Date(2026, 9, 30, 9, 0));
    createDay = vi.fn(async (_root: string, date: string) => ({ success: true as const, data: { path: `${DAILY}/${date}.md` } }));
    discover = vi.fn(async () => ({ success: true as const, data: [{ path: ROOT, name: "Vault" }] }));
    (window as unknown as { vaultAPI: unknown }).vaultAPI = { discover, createDay };
    useStackStore.setState({ reveal: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("offers tomorrow with its date from the quiet + on the Daily row, and opens the stream at its page", async () => {
    const user = userEvent.setup();
    renderSidebar();
    const plus = screen.getByRole("button", { name: "New daily page" });
    // It shows only while the pointer or focus is in the sidebar, or while its menu is open.
    expect(plus).toHaveClass("opacity-0", "group-hover/sidebar:opacity-100", "group-focus-within/sidebar:opacity-100");
    const menu = await newPageMenu(user);
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["TomorrowSat, Oct 31", "Pick a date…"]);
    await user.click(within(menu).getByRole("menuitem", { name: /^Tomorrow/ }));
    // The stream of daily pages, headed by today's, starts at tomorrow's page above it.
    await waitFor(() => expect(shownEntry()?.location).toEqual(stackLocation("daily", TODAY)));
    expect(shownEntry()?.stack).toEqual({ anchor: TOMORROW, offset: 0 });
    expect(createDay).toHaveBeenCalledWith(ROOT, "2026-10-31");
    expect(createDay).toHaveBeenCalledWith(ROOT, "2026-10-30");
    expect(window.activityAPI.record).toHaveBeenCalledWith(TOMORROW, "opened");
  });

  it("offers the same on a right-click, and scrolls a stream already shown to the new page", async () => {
    openTabs([stackLocation("daily", TODAY)]);
    const user = userEvent.setup();
    renderSidebar();
    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "Daily" }) });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["TomorrowSat, Oct 31", "Pick a date…"]);
    await user.click(within(menu).getByRole("menuitem", { name: /^Tomorrow/ }));
    await waitFor(() => expect(useStackStore.getState().reveal).toMatchObject({ head: TODAY, path: TOMORROW }));
    // No second visit to the same stream.
    expect(useTabsStore.getState().tabs[0].history).toHaveLength(1);
  });

  it("picks any day in a dialog: a bad date says so, Enter creates the page, and a past day opens alone", async () => {
    const user = userEvent.setup();
    renderSidebar();
    const pick = async () => {
      await user.click(within(await newPageMenu(user)).getByRole("menuitem", { name: "Pick a date…" }));
      return screen.findByTestId("daily-date-dialog");
    };
    let dialog = await pick();
    let field = within(dialog).getByLabelText("Date");
    expect(field).toHaveAttribute("type", "date");
    expect(field).toHaveValue("2026-10-31");

    // Chromium reads a part-filled date as empty and fails its own check, which must not block the submit with its own bubble.
    const check = vi.spyOn(field as HTMLInputElement, "checkValidity").mockReturnValue(false);
    fireEvent.change(field, { target: { value: "" } });
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose a full date.");
    expect(createDay).not.toHaveBeenCalled();
    check.mockRestore();

    fireEvent.change(field, { target: { value: "2026-11-05" } });
    expect(within(dialog).queryByRole("alert")).toBeNull();
    await user.type(field, "{Enter}");
    await waitFor(() => expect(screen.queryByTestId("daily-date-dialog")).toBeNull());
    await waitFor(() => expect(shownEntry()?.stack).toEqual({ anchor: `${DAILY}/2026-11-05.md`, offset: 0 }));
    expect(shownEntry()?.location).toEqual(stackLocation("daily", TODAY));

    // It starts at tomorrow again, and an earlier day opens its page on its own, made if missing.
    createDay.mockClear();
    dialog = await pick();
    field = within(dialog).getByLabelText("Date");
    expect(field).toHaveValue("2026-10-31");
    fireEvent.change(field, { target: { value: "2026-10-20" } });
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(shownEntry()?.location).toEqual(fileLocation(`${DAILY}/2026-10-20.md`)));
    expect(createDay.mock.calls).toEqual([[ROOT, "2026-10-20"]]);
  });

  it("says so when no opened folder is a vault", async () => {
    const error = vi.spyOn(toast, "error");
    discover.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    renderSidebar();
    await user.click(within(await newPageMenu(user)).getByRole("menuitem", { name: /^Tomorrow/ }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("Open your vault folder first."));
    expect(createDay).not.toHaveBeenCalled();
  });
});
