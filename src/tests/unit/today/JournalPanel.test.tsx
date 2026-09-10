import React from "react";
import type { Editor } from "@tiptap/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { JournalPanel } from "@/renderer/features/today/JournalPanel";
import { useJournalStore } from "@/renderer/features/today/journalStore";
let mountedEditor: Editor | null = null;
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return { ...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    mountedEditor = actual.useEditor(...args);
    return mountedEditor;
  } };
});
beforeEach(() => {
  useJournalStore.setState({ drafts: {}, hydrated: false });
  window.vaultAPI = {
    discover: vi.fn(),
    readDay: vi.fn(),
    createDay: vi.fn(),
    addFocus: vi.fn(),
    updateFocus: vi.fn(),
    listDrafts: vi.fn().mockResolvedValue({ success: true as const, data: [] }),
    putDraft: vi.fn().mockResolvedValue({ success: true }),
    clearDraft: vi.fn().mockResolvedValue({ success: true }),
    saveJournal: vi.fn(async (_p, _base, text) => ({
      success: true as const,
      data: { journal: text, revision: "r" },
    })),
  };
});
it("removes private writing and source links while hidden", async () => {
  render(
    <JournalPanel
      path="/day"
      journal="Private thoughts"
      hidden
      onOpen={vi.fn()}
    />,
  );
  await waitFor(() => expect(useJournalStore.getState().hydrated).toBe(true));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByText("Private thoughts")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Open daily/ }),
  ).not.toBeInTheDocument();
});
it("renders headings without rewriting untouched Markdown", async () => {
  render(
    <JournalPanel
      path="/day"
      journal={"## A thought\n\nHello\n"}
      hidden={false}
      onOpen={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "A thought" }),
    ).toBeInTheDocument(),
  );
  expect(window.vaultAPI.saveJournal).not.toHaveBeenCalled();
});
it("falls back to source for unsupported syntax and preserves it through privacy changes", async () => {
  const props = {
    path: "/day",
    journal: "Before\n\n![[drawing.canvas]]\n",
    onOpen: vi.fn(),
  };
  const { rerender } = render(<JournalPanel {...props} hidden={false} />);
  const source = await screen.findByRole("textbox", {
    name: "Journal Markdown source",
  });
  expect(source).toHaveValue(props.journal);
  fireEvent.change(source, { target: { value: props.journal + "After" } });
  rerender(<JournalPanel {...props} hidden />);
  rerender(<JournalPanel {...props} hidden={false} />);
  expect(
    await screen.findByRole("textbox", { name: "Journal Markdown source" }),
  ).toHaveValue(props.journal + "After");
  fireEvent.click(screen.getByRole("button", { name: "Save now" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Saved to your vault"),
  );
});
it("keeps source mode focused when custom syntax is replaced with ordinary text", async () => {
  render(
    <JournalPanel
      path="/day"
      journal={"![[drawing.canvas]]"}
      hidden={false}
      onOpen={vi.fn()}
    />,
  );
  const source = await screen.findByRole("textbox", {
    name: "Journal Markdown source",
  });
  source.focus();
  await act(async () => {
    fireEvent.change(source, { target: { value: "Hello" } });
  });
  expect(screen.getByRole("textbox", { name: "Journal Markdown source" })).toBe(
    source,
  );
  expect(source).toHaveFocus();
});
it("renders an ordinary daily template with separators and blank prompts without changing its source", async () => {
  const journal =
    "## Morning\n### What matters today\n\n\n--------------\n\n## Evening\n### What I want to remember\n\n\n---\n";
  render(
    <JournalPanel
      path="/day"
      journal={journal}
      hidden={false}
      onOpen={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Daily journal" }),
    ).toBeInTheDocument(),
  );
  expect(screen.getByRole("heading", { name: "Morning" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Evening" })).toBeInTheDocument();
  expect(useJournalStore.getState().drafts["/day"].text).toBe(journal);
  expect(window.vaultAPI.saveJournal).not.toHaveBeenCalled();
});

it.each([false, true])("keeps the cursor beneath a heading when saving normalizes the final newline (blank paragraph: %s)", async (blankParagraph) => {
  vi.mocked(window.vaultAPI.saveJournal).mockImplementation(async (_path, _base, text) => ({
    success: true, data: { journal: text + "\n", revision: "saved" },
  }));
  render(<JournalPanel path="/day" journal={"## Morning\n\nFirst thought\n\n## Evening\n\nLast thought"} hidden={false} onOpen={vi.fn()} />);
  await screen.findByRole("textbox", { name: "Daily journal" });
  const editor = mountedEditor;
  if (!editor) throw new Error("Journal editor did not mount");
  await act(async () => {
    editor.commands.setTextSelection(12);
    editor.commands.insertContent("New ");
    if (blankParagraph) editor.commands.splitBlock();
  });
  const position = editor.state.selection.from;
  const document = editor.state.doc;
  await act(async () => { await useJournalStore.getState().save("/day"); });
  expect(editor.state.selection.from).toBe(position);
  expect(editor.state.doc.eq(document)).toBe(true);
  await act(async () => { editor.commands.insertContent("continued "); });
  expect(editor.state.selection.from).toBe(position + "continued ".length);
  if (!blankParagraph) expect(editor.getText()).toContain("New continued ");
});
