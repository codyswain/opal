import React, { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { TodayRoute } from "@/renderer/features/today/TodayRoute";
import type { VaultDay } from "@/types/vault";
import { localDate } from "@/common/vaultModel";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { installDiskApi } from "@/tests/helpers/diskApi";

import { useChatHandoffStore } from "@/renderer/features/chat";

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
  useChatHandoffStore.setState({
    pending: [],
    drafts: {},
    processing: false,
    error: null,
  });
  localStorage.clear();
  installDiskApi({
    listRoots: vi.fn().mockResolvedValue({ success: true, data: ["/vault"] }),
  });
  useDiskStore.setState({ roots: ["/vault"] });
  window.vaultAPI = {
    discover: vi.fn().mockResolvedValue({
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
    screen.getByRole("button", { name: "Show journal & photos" }),
  );
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
  await screen.findByText("To do");
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
  await screen.findByText("To do");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "j", ctrlKey: true, shiftKey: true });
  await waitFor(() =>
    expect(localStorage.getItem("opal.today.journal-hidden")).toBe("false"),
  );
  expect(screen.getByRole("img")).toBeInTheDocument();
});
it("adds an intention scoped to the displayed day", async () => {
  render(<TodayRoute />);
  await screen.findByText("To do");
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
  await screen.findByText("To do");
  expect(screen.getByText("Review proposal")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Details for Review proposal" }),
  );
  expect(
    screen.getByText("A proposal from yesterday’s meeting"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add to today" }));
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
  await screen.findByText("To do");
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
  fireEvent.click(
    await screen.findByRole("button", { name: "Details for Review proposal" }),
  );
  expect(screen.getByText("Yesterday’s meeting notes")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Open source" }));
  expect(navigateFiles).toHaveBeenCalled();
});

it("removes the entire journal and photo sections when hidden", async () => {
  vi.mocked(window.vaultAPI.readDay).mockResolvedValue({
    success: true,
    data: { ...empty, photos: ["/vault/Photos/a.jpg"] },
  });
  render(<TodayRoute />);
  await screen.findByText("To do");
  expect(
    screen.queryByRole("heading", { name: "Your journal" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Daily photos")).not.toBeInTheDocument();
  expect(screen.queryByText("Hidden from view")).not.toBeInTheDocument();
});
it("remembers layout width and ordering and resets them", async () => {
  render(<TodayRoute />);
  await screen.findByText("To do");
  fireEvent.click(screen.getByText("Layout"));
  fireEvent.click(
    screen.getByRole("button", { name: "Show journal & photos" }),
  );
  fireEvent.change(screen.getByRole("slider", { name: "Journal width" }), {
    target: { value: "45" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Tasks first" }));
  expect(localStorage.getItem("opal.today.journal-width")).toBe("45");
  expect(localStorage.getItem("opal.today.tasks-first")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
  expect(localStorage.getItem("opal.today.journal-width")).toBe("55");
});

it("searches task context, filters sources, and adds without opening details", async () => {
  vi.mocked(window.vaultAPI.readDay).mockResolvedValue({
    success: true,
    data: {
      ...empty,
      tasks: [
        {
          id: "one",
          title: "Review proposal",
          source: "markdown",
          sourcePath: "/vault/RAM/todo.md",
          status: "open",
          context: "Budget for September",
        },
        {
          id: "two",
          title: "Book appointment",
          source: "triage",
          sourcePath: "/vault/RAM/triage/state.json",
          status: "suggested",
        },
      ],
    },
  });
  render(<TodayRoute />);
  await screen.findByText("Review proposal");
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search task queue" }),
    { target: { value: "budget" } },
  );
  expect(screen.queryByText("Book appointment")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Add Review proposal to today" }),
  );
  await waitFor(() =>
    expect(window.vaultAPI.addFocus).toHaveBeenCalledWith(
      "/vault",
      localDate(),
      { title: "Review proposal", taskId: "one" },
    ),
  );
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search task queue" }),
    { target: { value: "" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Suggestions" }));
  expect(screen.queryByText("Review proposal")).not.toBeInTheDocument();
  expect(screen.getByText("Book appointment")).toBeInTheDocument();
});

it("offers separate day and queue views with priority sorting and remembered density", async () => {
  vi.mocked(window.vaultAPI.readDay).mockResolvedValue({
    success: true,
    data: {
      ...empty,
      tasks: [
        {
          id: "one",
          title: "[P2] Write notes",
          source: "markdown",
          sourcePath: "/vault/RAM/todo.md",
          status: "open",
        },
        {
          id: "two",
          title: "[P0] Reply today",
          source: "markdown",
          sourcePath: "/vault/RAM/todo.md",
          status: "open",
        },
      ],
    },
  });
  render(<TodayRoute />);
  const queue = await screen.findByRole("tabpanel", {
    name: /Your queue/,
  });
  expect(
    within(queue).getAllByRole("button", { name: /Details for/ })[0],
  ).toHaveAccessibleName("Details for [P0] Reply today");
  fireEvent.click(screen.getByRole("button", { name: "Compact task rows" }));
  expect(localStorage.getItem("opal.today.task-compact")).toContain("true");
  fireEvent.change(screen.getByRole("combobox", { name: "Sort tasks" }), {
    target: { value: "source" },
  });
  expect(
    within(queue).getAllByRole("button", { name: /Details for/ })[0],
  ).toHaveAccessibleName("Details for [P2] Write notes");
  fireEvent.click(screen.getByRole("tab", { name: /For this day/ }));
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  expect(screen.getByText("What deserves your attention?")).toBeInTheDocument();
});
it("prepares task context for chat without sending a message", async () => {
  vi.mocked(window.vaultAPI.readDay).mockResolvedValue({
    success: true,
    data: {
      ...empty,
      tasks: [
        {
          id: "one",
          title: "Review proposal",
          source: "markdown",
          sourcePath: "/vault/RAM/todo.md",
          status: "open",
          context: "Yesterday’s notes",
        },
      ],
    },
  });
  render(<TodayRoute />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Details for Review proposal" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Think it through" }));
  expect(useChatHandoffStore.getState().pending).toEqual([
    {
      title: "Review proposal",
      sourcePath: "/vault/RAM/todo.md",
      context: "Yesterday’s notes",
      date: localDate(),
    },
  ]);
});

it('rolls the live Today page forward across midnight', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 9, 23, 59, 59));
  let view: ReturnType<typeof render> | undefined;
  try {
    await act(async () => { view = render(<TodayRoute />); });
    expect(screen.getByLabelText('Choose day')).toHaveValue('2026-09-09');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByLabelText('Choose day')).toHaveValue('2026-09-10');
    expect(window.vaultAPI.readDay).toHaveBeenLastCalledWith('/vault', '2026-09-10');
  } finally { view?.unmount(); vi.useRealTimers(); }
});

it('keeps a selected past day on resume and returns to live Today', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 9, 12));
  let view: ReturnType<typeof render> | undefined;
  try {
    await act(async () => { view = render(<TodayRoute />); });
    fireEvent.change(screen.getByLabelText('Choose day'), { target: { value: '2026-09-05' } });
    vi.setSystemTime(new Date(2026, 8, 10, 12));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(screen.getByLabelText('Choose day')).toHaveValue('2026-09-05');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByLabelText('Choose day')).toHaveValue('2026-09-10');
    vi.setSystemTime(new Date(2026, 8, 11, 12));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(screen.getByLabelText('Choose day')).toHaveValue('2026-09-11');
  } finally { view?.unmount(); vi.useRealTimers(); }
});
