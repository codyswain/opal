import React, { useEffect, useState } from "react";
import { useJournalStore } from "./journalStore";
import { JournalEditor } from "./JournalEditor";
import "./journal.css";

export function JournalPanel({
  path,
  journal,
  hidden,
  onOpen,
}: {
  path: string;
  journal: string;
  hidden: boolean;
  onOpen: () => void;
}) {
  const [checkedPath, setCheckedPath] = useState<string | null>(null);
  const draft = useJournalStore((state) => state.drafts[path]);
  const hydrated = useJournalStore((state) => state.hydrated);
  const hydrationError = useJournalStore((state) => state.hydrationError);
  const { seed, edit, save, reload, hydrate } = useJournalStore.getState();
  useEffect(() => {
    seed(path, journal);
  }, [path, journal, seed]);
  useEffect(() => {
    if (hidden) window.dispatchEvent(new Event("opal:journal-hidden"));
  }, [hidden]);
  useEffect(() => {
    let alive = true;
    void hydrate(true).then(() => {
      if (alive) setCheckedPath(path);
    });
    return () => {
      alive = false;
    };
  }, [path, hydrate]);
  const ready = hydrated && checkedPath === path && !hydrationError;
  useEffect(() => {
    if (draft?.status !== "dirty" || draft.recovered) return;
    const timer = setTimeout(() => void save(path), 800);
    return () => clearTimeout(timer);
  }, [path, draft?.text, draft?.status, draft?.recovered, save]);
  useEffect(
    () => () => {
      const current = useJournalStore.getState().drafts[path];
      if (current && !current.recovered && current.status !== "error")
        void save(path);
    },
    [path, save],
  );
  const status = !ready
    ? "Checking recovery…"
    : draft?.status === "saving"
      ? "Saving…"
      : draft?.status === "error"
        ? "Not saved"
        : draft?.recovered
          ? "Recovered writing · review before saving"
          : draft?.status === "dirty"
            ? draft.durable
              ? "Draft protected on this device"
              : "Protecting draft…"
            : "Saved to your vault";
  return (
    <div className="journal-panel">
      {hidden ? (
        <p className="today-empty journal-hidden">
          Your writing is hidden. A little space, just for you.
        </p>
      ) : !ready ? (
        <p className="today-empty">Opening your writing…</p>
      ) : (
        <JournalEditor
          key={path}
          text={draft?.text ?? journal}
          onChange={(text) => edit(path, text)}
          onSave={() => {
            if (!useJournalStore.getState().drafts[path]?.recovered)
              void save(path);
          }}
        />
      )}
      <div className="today-footnote journal-footer">
        <span role="status">{status}</span>
        <div className="journal-file-actions">
          <button
            onClick={() => void save(path)}
            disabled={
              !ready ||
              !draft ||
              draft.status === "saved" ||
              draft.status === "saving"
            }
          >
            Save now
          </button>
          {!hidden && <button onClick={onOpen}>Open daily file ↗</button>}
        </div>
      </div>
      {hydrationError && (
        <div role="alert" className="today-error">
          Recovery could not be checked: {hydrationError}{" "}
          <button onClick={() => void hydrate()}>Try again</button>
        </div>
      )}
      {draft?.error && (
        <div role="alert" className="today-error journal-recovery">
          {draft.error}{" "}
          {draft.durable
            ? "Your draft is protected on this device."
            : "Keep this window open; this draft has not reached recovery storage."}
          <div>
            <button onClick={() => void save(path)}>Retry save</button>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "Discard this unsaved journal draft and load the current file? This does not change the vault file.",
                  )
                )
                  void reload(path);
              }}
            >
              Use saved version
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
