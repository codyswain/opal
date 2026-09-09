import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Plus, X } from "lucide-react";
import type { VaultDay, VaultResult } from "@/types/vault";

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

export function DailyFocus({
  data,
  busy,
  mutate,
  openSource,
}: {
  data: VaultDay;
  busy: boolean;
  mutate: (operation: () => Promise<VaultResult<unknown>>) => Promise<boolean>;
  openSource: (path: string) => void;
}) {
  const [intention, setIntention] = useState("");
  const [queueOpen, setQueueOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "suggested">("all");
  const available = data.tasks.filter(
    (task) =>
      taskLabel(task.title).trim() !== "[ ]" &&
      !data.focus.some((item) => item.taskId === task.id),
  );
  const matching = available.filter(
    (task) =>
      (filter === "all" || task.status === filter) &&
      `${task.title} ${task.context ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
  );
  const unfinished = data.focus.filter((item) => !item.completed);
  const completed = data.focus.filter((item) => item.completed);
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = intention.trim();
    if (
      title &&
      (await mutate(() =>
        window.vaultAPI.addFocus(data.root, data.date, { title }),
      ))
    )
      setIntention((current) => (current.trim() === title ? "" : current));
  };
  const itemRow = (item: VaultDay["focus"][number]) => (
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
        {item.completed && <Check size={12} />}
      </button>
      <div className="today-focus-content">
        <span>{taskLabel(item.title)}</span>
        {item.source && (
          <details className="today-focus-context">
            <summary>Context</summary>
            <p>{item.source.context ?? "Chosen from your task list."}</p>
            <button
              onClick={() => item.source && openSource(item.source.sourcePath)}
            >
              Open source ↗
            </button>
          </details>
        )}
      </div>
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
        <X size={13} />
      </button>
    </li>
  );
  return (
    <section className="today-focus" aria-labelledby="focus-title">
      <div className="today-section-heading">
        <h2 id="focus-title">To do</h2>
        <span className="today-count">
          {unfinished.length
            ? `${unfinished.length} remaining`
            : "For this day"}
        </span>
      </div>
      {unfinished.length ? (
        <ul className="today-focus-list">{unfinished.map(itemRow)}</ul>
      ) : (
        <p className="today-empty">Choose a task below or add your own.</p>
      )}
      <form className="today-intention" onSubmit={(event) => void add(event)}>
        <input
          aria-label="Add a daily intention"
          placeholder="Add a task for today…"
          maxLength={500}
          value={intention}
          onChange={(event) => setIntention(event.target.value)}
        />
        <button aria-label="Add intention" disabled={busy || !intention.trim()}>
          <Plus size={17} /> Add
        </button>
      </form>
      {!!completed.length && (
        <details className="today-completed">
          <summary>
            {completed.length} {completed.length === 1 ? "thing" : "things"}{" "}
            done
          </summary>
          <ul className="today-focus-list">{completed.map(itemRow)}</ul>
          <p className="today-caption">
            Completed here for this day. Source tasks stay unchanged.
          </p>
        </details>
      )}
      <button
        className="today-queue-toggle"
        aria-expanded={queueOpen}
        onClick={() => setQueueOpen(!queueOpen)}
      >
        Choose from your queue <span>{available.length}</span>
      </button>
      {queueOpen && (
        <div className="today-queue" aria-label="Current task queue">
          <div className="today-queue-tools">
            <input
              type="search"
              aria-label="Search task queue"
              placeholder="Find a task…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
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
          </div>
          <p className="today-caption">
            Current across days. Bring a task into this day when you’re ready.
          </p>
          {!data.tasks.length && (
            <p className="today-empty">
              Your queue is clear. Add an intention above, or keep the day open.
            </p>
          )}
          {!!available.length && !matching.length && (
            <p className="today-empty">
              No tasks match. Try another search or source.
            </p>
          )}
          {!available.length && !!data.tasks.length && (
            <p className="today-empty">
              Your queued tasks are already on today’s list.
            </p>
          )}
          {(["open", "suggested"] as const).map((status) => {
            const tasks = matching.filter((task) => task.status === status);
            return tasks.length ? (
              <div key={status}>
                <h3>
                  {status === "open"
                    ? "On your list"
                    : "Suggestions to consider"}
                </h3>
                {tasks.map((task) => (
                  <div className="today-task-row" key={task.id}>
                    <div className="today-task-description">
                      <span className="today-task-title">
                        {taskLabel(task.title)}
                      </span>
                      <details>
                        <summary>
                          Details ·{" "}
                          {task.source === "triage" ? "Routines" : "Task list"}
                        </summary>
                        <p>{task.context ?? "From your current task list."}</p>
                        <button onClick={() => openSource(task.sourcePath)}>
                          Open source ↗
                        </button>
                      </details>
                    </div>
                    <button
                      className="today-task-add"
                      disabled={busy}
                      aria-label={`Add ${task.title} to today`}
                      onClick={() =>
                        void mutate(() =>
                          window.vaultAPI.addFocus(data.root, data.date, {
                            title: task.title,
                            taskId: task.id,
                          }),
                        )
                      }
                    >
                      <Plus size={14} /> Add to today
                    </button>
                  </div>
                ))}
              </div>
            ) : null;
          })}
        </div>
      )}
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
