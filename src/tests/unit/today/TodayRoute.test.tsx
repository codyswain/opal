import React, { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { TodayRoute } from "@/renderer/features/today/TodayRoute";
import type { VaultDay } from "@/types/vault";
import { localDate } from "@/common/vaultModel";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { installDiskApi } from "@/tests/helpers/diskApi";

const navigateFiles = vi.hoisted(() => vi.fn());
vi.mock("@/renderer/features/shell", () => ({
  useShell: () => {
    const [location, setLocation] = useState({
      pathname: "/today",
      search: "",
    });
    return { location, navigateTo: setLocation, navigateFiles };
  },
}));
vi.mock("@/renderer/features/today/JournalPanel", () => ({
  JournalPanel: ({ hidden }: { hidden: boolean }) =>
    hidden ? <p>Journal hidden</p> : <textarea aria-label="Daily journal" />,
}));
const empty: VaultDay = {
  root: "/vault",
  date: localDate(),
  logPath: "/vault/Inbox/Logs/day.md",
  document: null,
  brief: "",
  digestPath: null,
  digestUpdatedAt: null,
  tasks: [],
  focus: [],
  photos: [],
  warnings: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  installDiskApi({
    listRoots: vi.fn().mockResolvedValue({ success: true, data: ["/vault"] }),
  });
  useDiskStore.setState({ roots: ["/vault"] });
  window.vaultAPI = {
    discover: vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: [{ path: "/vault", name: "Vault" }],
      }),
    readDay: vi
      .fn()
      .mockImplementation((_root, date) =>
        Promise.resolve({ success: true, data: { ...empty, date } }),
      ),
    createDay: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    addFocus: vi.fn().mockResolvedValue({ success: true, data: [] }),
    updateFocus: vi.fn().mockResolvedValue({ success: true, data: [] }),
    saveJournal: vi.fn(),
    listDrafts: vi.fn(),
    putDraft: vi.fn(),
    clearDraft: vi.fn(),
  };
});
it("offers explicit creation and keeps activity collapsed initially", async () => {
  render(<TodayRoute />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Start this day’s journal" }),
  );
  await waitFor(() =>
    expect(window.vaultAPI.createDay).toHaveBeenCalledWith(
      "/vault",
      localDate(),
    ),
  );
  expect(
    screen.getByText("The day unfolding").closest("details"),
  ).not.toHaveAttribute("open");
});
it("never displays a previous day under a new date while loading", async () => {
  vi.mocked(window.vaultAPI.readDay).mockResolvedValue({
    success: true,
    data: { ...empty, brief: "Only yesterday" },
  });
  render(<TodayRoute />);
  await screen.findByText("Only yesterday");
  vi.mocked(window.vaultAPI.readDay).mockImplementation(
    () => new Promise(() => undefined),
  );
  fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
  expect(screen.queryByText("Only yesterday")).not.toBeInTheDocument();
});
it("ignores an old date response that resolves after a newer request", async () => {
  render(<TodayRoute />);
  await screen.findByText("A little focus");
  let resolveOld: (value: unknown) => void = () => undefined;
  vi.mocked(window.vaultAPI.readDay)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockImplementationOnce((_root, date) =>
      Promise.resolve({
        success: true,
        data: { ...empty, date, brief: "New day" },
      }),
    );
  fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
  await waitFor(() => expect(window.vaultAPI.readDay).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
  await screen.findByText("New day");
  await act(async () =>
    resolveOld({ success: true, data: { ...empty, brief: "Late old day" } }),
  );
  expect(screen.queryByText("Late old day")).not.toBeInTheDocument();
});
it("persists privacy after the shortcut and hides associated photos", async () => {
  vi.mocked(window.vaultAPI.readDay).mockResolvedValue({
    success: true,
    data: { ...empty, photos: ["/vault/Photos/a.jpg"] },
  });
  render(<TodayRoute />);
  await screen.findByText("Photos are hidden with your journal.");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "j", ctrlKey: true, shiftKey: true });
  await waitFor(() =>
    expect(localStorage.getItem("opal.today.journal-hidden")).toBe("false"),
  );
  expect(screen.getByRole("img")).toBeInTheDocument();
});
it("adds an intention scoped to the displayed day", async () => {
  render(<TodayRoute />);
  await screen.findByText("A little focus");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Add a daily intention" }),
    { target: { value: "Take a walk" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Add intention" }));
  await waitFor(() =>
    expect(window.vaultAPI.addFocus).toHaveBeenCalledWith(
      "/vault",
      localDate(),
      { title: "Take a walk" },
    ),
  );
  expect(
    screen.getByRole("textbox", { name: "Add a daily intention" }),
  ).toHaveValue("");
});
it("exposes real queue context and adds a source task without completing it", async () => {
  vi.mocked(window.vaultAPI.readDay).mockResolvedValue({
    success: true,
    data: {
      ...empty,
      tasks: [
        {
          id: "t1",
          title: "Review proposal",
          source: "triage",
          sourcePath: "/vault/RAM/triage/state.json",
          status: "suggested",
          context: "A proposal from yesterday’s meeting",
        },
      ],
    },
  });
  render(<TodayRoute />);
  await screen.findByText("A little focus");
  expect(screen.queryByText("Review proposal")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /Choose from your queue/ }),
  );
  fireEvent.click(screen.getByText("Review proposal"));
  expect(
    screen.getByText("A proposal from yesterday’s meeting"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add to focus" }));
  await waitFor(() =>
    expect(window.vaultAPI.addFocus).toHaveBeenCalledWith(
      "/vault",
      localDate(),
      { title: "Review proposal", taskId: "t1" },
    ),
  );
});
it("supports undo and removal of completed focus", async () => {
  vi.mocked(window.vaultAPI.readDay).mockResolvedValue({
    success: true,
    data: {
      ...empty,
      focus: [
        {
          id: "f1",
          title: "Take a walk",
          completed: true,
          createdAt: "2026-09-08T12:00:00Z",
        },
      ],
    },
  });
  render(<TodayRoute />);
  await screen.findByText("1 thing done");
  fireEvent.click(screen.getByText("1 thing done"));
  fireEvent.click(
    screen.getByRole("button", { name: "Undo completion of Take a walk" }),
  );
  await waitFor(() =>
    expect(window.vaultAPI.updateFocus).toHaveBeenCalledWith(
      "/vault",
      localDate(),
      "f1",
      { completed: false },
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Remove Take a walk from focus" }),
    ).not.toBeDisabled(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Take a walk from focus" }),
  );
  await waitFor(() =>
    expect(window.vaultAPI.updateFocus).toHaveBeenCalledWith(
      "/vault",
      localDate(),
      "f1",
      { remove: true },
    ),
  );
});
it("keeps last loaded content and offers retry on failed refresh", async () => {
  vi.mocked(window.vaultAPI.readDay)
    .mockResolvedValueOnce({
      success: true,
      data: { ...empty, brief: "Saved briefing" },
    })
    .mockResolvedValue({ success: false, error: "Vault unavailable" });
  render(<TodayRoute />);
  await screen.findByText("Saved briefing");
  fireEvent.click(screen.getByRole("button", { name: "Refresh day" }));
  await screen.findByRole("alert");
  expect(screen.getByText("Saved briefing")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
it("shows a concise briefing with expansion and source freshness", async () => {
  vi.mocked(window.vaultAPI.readDay).mockResolvedValue({
    success: true,
    data: {
      ...empty,
      brief: "- First item\n- Second item\n- Third item\n- Fourth item",
      digestPath: "/vault/Inbox/Digests/day.md",
      digestUpdatedAt: 1788883200000,
    },
  });
  render(<TodayRoute />);
  await screen.findByText("First item");
  expect(screen.queryByText("Fourth item")).not.toBeInTheDocument();
  expect(screen.getByText(/Source updated/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Read 1 more" }));
  expect(screen.getByText("Fourth item")).toBeInTheDocument();
});
it("refreshes relevant sources without watching every vault directory", async () => {
  render(<TodayRoute />);
  await screen.findByText("A little focus");
  const handler = vi.mocked(window.diskAPI.onChanged).mock.calls.at(-1)?.[0];
  if (!handler) throw new Error("Missing directory watcher");
  const initial = vi.mocked(window.vaultAPI.readDay).mock.calls.length;
  vi.useFakeTimers();
  try {
    act(() => handler({ directories: ["/vault/Projects/unrelated"] }));
    await act(async () => {
      vi.advanceTimersByTime(450);
    });
    expect(window.vaultAPI.readDay).toHaveBeenCalledTimes(initial);
    act(() => handler({ directories: ["/vault/RAM"] }));
    await act(async () => {
      vi.advanceTimersByTime(450);
    });
    expect(window.vaultAPI.readDay).toHaveBeenCalledTimes(initial + 1);
    expect(
      screen.getByRole("textbox", { name: "Add a daily intention" }),
    ).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("retains a chosen task’s context and source after it leaves the queue", async () => {
  vi.mocked(window.vaultAPI.readDay).mockResolvedValue({
    success: true,
    data: {
      ...empty,
      focus: [
        {
          id: "f1",
          title: "Review proposal",
          completed: false,
          createdAt: "2026-09-08T12:00:00Z",
          taskId: "t1",
          source: {
            id: "t1",
            title: "Review proposal",
            source: "triage",
            sourcePath: "/vault/RAM/triage/state.json",
            status: "suggested",
            context: "Yesterday’s meeting notes",
          },
        },
      ],
    },
  });
  render(<TodayRoute />);
  fireEvent.click(await screen.findByText("Context"));
  expect(screen.getByText("Yesterday’s meeting notes")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Open source ↗" }));
  expect(navigateFiles).toHaveBeenCalled();
});
