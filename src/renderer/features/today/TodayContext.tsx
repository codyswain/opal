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
  const [queueOpen, setQueueOpen] = useState(false);
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
        <span>{item.title}</span>
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
        <h2 id="focus-title">A little focus</h2>
        <span className="today-count">
          {unfinished.length ? `${unfinished.length} chosen` : "For this day"}
        </span>
      </div>
      {unfinished.length ? (
        <ul className="today-focus-list">{unfinished.map(itemRow)}</ul>
      ) : (
        <p className="today-empty">
          Choose what deserves your attention.
          <br />A small intention is enough.
        </p>
      )}
      <form className="today-intention" onSubmit={(event) => void add(event)}>
        <input
          aria-label="Add a daily intention"
          placeholder="What matters to you?"
          maxLength={500}
          value={intention}
          onChange={(event) => setIntention(event.target.value)}
        />
        <button aria-label="Add intention" disabled={busy || !intention.trim()}>
          <Plus size={17} />
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
        Choose from your queue <span>{data.tasks.length}</span>
      </button>
      {queueOpen && (
        <div className="today-queue" aria-label="Current task queue">
          <p className="today-caption">
            Current across days. Bring a task into this day when you’re ready.
          </p>
          {!data.tasks.length && (
            <p className="today-empty">
              Your queue is clear. Add an intention above, or keep the day open.
            </p>
          )}
          {(["open", "suggested"] as const).map((status) => {
            const tasks = data.tasks.filter((task) => task.status === status);
            return tasks.length ? (
              <div key={status}>
                <h3>
                  {status === "open"
                    ? "On your list"
                    : "Suggestions to consider"}
                </h3>
                {tasks.map((task) => (
                  <details key={task.id}>
                    <summary>{task.title}</summary>
                    <p>
                      {task.context ??
                        (status === "suggested"
                          ? "Collected by your routines; not yet a commitment."
                          : "From your current task list.")}
                    </p>
                    {task.sourceRef && (
                      <p className="today-source">{task.sourceRef}</p>
                    )}
                    <div className="today-queue-actions">
                      <button
                        disabled={
                          busy ||
                          data.focus.some((item) => item.taskId === task.id)
                        }
                        onClick={() =>
                          void mutate(() =>
                            window.vaultAPI.addFocus(data.root, data.date, {
                              title: task.title,
                              taskId: task.id,
                            }),
                          )
                        }
                      >
                        {data.focus.some((item) => item.taskId === task.id)
                          ? "In focus"
                          : "Add to focus"}
                      </button>
                      <button onClick={() => openSource(task.sourcePath)}>
                        Open source ↗
                      </button>
                    </div>
                  </details>
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
