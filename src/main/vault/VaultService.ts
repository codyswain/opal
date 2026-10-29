import { randomUUID } from "crypto";
import { link, lstat, open, unlink } from "fs/promises";
import path from "path";
import { MarkdownDocumentService } from "@/main/fs/MarkdownDocumentService";
import { filesystemMutationQueue } from "@/main/fs/MutationQueue";
import { RootRegistry } from "@/main/fs/RootRegistry";
import { isInsideRoot } from "@/main/fs/paths";
import type { VaultInfo } from "@/types/vault";
import { splitDailyLog, validDate } from "@/common/vaultModel";

interface Dependencies {
  registry: RootRegistry;
  markdown: MarkdownDocumentService;
}
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/** All vault layout and ownership rules live on this side of the IPC boundary. */
export class VaultService {
  constructor(private deps: Dependencies) {}

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
}
