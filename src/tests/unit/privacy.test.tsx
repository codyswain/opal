import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrivacyBoundary } from "@/renderer/features/privacy/PrivacyBoundary";
import { usePrivacyStore } from "@/renderer/features/privacy/privacyStore";
import { usePaletteStore } from "@/renderer/features/commands/store/paletteStore";

beforeEach(() => {
  localStorage.clear();
  usePrivacyStore.setState({ shielded: false });
  usePaletteStore.setState({ open: false });
});
afterEach(() => {
  act(() => usePrivacyStore.setState({ shielded: false }));
});

it("hides the whole workspace while keeping unsaved component state mounted", () => {
  const unmount = vi.fn();
  function Draft() {
    const [text, setText] = useState("Private");
    useEffect(() => unmount, []);
    return (
      <input
        aria-label="Writing"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    );
  }
  render(
    <PrivacyBoundary>
      <Draft />
    </PrivacyBoundary>,
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Unsaved writing" },
  });
  act(() => usePrivacyStore.getState().shield());
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(document.body).toHaveAttribute("data-opal-shield", "true");
  expect(unmount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Return to Opal" }));
  expect(screen.getByRole("textbox")).toHaveValue("Unsaved writing");
});
it("works from any route, closes the palette, and requires explicit reveal", () => {
  render(
    <PrivacyBoundary>
      <p>Files and search results</p>
      {createPortal(
        <div role="dialog">Private search result</div>,
        document.body,
      )}
    </PrivacyBoundary>,
  );
  usePaletteStore.getState().show();
  fireEvent.keyDown(window, { key: "H", metaKey: true, shiftKey: true });
  expect(usePrivacyStore.getState().shielded).toBe(true);
  expect(usePaletteStore.getState().open).toBe(false);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(usePrivacyStore.getState().shielded).toBe(true);
  expect(localStorage.getItem("opal.privacy.shield")).toContain("true");
  fireEvent.keyDown(window, { key: "H", metaKey: true, shiftKey: true });
  expect(usePrivacyStore.getState().shielded).toBe(false);
});
it("suppresses app keyboard handlers while shielded", () => {
  render(
    <PrivacyBoundary>
      <p>Private</p>
    </PrivacyBoundary>,
  );
  act(() => usePrivacyStore.getState().shield());
  const command = vi.fn();
  window.addEventListener("keydown", command);
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  expect(command).not.toHaveBeenCalled();
  window.removeEventListener("keydown", command);
});
