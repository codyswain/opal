import { randomUUID } from "crypto";
import { constants } from "fs";
import { link, lstat, mkdir, open, unlink } from "fs/promises";
import path from "path";
import { MarkdownConflictError, type MarkdownDocumentService } from "@/main/fs/MarkdownDocumentService";
import { filesystemMutationQueue } from "@/main/fs/MutationQueue";
import { RootRegistry } from "@/main/fs/RootRegistry";
import type { DigestItemTick, VaultInfo } from "@/types/vault";
import { digestCheckboxLine, parseDigest, splitFrontmatter } from "@/common/dayModel";
import { defaultDailyPage, fillDailyTemplate, validDate } from "@/common/vaultModel";
import {
  DAY_LAYOUT,
  LEGACY_DAY_LAYOUT,
  dailyNames,
  inVault,
  isDigestPath,
  legacyDayName,
  missing,
  openedVault,
} from "./vaultPaths";

interface Dependencies {
  registry: RootRegistry;
  /** Writes a digest's tick with the editor's queue and atomic replace. */
  documents?: Pick<MarkdownDocumentService, "replaceLine">;
}

/** A template larger than this is not a daily template. */
const TEMPLATE_LIMIT = 256 * 1024;

/** All vault layout and ownership rules live on this side of the IPC boundary. */
export class VaultService {
  constructor(private deps: Dependencies) {}

  private checkDate(date: string): void {
    if (typeof date !== "string" || !validDate(date))
      throw new Error("Choose a valid calendar date.");
  }

  /** An opened folder is a vault when it has a daily, log or old Inbox/Logs folder. */
  private async isVault(root: string): Promise<boolean> {
    for (const folder of [DAY_LAYOUT.daily, DAY_LAYOUT.logs, LEGACY_DAY_LAYOUT.logs]) {
      try {
        const target = await inVault(root, path.join(root, folder));
        if ((await lstat(target)).isDirectory()) return true;
      } catch {
        /* Not this folder. */
      }
    }
    return false;
  }

  async discover(): Promise<VaultInfo[]> {
    const result: VaultInfo[] = [];
    for (const root of this.deps.registry.list()) {
      try {
        if (await this.isVault(await openedVault(this.deps.registry, root)))
          result.push({ path: root, name: path.basename(root) || root });
      } catch {
        /* A non-vault root remains available in Files. */
      }
    }
    return result;
  }

  /** The existing regular file at `file`, or null when nothing is there. */
  private async existing(root: string, file: string): Promise<string | null> {
    const target = await this.fileAt(root, file);
    if (target === false) throw new Error("The daily page path is not a file.");
    return target;
  }

  /** The regular file at `file`, null when nothing is there, and false for anything else there. */
  private async fileAt(root: string, file: string): Promise<string | null | false> {
    try {
      const target = await inVault(root, file);
      return (await lstat(target)).isFile() ? target : false;
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  private async template(root: string, date: string): Promise<string> {
    let handle;
    try {
      const template = await inVault(root, path.join(root, DAY_LAYOUT.template));
      handle = await open(template, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (missing(error)) return defaultDailyPage(date);
      throw error;
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > TEMPLATE_LIMIT)
        throw new Error("The daily template is not a small text file.");
      return fillDailyTemplate(await handle.readFile("utf8"), date);
    } finally {
      await handle.close();
    }
  }

  /**
   * The page a date already has: `Library/daily/<date>.mdo`, else
   * `<date>.md`, and until the cleanup commit `Inbox/Logs/<date>.md`. A
   * folder or anything else that is not a file does not count, as in the
   * day sidebar (DayService). Null when it has none.
   */
  private async dayPage(root: string, date: string): Promise<string | null> {
    const files = [
      ...dailyNames(date).map((name) => path.join(root, DAY_LAYOUT.daily, name)),
      path.join(root, LEGACY_DAY_LAYOUT.logs, legacyDayName(date)),
    ];
    for (const file of files) {
      const found = await this.fileAt(root, file);
      if (found) return found;
    }
    return null;
  }

  /**
   * The daily page for `date`: the page it already has (`dayPage`), or else
   * `Library/daily/<date>.mdo`, a document written from the vault's template.
   * Never overwrites a file, and never makes a second page for a date that
   * has one.
   */
  async createDay(target: string, date: string): Promise<{ path: string }> {
    this.checkDate(date);
    const root = await openedVault(this.deps.registry, target);
    // Any other opened folder stays as it is; Daily never adds Library/daily to it.
    if (!(await this.isVault(root))) throw new Error("Choose an opened vault folder.");
    return filesystemMutationQueue.run(async () => {
      const found = await this.dayPage(root, date);
      if (found) return { path: found };
      const [page, note] = dailyNames(date).map((name) => path.join(root, DAY_LAYOUT.daily, name));
      await inVault(root, page, true);
      await mkdir(path.dirname(page), { recursive: true });
      await inVault(root, path.dirname(page));
      const contents = await this.template(root, date);
      const temporary = path.join(
        path.dirname(page),
        `.opal-day-${randomUUID()}`,
      );
      try {
        const handle = await open(temporary, "wx", 0o644);
        try {
          await handle.writeFile(contents, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        // A note another app made while the template was being written is the day's page.
        const made = await this.fileAt(root, note);
        if (made) return { path: made };
        await inVault(root, page, true);
        // Linking publishes the fully written inode atomically, and never replaces
        // a page another app created while the template was being written.
        try {
          await link(temporary, page);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (!(await this.existing(root, page)))
            throw new Error("The daily page path is not a file.");
        }
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      return { path: page };
    });
  }

  /**
   * Ticks or clears one checkbox in a digest, the file `/digest` writes:
   * `Library/digests/<date> digest.md`, or until the cleanup commit
   * `Inbox/Digests/<date>.md`. `line` and `raw` are where the day sidebar read
   * the item, in the body after the frontmatter. The write changes only the
   * character between that line's brackets, and is refused when the file no
   * longer has that item on that line.
   */
  async checkDigestItem(
    target: string,
    file: string,
    line: number,
    raw: string,
    checked: boolean,
  ): Promise<DigestItemTick> {
    const root = await openedVault(this.deps.registry, target);
    const resolved = await inVault(root, file);
    if (!isDigestPath(path.relative(root, resolved).split(path.sep).join("/")))
      throw new Error("Only a digest's checkboxes can be ticked here.");
    const next = digestCheckboxLine(raw, checked);
    if (next === null) throw new Error("That line is not a digest checkbox.");
    if (!this.deps.documents) throw new Error("Digests cannot be edited here.");
    await this.deps.documents.replaceLine(resolved, (text) => {
      const listed = parseDigest(text).groups.some((group) =>
        group.items.some((item) => item.at?.line === line && item.at.raw === raw),
      );
      if (!listed)
        throw new MarkdownConflictError("This item changed in the digest since it was read.");
      const { body } = splitFrontmatter(text);
      const above = text.slice(0, text.length - body.length).split("\n").length - 1;
      return { index: above + line, expected: raw, replacement: next };
    });
    return { line, raw: next, checked };
  }
}
