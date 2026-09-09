import React, { useEffect, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  RefreshCw,
  Sun,
  Search,
} from "lucide-react";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { focusFile } from "@/renderer/features/disk-explorer/navigation";
import { useShell } from "@/renderer/features/shell";
import { toOpalFileUrl } from "@/common/opalFileUrl";
import {
  localDate,
  shiftDate,
  splitDailyLog,
  validDate,
} from "@/common/vaultModel";
import { JournalPanel } from "./JournalPanel";
import { DailyBrief, DailyFocus, Markdown } from "./TodayContext";
import { useVaultDay } from "./useVaultDay";
import "./today.css";
import { useChatHandoffStore } from "@/renderer/features/chat";
import { usePaletteStore } from "@/renderer/features/commands/store/paletteStore";

function usePreference(
  key: string,
  fallback: string,
): [string, (value: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  });
  return [
    value,
    (next) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* Session preference is still usable. */
      }
    },
  ];
}

export function TodayRoute() {
  const { navigateFiles, location, navigateTo } = useShell();
  const dateParam = new URLSearchParams(location.search).get("date");
  const day = dateParam && validDate(dateParam) ? dateParam : localDate();
  const setDay = (next: string) => {
    const search = new URLSearchParams(location.search);
    search.set("date", next);
    navigateTo({ pathname: location.pathname, search: search.toString() });
  };
  const [selectedRoot, selectRoot] = usePreference("opal.today.vault", "");
  const [privacy, setPrivacy] = usePreference(
    "opal.today.journal-hidden",
    "true",
  );
  const hidden = privacy === "true";
  const [widthPref, setWidth] = usePreference("opal.today.journal-width", "55");
  const [orderPref, setOrder] = usePreference(
    "opal.today.tasks-first",
    "false",
  );
  const journalWidth = Math.max(35, Math.min(70, Number(widthPref) || 55));
  const tasksFirst = orderPref === "true";
  useEffect(() => {
    if (hidden) window.dispatchEvent(new Event("opal:journal-hidden"));
  }, [hidden]);
  const {
    vaults,
    root,
    data,
    discovering,
    loading,
    busy,
    error,
    refresh,
    mutate,
  } = useVaultDay(selectedRoot, day);
  const openSource = (path: string) =>
    navigateFiles(focusFile(path.slice(0, path.lastIndexOf("/")), path));
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "j"
      ) {
        event.preventDefault();
        setPrivacy(hidden ? "false" : "true");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hidden, setPrivacy]);
  const date = new Date(`${day}T12:00:00`);
  const label = date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const parts = splitDailyLog(data?.document?.body ?? "");
  const activity = parts.activity
    .replace(/^##[^\n]*\n?/, "")
    .split("\n")
    .filter((line) => /^\s*[-*]\s+/.test(line));
  return (
    <div
      className={`today-page${hidden ? " journal-is-hidden" : ""}${tasksFirst ? " tasks-first" : ""}`}
      aria-label="Today workspace"
      style={
        {
          "--journal-share": `${journalWidth}fr`,
          "--task-share": `${100 - journalWidth}fr`,
        } as React.CSSProperties
      }
    >
      <div className="today-wrap">
        <header className="today-heading">
          <button
            className="today-search-launch"
            onClick={() => usePaletteStore.getState().show()}
          >
            <Search size={14} /> Search your vault <kbd>⌘ K</kbd>
          </button>
          <p className="today-eyebrow">
            <Sun size={15} strokeWidth={1.4} /> A little space for your day
          </p>
          <h1>
            {date.toLocaleDateString(undefined, { weekday: "long" })}
            <span>
              {date.toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
              })}
            </span>
          </h1>
          <p className="today-subtitle">
            {day === localDate()
              ? "Make room for what matters. Let the rest unfold."
              : "A day to return to. A thought to pick up."}
          </p>
        </header>
        <div className="today-toolbar">
          <nav className="today-date-controls" aria-label="Daily navigation">
            <button
              aria-label="Previous day"
              onClick={() => setDay(shiftDate(day, -1))}
            >
              <ChevronLeft size={16} />
            </button>
            <label className="today-date">
              <CalendarDays size={14} />
              <input
                aria-label="Choose day"
                type="date"
                value={day}
                onChange={(event) => {
                  if (validDate(event.target.value)) setDay(event.target.value);
                }}
              />
            </label>
            <button
              aria-label="Next day"
              onClick={() => setDay(shiftDate(day, 1))}
            >
              <ChevronRight size={16} />
            </button>
            {day !== localDate() && (
              <button onClick={() => setDay(localDate())}>Today</button>
            )}
          </nav>
          <span className="today-toolbar-spacer" />
          {vaults.length > 1 && (
            <select
              aria-label="Daily vault"
              value={root}
              onChange={(event) => selectRoot(event.target.value)}
            >
              {vaults.map((vault) => (
                <option key={vault.path} value={vault.path}>
                  {vault.name}
                </option>
              ))}
            </select>
          )}
          <button
            aria-label="Refresh day"
            onClick={refresh}
            disabled={loading}
            title="Refresh from your vault"
          >
            <RefreshCw
              size={14}
              className={loading ? "today-refreshing" : ""}
            />
          </button>
          <details className="today-layout-settings">
            <summary>Layout</summary>
            <div className="today-layout-options">
              <p>Arrange your workspace</p>
              <label>
                Journal width <span>{journalWidth}%</span>
                <input
                  aria-label="Journal width"
                  type="range"
                  min="35"
                  max="70"
                  value={journalWidth}
                  disabled={hidden}
                  onChange={(event) => setWidth(event.target.value)}
                />
              </label>
              {hidden && <small>Show your journal to adjust its width.</small>}
              <button
                aria-pressed={tasksFirst}
                onClick={() => setOrder(tasksFirst ? "false" : "true")}
              >
                Tasks first
              </button>
              <button
                onClick={() => {
                  setWidth("55");
                  setOrder("false");
                }}
              >
                Reset layout
              </button>
            </div>
          </details>
          <button
            className="today-privacy"
            aria-pressed={hidden}
            onClick={() => setPrivacy(hidden ? "false" : "true")}
            title="Cmd/Ctrl+Shift+J"
          >
            {hidden ? <Eye size={14} /> : <EyeOff size={14} />}
            <span>
              {hidden ? "Show journal & photos" : "Hide journal & photos"}
            </span>
          </button>
        </div>
        {error && (
          <div className="today-error" role="alert">
            {error}
            {data && <span> Showing the last loaded version.</span>}{" "}
            <button onClick={refresh}>Try again</button>
          </div>
        )}
        {discovering && !root ? (
          <p role="status" className="today-empty">
            Finding your vault…
          </p>
        ) : !root ? (
          <section className="today-welcome">
            <span className="today-overline">Your own starting point</span>
            <h2>A home for your day</h2>
            <p>
              Open a vault with daily logs in Inbox/Logs. Your writing,
              priorities, and the things worth remembering will meet here.
            </p>
            <button onClick={() => void useDiskStore.getState().openFolder()}>
              Open vault folder
            </button>
          </section>
        ) : (
          <>
            {loading && !data && (
              <p role="status" className="today-empty">
                Opening your day…
              </p>
            )}
            {data && (
              <div className="today-columns" key={`${root}:${day}`}>
                <main className="today-main">
                  <section
                    hidden={hidden}
                    className="today-writing"
                    aria-labelledby="journal-title"
                  >
                    <div className="today-section-heading">
                      <h2 id="journal-title">Your journal</h2>
                      <span className="today-count">Just for you</span>
                    </div>
                    {data.document ? (
                      <JournalPanel
                        path={data.document.path}
                        journal={parts.journal}
                        hidden={hidden}
                        onOpen={() => openSource(data.document?.path ?? "")}
                      />
                    ) : (
                      <div className="today-blank-page">
                        <span className="today-overline">
                          {date.toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <p>
                          Nothing to catch up on here.
                          <br />
                          Just a little space to begin.
                        </p>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void mutate(() =>
                              window.vaultAPI.createDay(root, day),
                            )
                          }
                        >
                          Start this day’s journal{" "}
                          <span aria-hidden="true">↗</span>
                        </button>
                        <small>A new page in your vault, for {label}.</small>
                      </div>
                    )}
                  </section>
                  <details className="today-activity">
                    <summary>
                      <span>The day unfolding</span>
                      <span className="today-count">
                        {activity.length}{" "}
                        {activity.length === 1 ? "entry" : "entries"}
                      </span>
                    </summary>
                    <p className="today-caption">
                      A quiet record from your routines.
                    </p>
                    {activity.length ? (
                      <ol className="today-timeline">
                        {activity.map((line, index) => {
                          const event = line.replace(/^\s*[-*]\s+/, "");
                          const match = event.match(
                            /^(\d{1,2}:\d{2})\s*[—–-]\s*(.*)$/,
                          );
                          return (
                            <li key={index}>
                              <time>{match?.[1] ?? "·"}</time>
                              <Markdown>{match?.[2] ?? event}</Markdown>
                            </li>
                          );
                        })}
                      </ol>
                    ) : (
                      <p className="today-empty">
                        No activity recorded for this day. Entries from your
                        routines will appear here.
                      </p>
                    )}
                  </details>
                  {!hidden && !!data.photos.length && (
                    <section
                      className="today-moments"
                      aria-label="Daily photos"
                    >
                      <div className="today-section-heading">
                        <h2>Small moments</h2>
                        <span className="today-count">
                          {data.photos.length} photos
                        </span>
                      </div>
                      {hidden ? (
                        <p className="today-caption">
                          Photos are hidden with your journal.
                        </p>
                      ) : (
                        <div className="today-photos">
                          {data.photos.map((path) => (
                            <button
                              key={path}
                              aria-label={`Open photo ${path.split("/").pop()}`}
                              onClick={() => openSource(path)}
                            >
                              <img
                                src={toOpalFileUrl(path)}
                                alt={path.split("/").pop()}
                                loading="lazy"
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                </main>
                <aside className="today-aside" aria-label="Daily context">
                  <DailyFocus
                    data={data}
                    busy={busy}
                    mutate={mutate}
                    openSource={openSource}
                    onDiscuss={(task) => {
                      useChatHandoffStore.getState().prepare(task);
                      navigateTo("/chat");
                    }}
                  />
                  <DailyBrief data={data} openSource={openSource} />
                  <p className="today-footer">
                    Rooted in{" "}
                    {vaults.find((vault) => vault.path === root)?.name ??
                      "your vault"}
                    .<br />
                    Your files. Your pace.
                  </p>
                </aside>
              </div>
            )}
            {!!data?.warnings.length && (
              <details className="today-warnings">
                <summary>
                  Some sources need attention ({data.warnings.length})
                </summary>
                {data.warnings.map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
