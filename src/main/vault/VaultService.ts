import { createHash, randomUUID } from "crypto";
import { link, lstat, mkdir, open, rename, unlink } from "fs/promises";
import path from "path";
import { DiskReader } from "@/main/fs/DiskReader";
import {
  MarkdownConflictError,
  MarkdownDocumentService,
} from "@/main/fs/MarkdownDocumentService";
import { filesystemMutationQueue } from "@/main/fs/MutationQueue";
import { RootRegistry } from "@/main/fs/RootRegistry";
import { isInsideRoot } from "@/main/fs/paths";
import type {
  FocusItem,
  JournalDraft,
  VaultDay,
  VaultInfo,
  VaultTask,
} from "@/types/vault";
import {
  dailyBrief,
  parseCandidates,
  parseTasks,
  photoPaths,
  splitDailyLog,
  validDate,
} from "@/common/vaultModel";
import { DraftRepository } from "./DraftRepository";

interface Dependencies {
  registry: RootRegistry;
  reader: DiskReader;
  markdown: MarkdownDocumentService;
  draftDirectory: string;
}
interface FocusFile {
  version: 1;
  focus: FocusItem[];
  sources: Record<string, VaultTask>;
}
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** All vault layout and ownership rules live on this side of the IPC boundary. */
export class VaultService {
  private drafts: DraftRepository;
  constructor(private deps: Dependencies) {
    this.drafts = new DraftRepository(deps.draftDirectory, (target) =>
      this.journalPath(target),
    );
  }

  private async root(target: string): Promise<string> {
    if (typeof target !== "string" || !path.isAbsolute(target))
      throw new Error("Choose an opened vault folder.");
    const canonical = await this.deps.registry.assertAllowed(target);
    if (!this.deps.registry.list().includes(canonical))
      throw new Error("Choose an opened vault folder.");
    return canonical;
  }

  /** Reject links at every vault-owned segment, including missing-file ancestors. */
  private async contained(
    root: string,
    target: string,
    allowMissing = false,
  ): Promise<string> {
    const normalized = path.resolve(target);
    if (!isInsideRoot(root, normalized))
      throw new Error("This source is outside the selected vault.");
    let cursor = root;
    const parts = path
      .relative(root, normalized)
      .split(path.sep)
      .filter(Boolean);
    for (let index = 0; index < parts.length; index++) {
      cursor = path.join(cursor, parts[index]);
      try {
        const info = await lstat(cursor);
        if (info.isSymbolicLink())
          throw new Error(
            "Symlink sources are not supported in the daily view.",
          );
        if (index < parts.length - 1 && !info.isDirectory())
          throw new Error("A vault folder is not a directory.");
      } catch (error) {
        if (allowMissing && missing(error)) return normalized;
        throw error;
      }
    }
    return normalized;
  }

  private checkDate(date: string): void {
    if (typeof date !== "string" || !validDate(date))
      throw new Error("Choose a valid calendar date.");
  }

  private async journalPath(target: string): Promise<string> {
    if (typeof target !== "string" || !path.isAbsolute(target))
      throw new Error("Invalid journal path.");
    const normalized = path.resolve(target);
    const date = path.basename(normalized, ".md");
    this.checkDate(date);
    const root = this.deps.registry
      .list()
      .find(
        (candidate) =>
          normalized === path.join(candidate, "Inbox", "Logs", `${date}.md`),
      );
    if (!root) throw new Error("This journal is not inside an opened vault.");
    await this.root(root);
    return this.contained(root, normalized, true);
  }

  async discover(): Promise<VaultInfo[]> {
    const result: VaultInfo[] = [];
    for (const root of this.deps.registry.list()) {
      try {
        const folder = await this.contained(
          await this.root(root),
          path.join(root, "Inbox/Logs"),
        );
        if ((await lstat(folder)).isDirectory())
          result.push({ path: root, name: path.basename(root) || root });
      } catch {
        /* A non-vault root remains available in Files. */
      }
    }
    return result;
  }

  async readDay(target: string, date: string): Promise<VaultDay> {
    this.checkDate(date);
    const root = await this.root(target);
    const warnings: string[] = [];
    const logPath = path.join(root, "Inbox/Logs", `${date}.md`);
    let document = null;
    try {
      document = await this.deps.markdown.read(
        await this.contained(root, logPath),
      );
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const optional = async (relative: string) => {
      try {
        const file = await this.contained(root, path.join(root, relative));
        const content = await this.deps.reader.readTextFile(file);
        if (content.truncated)
          throw new Error("The source is too large for the daily view.");
        return {
          text: content.text,
          path: file,
          updatedAt: (await lstat(file)).mtimeMs,
        };
      } catch (error) {
        if (!missing(error))
          warnings.push(
            `${relative}: ${error instanceof Error ? error.message : "Could not read this source."}`,
          );
        return null;
      }
    };
    const [digest, todo, triage] = await Promise.all([
      optional(`Inbox/Digests/${date}.md`),
      optional("RAM/todo.md"),
      optional("RAM/triage/state.json"),
    ]);
    const occurrences = new Map<string, number>();
    const tasks: VaultTask[] = parseTasks(todo?.text ?? "").map((task) => {
      const occurrence = occurrences.get(task.raw) ?? 0;
      occurrences.set(task.raw, occurrence + 1);
      return {
        id: `markdown:${hash(task.raw)}:${occurrence}`,
        title: task.text,
        source: "markdown",
        sourcePath: path.join(root, "RAM/todo.md"),
        status: "open",
        sourceRef: `line:${task.line + 1}`,
      };
    });
    if (triage) {
      try {
        tasks.push(
          ...parseCandidates(triage.text, date).map((item) => ({
            id: `triage:${item.id}`,
            title: item.title,
            source: "triage" as const,
            sourcePath: triage.path,
            status:
              item.status === "active"
                ? ("open" as const)
                : ("suggested" as const),
            ...(item.context ? { context: item.context } : {}),
            sourceRef: item.source ?? item.id,
          })),
        );
      } catch {
        warnings.push(
          "RAM/triage/state.json: The action queue has an unsupported format.",
        );
      }
    }
    let focus: FocusItem[] = [];
    try {
      focus = (await this.readFocus(root, date)).focus;
    } catch (error) {
      warnings.push(
        `Daily focus: ${error instanceof Error ? error.message : "Could not read this source."}`,
      );
    }
    const candidates = photoPaths(
      splitDailyLog(document?.body ?? "").journal,
      root,
      path.dirname(logPath),
    );
    try {
      const folder = await this.contained(
        root,
        path.join(root, "Photos", date),
      );
      const listing = await this.deps.reader.readDirectory(folder);
      candidates.push(
        ...listing.entries
          .filter((entry) => entry.kind === "image")
          .map((entry) => entry.path),
      );
    } catch (error) {
      if (!missing(error))
        warnings.push("The photo folder could not be read safely.");
    }
    const photos: string[] = [];
    for (const candidate of new Set(candidates)) {
      try {
        const safe = await this.contained(root, candidate);
        const entry = await this.deps.reader.statEntry(safe);
        if (entry.kind === "image" && isInsideRoot(root, entry.path))
          photos.push(entry.path);
      } catch {
        /* Unavailable image links are omitted. */
      }
    }
    return {
      root,
      date,
      logPath,
      document,
      brief: dailyBrief(digest?.text ?? ""),
      digestPath: digest?.path ?? null,
      digestUpdatedAt: digest?.updatedAt ?? null,
      tasks,
      focus,
      photos,
      warnings,
    };
  }

  async createDay(target: string, date: string): Promise<undefined> {
    this.checkDate(date);
    const root = await this.root(target);
    return filesystemMutationQueue.run(async () => {
      const log = await this.contained(
        root,
        path.join(root, "Inbox/Logs", `${date}.md`),
        true,
      );
      await this.contained(root, path.dirname(log));
      try {
        if (!(await lstat(log)).isFile())
          throw new Error("The daily log path is not a file.");
        return undefined;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      let journal =
        "## Morning\n### What matters today\n\n## Evening\n### What I want to remember\n";
      try {
        const template = await this.contained(
          root,
          path.join(root, "Archive/Journal/Template.md"),
        );
        journal = splitDailyLog(
          (await this.deps.markdown.read(template)).body,
        ).journal;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      const temporary = path.join(
        path.dirname(log),
        `.opal-day-${randomUUID()}`,
      );
      try {
        const handle = await open(temporary, "wx", 0o644);
        try {
          await handle.writeFile(
            `${journal.trimEnd()}\n\n---\n## Activity Log\n`,
            "utf8",
          );
          await handle.sync();
        } finally {
          await handle.close();
        }
        await this.contained(root, log, true);
        // Linking publishes the fully written inode atomically, and never replaces
        // a daily log a routine created while the template was being written.
        try {
          await link(temporary, log);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          await this.contained(root, log);
          if (!(await lstat(log)).isFile())
            throw new Error("The daily log path is not a file.");
        }
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      return undefined;
    });
  }

  async saveJournal(
    target: string,
    original: string,
    next: string,
  ): Promise<{ journal: string; revision: string }> {
    const safe = await this.journalPath(target);
    const journal = next && !next.endsWith("\n") ? `${next}\n` : next;
    if (splitDailyLog(journal).activity)
      throw new Error(
        "Keep the Activity Log heading outside your journal; routines own that section.",
      );
    for (let attempt = 0; attempt < 3; attempt++) {
      const loaded = await this.deps.markdown.read(safe);
      const parts = splitDailyLog(loaded.body);
      if (parts.journal === journal)
        return { journal, revision: loaded.revision };
      if (parts.journal !== original)
        throw new Error(
          "Your journal changed in another editor. Your draft is kept; open the source to compare before retrying.",
        );
      try {
        const saved = await this.deps.markdown.write(
          safe,
          journal + parts.activity,
          loaded.revision,
        );
        return { journal, revision: saved.revision };
      } catch (error) {
        if (!(error instanceof MarkdownConflictError)) throw error;
      }
    }
    throw new Error(
      "The daily file is still changing. Your draft is kept; try saving again.",
    );
  }

  private async readFocus(root: string, date: string): Promise<FocusFile> {
    let file: string;
    try {
      file = await this.contained(
        root,
        path.join(root, ".opal/days", `${date}.json`),
      );
    } catch (error) {
      if (missing(error)) return { version: 1, focus: [], sources: {} };
      throw error;
    }
    const content = await this.deps.reader.readTextFile(file);
    if (content.truncated)
      throw new Error("The daily focus file is too large.");
    const data = JSON.parse(content.text);
    if (
      data?.version !== 1 ||
      !Array.isArray(data.focus) ||
      data.focus.some(
        (item: FocusItem) =>
          !item ||
          typeof item.id !== "string" ||
          typeof item.title !== "string" ||
          typeof item.completed !== "boolean" ||
          typeof item.createdAt !== "string" ||
          (item.taskId !== undefined && typeof item.taskId !== "string"),
      )
    )
      throw new Error("The daily focus file has an unsupported format.");
    if (
      new Set(data.focus.map((item: FocusItem) => item.id)).size !==
      data.focus.length
    )
      throw new Error("The daily focus file contains duplicate IDs.");
    const sources: Record<string, VaultTask> = {};
    if (
      data.sources &&
      typeof data.sources === "object" &&
      !Array.isArray(data.sources)
    ) {
      for (const [id, value] of Object.entries(data.sources)) {
        const source = value as VaultTask;
        if (
          source &&
          source.id === id &&
          typeof source.title === "string" &&
          typeof source.sourcePath === "string" &&
          path.isAbsolute(source.sourcePath) &&
          isInsideRoot(root, path.resolve(source.sourcePath)) &&
          (source.source === "markdown" || source.source === "triage") &&
          (source.status === "open" || source.status === "suggested") &&
          (source.context === undefined ||
            typeof source.context === "string") &&
          (source.sourceRef === undefined ||
            typeof source.sourceRef === "string")
        )
          sources[id] = source;
      }
    }
    const focus = data.focus.map((item: FocusItem) => ({
      id: item.id,
      title: item.title,
      completed: item.completed,
      createdAt: item.createdAt,
      ...(item.taskId
        ? {
            taskId: item.taskId,
            ...(sources[item.taskId] ? { source: sources[item.taskId] } : {}),
          }
        : {}),
    }));
    return { version: 1, focus, sources };
  }

  private async writeFocus(
    root: string,
    date: string,
    data: FocusFile,
  ): Promise<void> {
    for (const relative of [".opal", ".opal/days"]) {
      const folder = await this.contained(
        root,
        path.join(root, relative),
        true,
      );
      await mkdir(folder).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      await this.contained(root, folder);
    }
    const target = await this.contained(
      root,
      path.join(root, ".opal/days", `${date}.json`),
      true,
    );
    const temporary = path.join(
      path.dirname(target),
      `.opal-focus-${randomUUID()}`,
    );
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(
          JSON.stringify(
            {
              ...data,
              focus: data.focus.map((item) => ({
                id: item.id,
                title: item.title,
                completed: item.completed,
                createdAt: item.createdAt,
                ...(item.taskId ? { taskId: item.taskId } : {}),
              })),
            },
            null,
            2,
          ),
          "utf8",
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.contained(root, target, true);
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async addFocus(
    target: string,
    date: string,
    input: { title: string; taskId?: string },
  ): Promise<FocusItem[]> {
    this.checkDate(date);
    if (
      !input ||
      typeof input.title !== "string" ||
      !input.title.trim() ||
      input.title.length > 2000 ||
      (input.taskId !== undefined && typeof input.taskId !== "string")
    )
      throw new Error("Enter a focus title of up to 2,000 characters.");
    const root = await this.root(target);
    return filesystemMutationQueue.run(async () => {
      const data = await this.readFocus(root, date);
      if (
        input.taskId &&
        data.focus.some((item) => item.taskId === input.taskId)
      )
        return data.focus;
      if (input.taskId) {
        const source = (await this.readDay(root, date)).tasks.find(
          (task) => task.id === input.taskId,
        );
        if (!source)
          throw new Error(
            "This task changed. Refresh the backlog before adding it to focus.",
          );
        data.sources[source.id] = source;
      }
      data.focus.push({
        id: randomUUID(),
        title: input.title.trim(),
        ...(input.taskId
          ? { taskId: input.taskId, source: data.sources[input.taskId] }
          : {}),
        completed: false,
        createdAt: new Date().toISOString(),
      });
      await this.writeFocus(root, date, data);
      return data.focus;
    });
  }

  async updateFocus(
    target: string,
    date: string,
    id: string,
    patch: { completed?: boolean; remove?: boolean; title?: string },
  ): Promise<FocusItem[]> {
    this.checkDate(date);
    if (patch.title !== undefined &&
      (typeof patch.title !== "string" || !patch.title.trim() ||
        patch.title.length > 2000 || patch.title.includes("\0")))
      throw new Error("Enter a task title of up to 2,000 characters.");
    const root = await this.root(target);
    return filesystemMutationQueue.run(async () => {
      const data = await this.readFocus(root, date);
      const item = data.focus.find((focus) => focus.id === id);
      if (!item)
        throw new Error("This focus item no longer exists. Refresh the day.");
      if (patch.remove) {
        data.focus = data.focus.filter((focus) => focus.id !== id);
        if (item.taskId) delete data.sources[item.taskId];
      } else {
        if (patch.completed !== undefined) item.completed = patch.completed;
        if (patch.title !== undefined) item.title = patch.title.trim();
      }
      await this.writeFocus(root, date, data);
      return data.focus;
    });
  }

  listDrafts(): Promise<JournalDraft[]> {
    return this.drafts.list();
  }
  putDraft(draft: JournalDraft): Promise<undefined> {
    return this.drafts.put(draft);
  }
  clearDraft(target: string, version: string): Promise<undefined> {
    return this.drafts.clear(target, version);
  }
}
