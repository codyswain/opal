import "./taskWorkspace.css";
import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  Plus,
  X,
  Search,
  ListFilter,
  ArrowUpRight,
  MessageSquare,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/renderer/shared/ui";
import { readPref, writePref } from "@/renderer/shared/prefs/prefs";
import type { VaultTask, VaultDay, VaultResult } from "@/types/vault";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="today-markdown prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: () => null,
          a: ({ children, href }) => <span title={href}>{children}</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function taskLabel(title: string) {
  return title.replaceAll("\\[", "[").replaceAll("\\]", "]");
}

function priority(title: string) {
  return Number(taskLabel(title).match(/^\[P([0-4])\]/i)?.[1] ?? 5);
}

export function DailyFocus({
  data,
  busy,
  mutate,
  openSource,
  onDiscuss,
}: {
  data: VaultDay;
  busy: boolean;
  mutate: (operation: () => Promise<VaultResult<unknown>>) => Promise<boolean>;
  openSource: (path: string) => void;
  onDiscuss?: (task: {
    title: string;
    context?: string;
    sourcePath?: string;
    date: string;
  }) => void;
}) {
  const [intention, setIntention] = useState("");
  const [view, setView] = useState<"today" | "queue">(() =>
    data.focus.length ? "today" : "queue",
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "suggested">("all");
  const [sort, setSort] = useState(() =>
    readPref<string>("today.task-sort", "priority"),
  );
  const [compact, setCompact] = useState(() =>
    readPref<boolean>("today.task-compact", false),
  );
  const [selected, setSelected] = useState<{
    kind: "focus" | "queue";
    id: string;
  } | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [titleError, setTitleError] = useState("");
  const savingTitle = useRef(false);
  useEffect(() => {
    setEditingTitle(null);
    setTitleError("");
  }, [selected?.id]);
  const inspectorTrigger = useRef<HTMLButtonElement | null>(null);
  const unfinished = data.focus.filter((item) => !item.completed);
  const completed = data.focus.filter((item) => item.completed);
  const available = data.tasks.filter(
    (task) =>
      taskLabel(task.title).trim() !== "[ ]" &&
      !data.focus.some((item) => item.taskId === task.id),
  );
  const matching = available
    .filter(
      (task) =>
        (filter === "all" || task.status === filter) &&
        `${task.title} ${task.context ?? ""}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === "title"
        ? taskLabel(a.title).localeCompare(taskLabel(b.title))
        : sort === "priority"
          ? priority(a.title) - priority(b.title)
          : 0,
    );
  const focus =
    selected?.kind === "focus"
      ? data.focus.find((item) => item.id === selected.id)
      : undefined;
  const queued =
    selected?.kind === "queue"
      ? data.tasks.find((item) => item.id === selected.id)
      : undefined;
  const source = focus?.source ?? queued;
  const selectedTitle = focus?.title ?? queued?.title;
  const saveTitle = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = editingTitle?.trim();
    if (!focus || !title || busy || savingTitle.current) return;
    if (title === focus.title) { setEditingTitle(null); return; }
    savingTitle.current = true;
    setTitleError("");
    try {
      if (await mutate(() => window.vaultAPI.updateFocus(data.root, data.date, focus.id, { title })))
        setEditingTitle(null);
      else setTitleError("Could not save. Your edit is still here. Try again.");
    } finally { savingTitle.current = false; }
  };
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = intention.trim();
    if (
      title &&
      (await mutate(() =>
        window.vaultAPI.addFocus(data.root, data.date, { title }),
      ))
    ) {
      setIntention((current) => (current.trim() === title ? "" : current));
      setView("today");
    }
  };
  const choose = async (task: VaultTask) => {
    if (
      await mutate(() =>
        window.vaultAPI.addFocus(data.root, data.date, {
          title: task.title,
          taskId: task.id,
        }),
      )
    ) {
      setSelected(null);
    }
  };
  const taskTitle = (title: string) => (
    <>
      <span
        className={`task-priority priority-${priority(title)}`}
        title={
          priority(title) < 5 ? `Priority ${priority(title)}` : "No priority"
        }
      >
        {priority(title) < 5 ? `P${priority(title)}` : "—"}
      </span>
      <span className="task-label">
        {taskLabel(title).replace(/^\[P[0-4]\]\s*/i, "")}
      </span>
    </>
  );
  const row = (item: VaultDay["focus"][number]) => (
    <li key={item.id} className={item.completed ? "is-complete" : ""}>
      <button
        className="today-focus-check"
        aria-label={`${item.completed ? "Undo completion of" : "Complete"} ${item.title}`}
        disabled={busy}
        onClick={() =>
          void mutate(() =>
            window.vaultAPI.updateFocus(data.root, data.date, item.id, {
              completed: !item.completed,
            }),
          )
        }
      >
        {item.completed && <Check size={13} />}
      </button>
      <button
        className="task-open"
        aria-label={`Details for ${taskLabel(item.title)}`}
        onClick={(event) => {
          inspectorTrigger.current = event.currentTarget;
          setSelected({ kind: "focus", id: item.id });
        }}
      >
        {taskTitle(item.title)}
      </button>
      <button
        className="today-focus-remove"
        aria-label={`Remove ${item.title} from focus`}
        disabled={busy}
        onClick={() =>
          void mutate(() =>
            window.vaultAPI.updateFocus(data.root, data.date, item.id, {
              remove: true,
            }),
          )
        }
      >
        <X size={14} />
      </button>
    </li>
  );
  return (
    <section
      className={`today-focus task-workspace${compact ? " is-compact" : ""}`}
      aria-labelledby="focus-title"
    >
      <div className="today-section-heading">
        <div>
          <h2 id="focus-title">To do</h2>
          <p className="task-subtitle">A clear place for your next step.</p>
        </div>
        <button
          className="task-density"
          aria-label="Compact task rows"
          aria-pressed={compact}
          onClick={() => {
            setCompact(!compact);
            writePref("today.task-compact", !compact);
          }}
        >
          <ListFilter size={15} /> Display
        </button>
      </div>
      <div role="tablist" aria-label="Task views" className="task-tabs">
        {(["today", "queue"] as const).map((tab, index) => (
          <button
            key={tab}
            role="tab"
            id={`task-tab-${tab}`}
            aria-controls={`task-panel-${tab}`}
            aria-selected={view === tab}
            tabIndex={view === tab ? 0 : -1}
            onClick={() => setView(tab)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const next = index === 0 ? "queue" : "today";
                setView(next);
                document.getElementById(`task-tab-${next}`)?.focus();
              }
            }}
          >
            {tab === "today" ? "For this day" : "Your queue"}
            <span>
              {tab === "today" ? unfinished.length : available.length}
            </span>
          </button>
        ))}
      </div>
      <form className="today-intention" onSubmit={(event) => void add(event)}>
        <Plus size={16} />
        <input
          aria-label="Add a daily intention"
          placeholder="Add a task for today…"
          maxLength={500}
          value={intention}
          onChange={(event) => setIntention(event.target.value)}
        />
        <button aria-label="Add intention" disabled={busy || !intention.trim()}>
          Add <span aria-hidden="true">↵</span>
        </button>
      </form>
      {view === "today" ? (
        <div
          role="tabpanel"
          id="task-panel-today"
          aria-labelledby="task-tab-today"
        >
          {!!data.focus.length && (
            <div className="task-progress">
              <span>
                {completed.length} of {data.focus.length} complete
              </span>
              <progress
                aria-label="Daily task progress"
                value={completed.length}
                max={data.focus.length}
              />
            </div>
          )}
          {unfinished.length ? (
            <ul className="today-focus-list">{unfinished.map(row)}</ul>
          ) : (
            <div className="task-zero">
              <Check size={22} strokeWidth={1.4} />
              <h3>
                {completed.length
                  ? "Room for what comes next."
                  : "What deserves your attention?"}
              </h3>
              <p>
                {completed.length
                  ? "Your chosen tasks are complete."
                  : "Add something above, or choose from your queue."}
              </p>
              <button onClick={() => setView("queue")}>
                Choose from your queue <span>↗</span>
              </button>
            </div>
          )}
          {!!completed.length && (
            <details className="today-completed">
              <summary>
                {completed.length} {completed.length === 1 ? "thing" : "things"}{" "}
                done
              </summary>
              <ul className="today-focus-list">{completed.map(row)}</ul>
              <p className="today-caption">
                Completed for this day. Source tasks stay unchanged.
              </p>
            </details>
          )}
        </div>
      ) : (
        <div
          role="tabpanel"
          id="task-panel-queue"
          aria-labelledby="task-tab-queue"
          className="today-queue"
          aria-label="Current task queue"
        >
          <div className="today-queue-tools">
            <label className="task-search">
              <Search size={14} />
              <input
                type="search"
                aria-label="Search task queue"
                placeholder="Search tasks or context…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <select
              aria-label="Sort tasks"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                writePref("today.task-sort", event.target.value);
              }}
            >
              <option value="priority">Priority</option>
              <option value="title">Title</option>
              <option value="source">Source order</option>
            </select>
          </div>
          <div className="task-filter-bar">
            <div role="group" aria-label="Task sources">
              {(["all", "open", "suggested"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value === "all"
                    ? "All"
                    : value === "open"
                      ? "My list"
                      : "Suggestions"}
                </button>
              ))}
            </div>
            <span>
              {matching.length} {matching.length === 1 ? "task" : "tasks"}
            </span>
          </div>
          {!matching.length && (
            <div className="task-zero">
              <Search size={22} />
              <h3>
                {search ? "No matching tasks." : "A little breathing room."}
              </h3>
              <p>
                {search
                  ? "Try another word or clear the filters."
                  : "Nothing in this view needs your attention."}
              </p>
              {(search || filter !== "all") && (
                <button
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
          <div className="task-rows">
            {matching.map((task) => (
              <div className="today-task-row" key={task.id}>
                <button
                  className="task-open"
                  aria-label={`Details for ${taskLabel(task.title)}`}
                  onClick={(event) => {
                    inspectorTrigger.current = event.currentTarget;
                    setSelected({ kind: "queue", id: task.id });
                  }}
                >
                  {taskTitle(task.title)}
                  <span className="task-source-chip">
                    {task.source === "triage" ? "Routines" : "Task list"}
                  </span>
                </button>
                <button
                  className="today-task-add"
                  disabled={busy}
                  aria-label={`Add ${task.title} to today`}
                  onClick={() => void choose(task)}
                >
                  <Plus size={14} />
                  <span>Today</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <Dialog
        open={!!selectedTitle}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          className="task-inspector"
          onEscapeKeyDown={(event) => {
            if (editingTitle !== null) {
              event.preventDefault();
              if (!savingTitle.current) { setEditingTitle(null); setTitleError(""); }
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (inspectorTrigger.current?.isConnected)
              inspectorTrigger.current.focus();
            else document.getElementById(`task-tab-${view}`)?.focus();
          }}
        >
          <DialogTitle>{taskLabel(selectedTitle ?? "Task")}</DialogTitle>
          <DialogDescription>Context for {data.date}</DialogDescription>
          {focus && (editingTitle === null ? (
            <button className="task-title-edit" onClick={() => { setEditingTitle(focus.title); setTitleError(""); }}>
              Edit task title
            </button>
          ) : (
            <form className="task-title-form" onSubmit={(event) => void saveTitle(event)}>
              <label htmlFor="daily-task-title">Daily task title</label>
              <input id="daily-task-title" autoFocus maxLength={2000} value={editingTitle}
                disabled={busy} onChange={(event) => setEditingTitle(event.target.value)} />
              <p>For this day. Your original source stays intact.</p>
              {titleError && <p role="alert">{titleError}</p>}
              <div className="task-inspector-actions">
                <button type="submit" disabled={busy || !editingTitle.trim()}>Save title</button>
                <button type="button" disabled={busy} onClick={() => { setEditingTitle(null); setTitleError(""); }}>Cancel</button>
              </div>
            </form>
          ))}
          <div className="task-inspector-body">
            <p>{source?.context ?? (queued ? "Choose this task for today, or work through the next step." : "A task you chose to keep in view.")}</p>
            {source && (
              <dl>
                <dt>Source</dt>
                <dd>
                  {source.source === "triage"
                    ? "Collected by your routines"
                    : "Your task list"}
                </dd>
                {source.sourceRef && (
                  <>
                    <dt>Reference</dt>
                    <dd>{source.sourceRef}</dd>
                  </>
                )}
              </dl>
            )}
          </div>
          <div className="task-inspector-actions">
            {queued &&
              !data.focus.some((item) => item.taskId === queued.id) && (
                <button disabled={busy} onClick={() => void choose(queued)}>
                  <Plus size={15} /> Add to today
                </button>
              )}
            {source && (
              <button
                onClick={() => {
                  setSelected(null);
                  openSource(source.sourcePath);
                }}
              >
                Open source <ArrowUpRight size={14} />
              </button>
            )}
            {onDiscuss && (
              <button
                onClick={() => {
                  onDiscuss({
                    title: taskLabel(selectedTitle ?? ""),
                    context: source?.context,
                    sourcePath: source?.sourcePath,
                    date: data.date,
                  });
                  setSelected(null);
                }}
              >
                <MessageSquare size={15} /> Think it through
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function DailyBrief({
  data,
  openSource,
}: {
  data: VaultDay;
  openSource: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Preserve Markdown blocks, including wrapped list items, while limiting the first read.
  const blocks = data.brief
    .trim()
    .split(/\n(?=\s*[-*+]\s+|\d+\.\s+)|\n\s*\n/)
    .filter(Boolean);
  const preview = blocks.slice(0, 3).join("\n\n");
  return (
    <section className="today-brief" aria-labelledby="brief-title">
      <div className="today-section-heading">
        <h2 id="brief-title">A quick catch-up</h2>
      </div>
      {data.brief ? (
        <>
          <Markdown>{expanded ? data.brief : preview}</Markdown>
          {blocks.length > 3 && (
            <button
              className="today-text-button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Show less" : `Read ${blocks.length - 3} more`}
            </button>
          )}
        </>
      ) : data.digestPath ? (
        <p className="today-empty">
          This day’s digest has no “The brief” section yet.
          <br />
          Open the full briefing to read it as written.
        </p>
      ) : (
        <p className="today-empty">
          No briefing for this day yet.
          <br />
          There’s room to start with your own thoughts.
        </p>
      )}
      {data.digestPath && (
        <div className="today-brief-source">
          <span>
            {data.digestUpdatedAt
              ? `Source updated ${new Date(data.digestUpdatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${new Date(data.digestUpdatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
              : "From your vault"}
          </span>
          <button onClick={() => openSource(data.digestPath as string)}>
            Full briefing ↗
          </button>
        </div>
      )}
    </section>
  );
}
