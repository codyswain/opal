import { FilesRoute } from "@/renderer/features/disk-explorer/components/FilesRoute";
import * as React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { useSettingsStore } from "@/renderer/features/settings";
import {
  ShellProvider,
  WorkspaceSidebar,
  type ShellRouteObject,
} from "@/renderer/features/shell";
import { ThemeProvider } from "@/renderer/features/theme";
import { TooltipProvider } from "@/renderer/shared/ui";
import { entry, installDiskApi } from "@/tests/helpers/diskApi";
import { installActivityApi } from "@/tests/helpers/activityApi";
import { installCollectionsApi } from "@/tests/helpers/collectionsApi";
import { localDate } from "@/common/vaultModel";

const ROOT = "/Vault";
const DESIGN = "/Vault/Design";

const ROUTES: ShellRouteObject[] = [
  {
    path: "/files",
    element: null,
    handle: { shell: { id: "files", header: { title: "Files" } } },
  },
  {
    path: "/",
    element: null,
    handle: { shell: { id: "opal", header: { title: "Opal" } } },
  },
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
          <ShellProvider
            routes={ROUTES}
            fallbackRoute={{ id: "opal", header: { title: "Opal" } }}
          >
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
      data: {
        path,
        entries:
          path === ROOT
            ? [
                entry({
                  path: DESIGN,
                  name: "Design",
                  kind: "directory",
                  isDirectory: true,
                }),
                entry({
                  path: "/Vault/readme.md",
                  name: "readme.md",
                  kind: "markdown",
                }),
              ]
            : [],
      },
    })),
  });
  useDiskStore.setState({
    roots: [],
    listings: {},
    expanded: {},
    currentDirectory: null,
    currentCollection: null,
    focusedPath: null,
    selectedPath: null,
    selectedPaths: [],
    loading: { isLoading: false, error: null },
  });
});

describe("WorkspaceSidebar", () => {
  it("opens today's log page from the Today shortcut, creating it first", async () => {
    const createDay = vi.fn(async () => ({ success: true as const, data: undefined }));
    (window as unknown as { vaultAPI: unknown }).vaultAPI = {
      discover: vi.fn(async () => ({ success: true as const, data: [{ path: ROOT, name: "Vault" }] })),
      createDay,
    };
    const user = userEvent.setup();
    renderSidebar(false, "/");
    await user.click(screen.getByRole("button", { name: "Today" }));
    const today = localDate();
    expect(createDay).toHaveBeenCalledWith(ROOT, today);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `file=${encodeURIComponent(`${ROOT}/Inbox/Logs/${today}.md`)}`,
      ),
    );
  });

  it("opens the Settings dialog from the gear", async () => {
    useSettingsStore.setState({ open: false });
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(useSettingsStore.getState().open).toBe(true);
    expect(screen.getByTestId("location")).toHaveTextContent("/files");
  });

  it("keeps the sidebar quiet outside the library", async () => {
    renderSidebar(false, "/");
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
    expect(screen.queryByText("Open folders")).toBeNull();
    expect(screen.queryByText("Views")).toBeNull();
    expect(screen.queryByRole("link", { name: "Recent" })).toBeNull();
  });

  it("shows only real destinations and a lazy directory-only tree", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.queryByRole("link", { name: "Notes" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Threads" })).toBeNull();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /theme/i })).toBeNull();
    expect(screen.queryByText("Favorites")).toBeNull();
    expect(screen.queryByText("Search")).toBeNull();
    expect(screen.queryByText("Views")).toBeNull();
    expect(screen.queryByRole("button", { name: "New view" })).toBeNull();

    const root = await screen.findByTestId(`disk-tree-item-${ROOT}`);
    expect(root).toHaveAttribute("aria-level", "1");
    expect(window.diskAPI.readDirectory).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`disk-tree-toggle-${ROOT}`));
    const design = await screen.findByTestId(`disk-tree-item-${DESIGN}`);
    expect(design).toHaveAttribute("aria-level", "2");
    expect(screen.queryByText("readme.md")).toBeNull();
    expect(window.diskAPI.readDirectory).toHaveBeenCalledWith(ROOT);
  });

  it("navigates a directory through React Router and canonical disk state", async () => {
    const user = userEvent.setup();
    renderSidebar(true);
    await screen.findByTestId(`disk-tree-item-${ROOT}`);
    await user.click(screen.getByTestId(`disk-tree-toggle-${ROOT}`));
    const design = await screen.findByTestId(`disk-tree-item-${DESIGN}`);

    await user.click(design);

    await waitFor(() =>
      expect(useDiskStore.getState().currentDirectory).toBe(DESIGN),
    );
    expect(useDiskStore.getState().selectedPaths).toEqual([]);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/files?mode=browse&dir=%2FVault%2FDesign",
      ),
    );
  });

  it("provides roving tree focus and arrow-key navigation", async () => {
    const user = userEvent.setup();
    renderSidebar();
    const root = await screen.findByTestId(`disk-tree-item-${ROOT}`);
    await user.click(screen.getByTestId(`disk-tree-toggle-${ROOT}`));
    const design = await screen.findByTestId(`disk-tree-item-${DESIGN}`);

    act(() => root.focus());
    await user.keyboard("{ArrowDown}");

    await waitFor(() => expect(design).toHaveFocus());
    expect(root).toHaveAttribute("tabindex", "-1");
    expect(design).toHaveAttribute("tabindex", "0");
  });

  it("offers Recent and highlights it instead of Files while browsing Recent", async () => {
    const user = userEvent.setup();
    renderSidebar(true);
    await waitFor(() =>
      expect(useDiskStore.getState().currentDirectory).toBe(ROOT),
    );
    const files = screen.getByRole("link", { name: "Library" });
    const recent = screen.getByRole("link", { name: "Recent" });
    expect(files).toHaveClass("bg-surface-selected");
    expect(recent).not.toHaveClass("bg-surface-selected");

    await user.click(recent);
    await waitFor(() =>
      expect(useDiskStore.getState().currentCollection).toEqual({
        kind: "recent",
      }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/files?mode=browse&collection=recent",
    );
    expect(recent).toHaveClass("bg-surface-selected");
    expect(files).not.toHaveClass("bg-surface-selected");
    expect(window.activityAPI.record).not.toHaveBeenCalled();

    await user.click(files);
    await waitFor(() =>
      expect(useDiskStore.getState().currentDirectory).toBe(ROOT),
    );
    expect(files).toHaveClass("bg-surface-selected");
  });
});
