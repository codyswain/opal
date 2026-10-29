import { constants, type Dirent } from "fs";
import { lstat, open, readdir } from "fs/promises";
import path from "path";
import type { RootRegistry } from "@/main/fs/RootRegistry";
import { isInsideRoot, normalizePath } from "@/main/fs/paths";
import { MARKDOWN_DOCUMENT_LIMIT } from "@/types/markdown";
import type { DayLink, DayLogEntry, DayRecording, VaultDay, VaultDayChange } from "@/types/day";
import { splitDailyLog, validDate } from "@/common/vaultModel";
import {
  chatsForDay,
  newestFirst,
  parseDigest,
  parseLog,
  parseRecording,
  parseSession,
  parseThreadCard,
  recordingName,
  type IndexedCard,
  type IndexedSession,
  type ParsedLogEntry,
  type WrittenLink,
} from "@/common/dayModel";
import {
  DAY_LAYOUT,
  LEGACY_DAY_LAYOUT,
  dailyName,
  digestName,
  inVault,
  logName,
  missing,
  openedVault,
} from "./vaultPaths";

export interface DayServiceDependencies {
  registry: RootRegistry;
  /** Resolves wiki link targets from a note the way the editor does. */
  resolveLinks?: (from: string, targets: string[]) => Promise<Record<string, string | null>>;
  /** Called when a day the renderer asked for reads differently on disk. */
  onChanged?: (change: VaultDayChange) => void;
}

/** How many recently asked-for days are checked again when their folders change. */
const WATCHED_DAYS = 4;
/** Files read at once while indexing chats. */
const READ_CONCURRENCY = 32;
/** Parsed files kept; a vault's chats are a few hundred. */
const CACHE_LIMIT = 4000;
/** Folders whose changes can change a day, relative to the vault root. */
const DAY_FOLDERS = [
  DAY_LAYOUT.daily,
  DAY_LAYOUT.logs,
  DAY_LAYOUT.recordings,
  DAY_LAYOUT.digests,
  DAY_LAYOUT.chats,
  ...Object.values(LEGACY_DAY_LAYOUT),
];

interface CachedFile {
  mtimeMs: number;
  size: number;
  value: unknown;
}

async function mapLimited<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Everything the vault holds for one date: the daily page, the activity log,
 * the chats, the recordings and the digest. Every part is found by file name
 * or by a date field, so there is no index file. Parsed files are kept by
 * modification time, so chat sessions are read once and then only when they
 * change.
 */
export class DayService {
  private files = new Map<string, CachedFile>();
  private watched = new Map<string, VaultDayChange & { json: string }>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private deps: DayServiceDependencies) {}

  async day(target: string, date: string): Promise<VaultDay> {
    if (typeof date !== "string" || !validDate(date))
      throw new Error("Choose a valid calendar date.");
    const root = await openedVault(this.deps.registry, target);
    const day = await this.serial(() => this.read(root, date));
    const key = `${root}\n${date}`;
    this.watched.delete(key);
    this.watched.set(key, { root, date, json: JSON.stringify(day) });
    for (const stale of this.watched.keys()) {
      if (this.watched.size <= WATCHED_DAYS) break;
      this.watched.delete(stale);
    }
    return day;
  }

  /**
   * Takes the directories the disk watcher reports. Each recently asked-for
   * day in a changed folder is read again, and reported when it reads
   * differently, so a save to the daily page alone sends nothing.
   */
  async changed(directories: readonly string[]): Promise<void> {
    for (const [key, watched] of [...this.watched]) {
      if (!directories.some((directory) => this.touches(watched.root, directory))) continue;
      let json: string;
      try {
        json = JSON.stringify(await this.serial(() => this.read(watched.root, watched.date)));
      } catch {
        this.watched.delete(key);
        continue;
      }
      const current = this.watched.get(key);
      if (!current || current.json === json) continue;
      current.json = json;
      this.deps.onChanged?.({ root: watched.root, date: watched.date });
    }
  }

  private touches(root: string, directory: string): boolean {
    const normalized = normalizePath(directory);
    if (!isInsideRoot(root, normalized)) return false;
    const relative = path.posix.relative(normalizePath(root), normalized);
    // A day folder appearing or vanishing shows up as a change to its parent.
    if (relative === "" || relative === "Library" || relative === "Inbox") return true;
    return DAY_FOLDERS.some((folder) => relative === folder || relative.startsWith(`${folder}/`));
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(root: string, date: string): Promise<VaultDay> {
    const [daily, log, chats, recordings, digest] = await Promise.all([
      this.dailyPage(root, date),
      this.log(root, date),
      this.chats(root, date),
      this.recordings(root, date),
      this.digest(root, date),
    ]);
    return { date, daily, ...log, chats, recordings, digest };
  }

  /** The absolute path of `relative` when it is a real directory inside the vault. */
  private async folder(root: string, relative: string): Promise<string | null> {
    try {
      const folder = await inVault(root, path.join(root, relative));
      return (await lstat(folder)).isDirectory() ? folder : null;
    } catch {
      return null;
    }
  }

  private async entries(folder: string | null): Promise<Dirent[]> {
    if (!folder) return [];
    try {
      return (await readdir(folder, { withFileTypes: true })).filter((entry) => !entry.name.startsWith("."));
    } catch {
      return [];
    }
  }

  /** The parsed contents of a regular file, read again only when it changed. Null when it is not there. */
  private async parsed<T>(file: string, parse: (source: string) => T): Promise<T | null> {
    try {
      const info = await lstat(file);
      if (!info.isFile()) return null;
      const known = this.files.get(file);
      if (known && known.mtimeMs === info.mtimeMs && known.size === info.size) return known.value as T;
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.size > MARKDOWN_DOCUMENT_LIMIT) return null;
        const value = parse(await handle.readFile("utf8"));
        if (this.files.size >= CACHE_LIMIT) this.files.clear();
        this.files.set(file, { mtimeMs: opened.mtimeMs, size: opened.size, value });
        return value;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!missing(error)) this.files.delete(file);
      return null;
    }
  }

  private async file(root: string, relative: string, name: string): Promise<string | null> {
    const folder = await this.folder(root, relative);
    if (!folder) return null;
    const file = path.join(folder, name);
    try {
      return (await lstat(file)).isFile() ? file : null;
    } catch {
      return null;
    }
  }

  private async dailyPage(root: string, date: string): Promise<string | null> {
    return (
      (await this.file(root, DAY_LAYOUT.daily, dailyName(date))) ??
      (await this.file(root, LEGACY_DAY_LAYOUT.logs, dailyName(date)))
    );
  }

  private async resolve(from: string, written: WrittenLink[][]): Promise<DayLink[][]> {
    const targetOf = (link: WrittenLink) => link.target.split("#")[0];
    const targets = [...new Set(written.flat().filter((link) => !link.external).map(targetOf).filter(Boolean))];
    let paths: Record<string, string | null> = {};
    if (targets.length > 0 && this.deps.resolveLinks) {
      try {
        paths = await this.deps.resolveLinks(from, targets);
      } catch {
        paths = {};
      }
    }
    return written.map((links) =>
      links.map((link) => ({ ...link, path: link.external ? null : paths[targetOf(link)] ?? null })),
    );
  }

  private async withLinks(from: string, entries: ParsedLogEntry[]): Promise<DayLogEntry[]> {
    const links = await this.resolve(from, entries.map((entry) => entry.links));
    return entries.map((entry, index) => ({ ...entry, links: links[index] }));
  }

  /** `Library/logs/<date> log.md`, and until the cleanup commit the Activity Log of `Inbox/Logs/<date>.md`. */
  private async log(root: string, date: string): Promise<Pick<VaultDay, "log" | "entries">> {
    const current = await this.file(root, DAY_LAYOUT.logs, logName(date));
    const legacy = await this.file(root, LEGACY_DAY_LAYOUT.logs, dailyName(date));
    const currentEntries = current ? (await this.parsed(current, parseLog)) ?? [] : [];
    const legacyEntries = legacy
      ? (await this.parsed(legacy, (source) => parseLog(splitDailyLog(source).activity))) ?? []
      : [];
    const entries = [
      ...(legacy ? await this.withLinks(legacy, legacyEntries) : []),
      ...(current ? await this.withLinks(current, currentEntries) : []),
    ];
    return {
      log: current ?? (legacyEntries.length > 0 ? legacy : null),
      entries: newestFirst(entries),
    };
  }

  private async chats(root: string, date: string) {
    const folder = await this.folder(root, DAY_LAYOUT.chats);
    if (!folder) return [];
    const children = await this.entries(folder);
    const cards = (
      await mapLimited(
        children.filter((entry) => entry.isFile() && entry.name.endsWith(".md")),
        READ_CONCURRENCY,
        async (entry): Promise<IndexedCard | null> => {
          const file = path.join(folder, entry.name);
          const card = await this.parsed(file, parseThreadCard);
          return card ? { thread: entry.name.slice(0, -3), path: file, card } : null;
        },
      )
    ).filter((card): card is IndexedCard => card !== null);
    const sessionFiles = (
      await Promise.all(
        children
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const thread = path.join(folder, entry.name);
            return (await this.entries(thread))
              .filter((child) => child.isFile() && child.name.endsWith(".md"))
              .map((child) => ({ thread: entry.name, path: path.join(thread, child.name) }));
          }),
      )
    ).flat();
    const sessions = (
      await mapLimited(sessionFiles, READ_CONCURRENCY, async ({ thread, path: file }): Promise<IndexedSession | null> => {
        const session = await this.parsed(file, parseSession);
        return session ? { thread, path: file, session } : null;
      })
    ).filter((session): session is IndexedSession => session !== null);
    return chatsForDay(date, cards, sessions);
  }

  /** `Library/recordings/<date> HHMM <name>.md`, and until the cleanup commit the same names in `Inbox/Recordings`. */
  private async recordings(root: string, date: string): Promise<DayRecording[]> {
    const seen = new Set<string>();
    const found: DayRecording[] = [];
    for (const relative of [DAY_LAYOUT.recordings, LEGACY_DAY_LAYOUT.recordings]) {
      const folder = await this.folder(root, relative);
      for (const entry of await this.entries(folder)) {
        const name = recordingName(entry.name);
        if (!folder || !entry.isFile() || !name || name.date !== date || seen.has(entry.name)) continue;
        const file = path.join(folder, entry.name);
        const note = await this.parsed(file, parseRecording);
        if (!note) continue;
        seen.add(entry.name);
        const [links] = await this.resolve(file, [note.links]);
        found.push({
          path: file,
          title: note.title ?? name.title,
          time: name.time,
          source: note.source,
          durationMin: note.durationMin,
          speakers: note.speakers,
          attendees: note.attendees,
          hasSummary: note.hasSummary,
          links,
        });
      }
    }
    return newestFirst(found.sort((a, b) => a.path.localeCompare(b.path)));
  }

  /** `Library/digests/<date> digest.md`, and until the cleanup commit `Inbox/Digests/<date>.md`. */
  private async digest(root: string, date: string) {
    const file =
      (await this.file(root, DAY_LAYOUT.digests, digestName(date))) ??
      (await this.file(root, LEGACY_DAY_LAYOUT.digests, dailyName(date)));
    if (!file) return null;
    const digest = await this.parsed(file, parseDigest);
    return digest ? { path: file, ...digest } : null;
  }
}
