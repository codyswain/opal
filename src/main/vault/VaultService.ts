import { randomUUID } from "crypto";
import { constants } from "fs";
import { link, lstat, mkdir, open, unlink } from "fs/promises";
import path from "path";
import { filesystemMutationQueue } from "@/main/fs/MutationQueue";
import { RootRegistry } from "@/main/fs/RootRegistry";
import type { VaultInfo } from "@/types/vault";
import { defaultDailyPage, fillDailyTemplate, validDate } from "@/common/vaultModel";
import {
  DAY_LAYOUT,
  LEGACY_DAY_LAYOUT,
  dailyName,
  inVault,
  missing,
  openedVault,
} from "./vaultPaths";

interface Dependencies {
  registry: RootRegistry;
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
    try {
      const target = await inVault(root, file);
      if (!(await lstat(target)).isFile())
        throw new Error("The daily page path is not a file.");
      return target;
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
   * The page Today opens for `date`: `Library/daily/<date>.md`, written from
   * the vault's template when it does not exist yet. Until the cleanup commit,
   * an existing `Inbox/Logs/<date>.md` is opened instead when the daily page
   * does not exist. Never overwrites a file.
   */
  async createDay(target: string, date: string): Promise<{ path: string }> {
    this.checkDate(date);
    const root = await openedVault(this.deps.registry, target);
    // Any other opened folder stays as it is; Today never adds Library/daily to it.
    if (!(await this.isVault(root))) throw new Error("Choose an opened vault folder.");
    return filesystemMutationQueue.run(async () => {
      const page = path.join(root, DAY_LAYOUT.daily, dailyName(date));
      const found =
        (await this.existing(root, page)) ??
        (await this.existing(root, path.join(root, LEGACY_DAY_LAYOUT.logs, dailyName(date))));
      if (found) return { path: found };
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
}
