import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { JournalDraftGuard } from "@/renderer/features/today/JournalDraftGuard";
import { useJournalStore } from "@/renderer/features/today/journalStore";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
vi.mock("@/renderer/features/shell", () => ({
  useShell: () => ({ navigateFiles: vi.fn() }),
}));
beforeEach(() => {
  useJournalStore.setState({
    drafts: {},
    hydrated: false,
    hydrationError: undefined,
  });
  useDiskStore.setState({ roots: [] });
  window.vaultAPI = {
    discover: vi.fn(),
    readDay: vi.fn(),
    createDay: vi.fn(),
    addFocus: vi.fn(),
    updateFocus: vi.fn(),
    listDrafts: vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: [
          {
            path: "/vault/Inbox/Logs/2026-09-01.md",
            baseJournal: "Old",
            text: "Recovered private text",
            version: "v",
          },
        ],
      }),
    putDraft: vi.fn().mockResolvedValue({ success: true }),
    clearDraft: vi.fn().mockResolvedValue({ success: true }),
    saveJournal: vi.fn(),
  };
});
it("allows closing with durable recovery and exposes writing only after explicit review", async () => {
  render(<JournalDraftGuard />);
  await screen.findByRole("button", { name: "Review protected writing (1)" });
  expect(screen.queryByText("Recovered private text")).not.toBeInTheDocument();
  const closing = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(closing);
  expect(closing.defaultPrevented).toBe(false);
  expect(window.vaultAPI.saveJournal).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review protected writing (1)" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review 2026-09-01" }));
  expect(await screen.findByRole("textbox")).toHaveTextContent(
    "Recovered private text",
  );
  act(() => window.dispatchEvent(new Event("opal:journal-hidden")));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it("only blocks closing for versions not yet protected", async () => {
  render(<JournalDraftGuard />);
  await screen.findByRole("button", { name: "Review protected writing (1)" });
  act(() =>
    useJournalStore.setState((state) => ({
      drafts: {
        ...state.drafts,
        "/unsafe": {
          original: "Old",
          text: "Unsaved",
          version: "u",
          status: "error",
          durable: false,
        },
      },
    })),
  );
  const closing = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(closing);
  expect(closing.defaultPrevented).toBe(true);
  act(() =>
    useJournalStore.setState((state) => ({
      drafts: {
        ...state.drafts,
        "/unsafe": { ...state.drafts["/unsafe"], durable: true },
      },
    })),
  );
  const retry = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(retry);
  expect(retry.defaultPrevented).toBe(false);
});
it("checks for additional recovery after opened folders change", async () => {
  render(<JournalDraftGuard />);
  await screen.findByRole("button", { name: "Review protected writing (1)" });
  window.vaultAPI.listDrafts = vi
    .fn()
    .mockResolvedValue({
      success: true,
      data: [
        {
          path: "/new/Inbox/Logs/2026-09-02.md",
          baseJournal: "Old",
          text: "Other recovered",
          version: "v2",
        },
      ],
    });
  act(() => useDiskStore.setState({ roots: ["/new"] }));
  await waitFor(() =>
    expect(
      useJournalStore.getState().drafts["/new/Inbox/Logs/2026-09-02.md"]?.text,
    ).toBe("Other recovered"),
  );
});
