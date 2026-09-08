import React, { useEffect, useState } from "react";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { focusFile } from "@/renderer/features/disk-explorer/navigation";
import { useShell } from "@/renderer/features/shell";
import { usePrivacyStore } from "@/renderer/features/privacy/privacyStore";
import { useJournalStore } from "./journalStore";
import { JournalPanel } from "./JournalPanel";
import "./journal.css";

/** Global recovery stays available on every route; only unprotected versions block exit. */
export function JournalDraftGuard() {
  const drafts = useJournalStore((state) => state.drafts);
  const hydrationError = useJournalStore((state) => state.hydrationError);
  const roots = useDiskStore((state) => state.roots);
  const shielded = usePrivacyStore((state) => state.shielded);
  const { navigateFiles } = useShell();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    void useJournalStore.getState().hydrate(true);
  }, [roots]);
  useEffect(() => {
    if (shielded) {
      setExpanded(false);
      setSelected(null);
    }
  }, [shielded]);
  useEffect(() => {
    const beforeClose = (event: BeforeUnloadEvent) => {
      const store = useJournalStore.getState();
      const unprotected = Object.entries(store.drafts).filter(
        ([, draft]) => draft.status !== "saved" && !draft.durable,
      );
      if (!unprotected.length) return;
      event.preventDefault();
      event.returnValue = "";
      for (const [path, draft] of unprotected)
        if (draft.status !== "error" && !draft.recovered) void store.save(path);
    };
    const hideRecovery = () => {
      setExpanded(false);
      setSelected(null);
    };
    window.addEventListener("beforeunload", beforeClose);
    window.addEventListener("opal:journal-hidden", hideRecovery);
    return () => {
      window.removeEventListener("beforeunload", beforeClose);
      window.removeEventListener("opal:journal-hidden", hideRecovery);
    };
  }, []);
  const pending = Object.entries(drafts).filter(
    ([, draft]) => draft.recovered || draft.status === "error",
  );
  if (!pending.length && !hydrationError) return null;
  const protectedWriting = pending.every(([, draft]) => draft.durable);
  const label = hydrationError
    ? "Check journal recovery"
    : `Review ${protectedWriting ? "protected writing" : "unsaved writing"} (${pending.length})`;
  return (
    <aside
      className={`journal-recovery-hub${expanded ? " is-expanded" : ""}`}
      aria-label="Journal recovery"
    >
      {!expanded ? (
        <button
          className="journal-recovery-indicator"
          onClick={() => setExpanded(true)}
        >
          {label}
        </button>
      ) : (
        <>
          <div className="journal-recovery-heading">
            <h2>Your writing is here</h2>
            <button
              aria-label="Close journal recovery"
              onClick={() => {
                setExpanded(false);
                setSelected(null);
              }}
            >
              Close
            </button>
          </div>
          <p className="journal-recovery-explanation">
            Protected drafts stay on this device when you quit. Review an entry
            before saving it to your vault.
          </p>
          {hydrationError && (
            <p role="alert">
              Recovery could not be checked.{" "}
              <button
                onClick={() => void useJournalStore.getState().hydrate(true)}
              >
                Try again
              </button>
            </p>
          )}
          <div className="journal-recovery-entries">
            {pending.map(([path, draft]) => {
              const name =
                path.split("/").pop()?.replace(/\.md$/, "") ?? "Journal";
              return (
                <button
                  key={path}
                  aria-label={`Review ${name}`}
                  aria-pressed={selected === path}
                  onClick={() => setSelected(path)}
                >
                  <span>{name}</span>
                  <small>
                    {draft.durable
                      ? "Protected on this device"
                      : "Keep this window open"}
                  </small>
                </button>
              );
            })}
          </div>
          {selected && drafts[selected] && (
            <JournalPanel
              key={selected}
              path={selected}
              journal={drafts[selected].original}
              hidden={false}
              onOpen={() =>
                navigateFiles(
                  focusFile(
                    selected.slice(0, selected.lastIndexOf("/")),
                    selected,
                  ),
                )
              }
            />
          )}
        </>
      )}
    </aside>
  );
}
