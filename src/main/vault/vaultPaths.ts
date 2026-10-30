import { lstat } from "fs/promises";
import path from "path";
import type { RootRegistry } from "@/main/fs/RootRegistry";
import { isInsideRoot } from "@/main/fs/paths";

/** Where a vault keeps each part of a day, relative to its root. */
export const DAY_LAYOUT = {
  daily: "Library/daily",
  logs: "Library/logs",
  recordings: "Library/recordings",
  digests: "Library/digests",
  chats: "Library/chats",
  people: "Library/people",
  template: "Archive/Journal/Template.md",
} as const;

/**
 * Where days lived before the Library move. Read until the cleanup commit, so
 * a machine that has not moved yet still shows its days.
 */
export const LEGACY_DAY_LAYOUT = {
  logs: "Inbox/Logs",
  recordings: "Inbox/Recordings",
  digests: "Inbox/Digests",
} as const;

export const dailyName = (date: string) => `${date}.md`;
export const logName = (date: string) => `${date} log.md`;
export const digestName = (date: string) => `${date} digest.md`;

/**
 * Whether a path from the vault root, with forward slashes, names a digest:
 * `Library/digests/<date> digest.md`, or until the cleanup commit
 * `Inbox/Digests/<date>.md`.
 */
export function isDigestPath(relative: string): boolean {
  const folder = path.posix.dirname(relative);
  const name = path.posix.basename(relative);
  const date = /^(\d{4}-\d\d-\d\d)(?: digest)?\.md$/.exec(name);
  if (!date) return false;
  if (folder === DAY_LAYOUT.digests) return name === digestName(date[1]);
  return folder === LEGACY_DAY_LAYOUT.digests && name === dailyName(date[1]);
}

export const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/** The canonical path of an opened folder, refusing anything else. */
export async function openedVault(
  registry: RootRegistry,
  target: string,
): Promise<string> {
  if (typeof target !== "string" || !path.isAbsolute(target))
    throw new Error("Choose an opened vault folder.");
  const canonical = await registry.assertAllowed(target);
  if (!registry.list().includes(canonical))
    throw new Error("Choose an opened vault folder.");
  return canonical;
}

/** Rejects links at every vault-owned segment, including missing-file ancestors. */
export async function inVault(
  root: string,
  target: string,
  allowMissing = false,
): Promise<string> {
  const normalized = path.resolve(target);
  if (!isInsideRoot(root, normalized))
    throw new Error("This source is outside the selected vault.");
  let cursor = root;
  const parts = path.relative(root, normalized).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    cursor = path.join(cursor, parts[index]);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink())
        throw new Error("Symlinks are not supported in vault folders.");
      if (index < parts.length - 1 && !info.isDirectory())
        throw new Error("A vault folder is not a directory.");
    } catch (error) {
      if (allowMissing && missing(error)) return normalized;
      throw error;
    }
  }
  return normalized;
}
