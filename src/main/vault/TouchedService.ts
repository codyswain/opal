import { constants } from "fs";
import { lstat, open } from "fs/promises";
import path from "path";
import type { RootRegistry } from "@/main/fs/RootRegistry";
import { isInsideRoot, normalizePath } from "@/main/fs/paths";
import { validDate } from "@/common/vaultModel";
import {
  EMPTY_TOUCHED_CONFIG,
  linkTitles,
  mondayOf,
  touchedConfig,
  touchedItems,
  weekDates,
  type TouchedEntry,
} from "@/common/touchedModel";
import type { DayLink, DayLogEntry } from "@/types/day";
import type { TouchedWeek, TouchedWeekChange } from "@/types/touched";
import { inDayFolder, type DayService } from "./DayService";
import { DAY_LAYOUT, LEGACY_DAY_LAYOUT, inVault, openedVault, digestName } from "./vaultPaths";

export interface TouchedServiceDependencies {
  registry: RootRegistry;
  days: DayService;
  /** Called when a week the renderer asked for reads differently on disk. */
  onChanged?: (change: TouchedWeekChange) => void;
}

/** The per-folder files the list reads, from the folder's top. Opal never writes them. */
export const TOUCHED_CONFIG = ".opal/touched.json";
export const LINK_TITLES = ".opal/link-titles.json";
/** How many recently asked-for weeks are read again when their files change. */
const WATCHED_WEEKS = 4;
/** The `.opal` files are small; anything larger is not one of them. */
const JSON_LIMIT = 1024 * 1024;

/**
 * The touched list's data for one week: what the agent turns of its seven
 * activity logs linked to, read through `DayService` so links resolve as
 * the day sidebar's do. The per-folder `.opal/touched.json` groups and
 * ignores files; `.opal/link-titles.json` names issues, pull requests and
 * Google Docs.
 */
export class TouchedService {
  private watched = new Map<string, TouchedWeekChange & { json: string }>();

  constructor(private deps: TouchedServiceDependencies) {}

  /** The week `date` falls in, Monday to Sunday. */
  async week(target: string, date: string): Promise<TouchedWeek> {
    if (typeof date !== "string" || !validDate(date)) throw new Error("Choose a valid calendar date.");
    const root = await openedVault(this.deps.registry, target);
    const week = await this.read(root, mondayOf(date));
    const key = `${root}\n${week.monday}`;
    this.watched.delete(key);
    this.watched.set(key, { root, monday: week.monday, json: JSON.stringify(week) });
    for (const stale of this.watched.keys()) {
      if (this.watched.size <= WATCHED_WEEKS) break;
      this.watched.delete(stale);
    }
    return week;
  }

  /** Takes the directories the disk watcher reports, and reports each watched week that reads differently. */
  async changed(directories: readonly string[]): Promise<void> {
    for (const [key, watched] of [...this.watched]) {
      if (!directories.some((directory) => this.touches(watched.root, directory))) continue;
      let json: string;
      try {
        json = JSON.stringify(await this.read(watched.root, watched.monday));
      } catch {
        this.watched.delete(key);
        continue;
      }
      const current = this.watched.get(key);
      if (!current || current.json === json) continue;
      current.json = json;
      this.deps.onChanged?.({ root: watched.root, monday: watched.monday });
    }
  }

  private touches(root: string, directory: string): boolean {
    const normalized = normalizePath(directory);
    if (!isInsideRoot(root, normalized)) return false;
    const relative = path.posix.relative(normalizePath(root), normalized);
    return ["", "Library", "Inbox", ".opal", DAY_LAYOUT.logs, LEGACY_DAY_LAYOUT.logs, DAY_LAYOUT.digests].includes(relative);
  }

  private async read(root: string, monday: string): Promise<TouchedWeek> {
    const [config, titles, days] = await Promise.all([
      this.json(root, TOUCHED_CONFIG).then((json) => (json === null ? EMPTY_TOUCHED_CONFIG : touchedConfig(json))),
      this.json(root, LINK_TITLES).then((json) => linkTitles(json)),
      Promise.all(weekDates(monday).map((date) => this.deps.days.logEntries(root, date))),
    ]);
    const relative = (file: string) => path.posix.relative(normalizePath(root), normalizePath(file));
    const direct = await this.directTargets(root, days.flat().flatMap((entry) => entry.links));
    // A log line that links a hidden file is left out, as the day sidebar leaves it out: its sentence names the file.
    const blocked = await this.deps.registry.blocked();
    const fileOf = (link: DayLink) => link.path ?? (link.external ? null : direct.has(link.target) ? path.join(root, direct.get(link.target) as string) : null);
    const shown = (entry: DayLogEntry) => entry.links.every((link) => {
      const file = fileOf(link);
      return file === null || !blocked(normalizePath(file));
    });
    const entries: TouchedEntry[][] = days.map((day) =>
      day.filter(shown).map((entry) => ({
        time: entry.until ?? entry.time,
        text: entry.text,
        kind: entry.kind,
        links: entry.links.map((link) => ({
          label: link.label,
          target: link.target,
          external: link.external,
          file: link.path && isInsideRoot(root, link.path) ? relative(link.path) : link.external ? null : direct.get(link.target) ?? null,
        })),
      })),
    );
    const items = touchedItems(entries, config, titles, inDayFolder)
      .map((item) => ({
        ...item,
        path: item.path ? path.join(root, item.path) : null,
      }))
      // A group's folder can hold a hidden file without being hidden itself; a hidden folder goes.
      .filter((item) => item.path === null || !blocked(normalizePath(item.path)));
    const digests = await Promise.all(weekDates(monday).map((date) => this.digest(root, date, blocked)));
    return { root, monday, items, digests };
  }

  /** A date's digest file, or null when there is none, it is a link, or it is hidden. */
  private async digest(root: string, date: string, blocked: (real: string) => boolean): Promise<string | null> {
    try {
      const file = await inVault(root, path.join(root, DAY_LAYOUT.digests, digestName(date)));
      return (await lstat(file)).isFile() && !blocked(normalizePath(file)) ? file : null;
    } catch {
      return null;
    }
  }

  /**
   * Wiki links the link index left unresolved whose target is a file's full
   * path from the vault's top, such as one in a dot folder, which the index
   * does not list. Links on the way are refused, as everywhere in the vault.
   */
  private async directTargets(root: string, links: readonly DayLink[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const targets = new Set(links.filter((link) => !link.external && !link.path).map((link) => link.target));
    for (const target of targets) {
      const file = target.split("#")[0].trim();
      if (!file || path.isAbsolute(file) || !/\.[a-z0-9]+$/i.test(file)) continue;
      try {
        const absolute = await inVault(root, path.join(root, file));
        if ((await lstat(absolute)).isFile()) found.set(target, path.posix.relative(normalizePath(root), normalizePath(absolute)));
      } catch {
        // Missing, a link or outside the vault: the link stays unresolved.
      }
    }
    return found;
  }

  /** A `.opal` JSON file, or null when it is missing, a link, too large or not JSON. */
  private async json(root: string, relative: string): Promise<unknown> {
    try {
      const file = await inVault(root, path.join(root, relative));
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > JSON_LIMIT) return null;
        return JSON.parse(await handle.readFile("utf8"));
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }
}
