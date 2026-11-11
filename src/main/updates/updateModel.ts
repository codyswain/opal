import path from 'path';
import type { AvailableUpdate, BuildIdentity } from '@/types/updates';

/**
 * The rules behind updates, with no I/O: where builds may come from, what a
 * source's latest.json must say, which build is ready, and how Opal names the
 * copies of itself it keeps.
 */

/** A place that holds latest.json and the zip it names. */
export type UpdateSource =
  | { kind: 'folder'; path: string }
  | { kind: 'https'; url: string };

/** A source's latest.json, checked. */
export interface LatestBuild extends AvailableUpdate {
  file: string;
  sha256: string;
}

/** More than this many sources is a mistake, not a setup. */
const SOURCE_LIMIT = 20;
const NOTES_LIMIT = 300;
const COMMIT = /^[0-9a-f]{4,40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** A plain file name in the source, so latest.json cannot point anywhere else. */
const ZIP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.zip$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A UTC time in ISO 8601, or null. */
export function isoTime(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * One entry of updates.json: an absolute folder (a leading `~` is the home
 * folder) or an https address. Plain http, other schemes and relative paths
 * are refused.
 */
export function parseSource(entry: unknown, home: string): UpdateSource | null {
  if (typeof entry !== 'string') return null;
  const value = entry.trim();
  if (!value || value.length > 4096 || value.includes('\0')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return { kind: 'https', url: url.toString().replace(/\/+$/, '') };
  }
  const expanded = value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) return null;
  return { kind: 'folder', path: path.resolve(expanded) };
}

/** `<userData>/updates.json`: `{ "version": 1, "sources": [...] }`. Anything unreadable is no sources. */
export function parseSources(text: string | null, home: string): UpdateSource[] {
  if (text === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!object(value) || value.version !== 1 || !Array.isArray(value.sources)) return [];
  return value.sources
    .slice(0, SOURCE_LIMIT)
    .map((entry) => parseSource(entry, home))
    .filter((source): source is UpdateSource => source !== null);
}

/** A source's latest.json, or null when any field is missing or malformed. */
export function parseLatest(value: unknown): LatestBuild | null {
  if (!object(value) || value.version !== 1) return null;
  const { commit, builtAt, file, sha256, notes } = value;
  if (typeof commit !== 'string' || !COMMIT.test(commit)) return null;
  if (isoTime(builtAt) === null) return null;
  if (typeof file !== 'string' || !ZIP_NAME.test(file)) return null;
  if (typeof sha256 !== 'string' || !SHA256.test(sha256.toLowerCase())) return null;
  if (notes !== undefined && typeof notes !== 'string') return null;
  const line = (typeof notes === 'string' ? notes : '').replace(/\s+/g, ' ').trim().slice(0, NOTES_LIMIT);
  return { commit, builtAt: builtAt as string, file, sha256: sha256.toLowerCase(), notes: line };
}

/** A build is ready when its commit differs from the running one and it was built later. */
export function isNewer(build: BuildIdentity, current: BuildIdentity | null): boolean {
  if (!current) return false;
  const later = isoTime(build.builtAt);
  const now = isoTime(current.builtAt);
  return later !== null && now !== null && build.commit !== current.commit && later > now;
}

/** Of the builds the sources offer, the latest that is newer than the running one. An earlier source wins a tie. */
export function pickUpdate<T extends { build: LatestBuild }>(found: readonly T[], current: BuildIdentity | null): T | null {
  let best: T | null = null;
  for (const candidate of found) {
    if (!isNewer(candidate.build, current)) continue;
    if (!best || (isoTime(candidate.build.builtAt) as number) > (isoTime(best.build.builtAt) as number)) best = candidate;
  }
  return best;
}

/** Only names Opal gave its own copies; anything else in the backups folder is never touched. */
export const BACKUP_NAME = /^Opal-update-(\d{8}T\d{6}Z)-([0-9a-f]{4,40})\.app$/;
/** The same pattern for the helper's bash `[[ =~ ]]`. */
export const BACKUP_NAME_BASH = '^Opal-update-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{4,40}\\.app$';
/** How many of its own copies the helper keeps. */
export const BACKUPS_KEPT = 2;

/** `2026-01-05T07:40:00Z` as `20260105T074000Z`, so names sort by time. */
function stamp(builtAt: string): string {
  return builtAt.replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');
}

/** The name of the kept copy of a build: `Opal-update-<builtAt>-<commit>.app`. */
export function backupName(build: BuildIdentity): string {
  return `Opal-update-${stamp(build.builtAt)}-${build.commit}.app`;
}

/** The build a kept copy holds, read from its name, or null for a name Opal did not give. */
export function parseBackupName(name: string): BuildIdentity | null {
  const match = BACKUP_NAME.exec(name);
  if (!match) return null;
  const [, compact, commit] = match;
  const builtAt = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}Z`;
  return isoTime(builtAt) === null ? null : { commit, builtAt };
}

/** The kept copy Roll Back puts back: the newest one built before the running build. */
export function rollBackTarget(names: readonly string[], current: BuildIdentity | null): string | null {
  const now = current ? isoTime(current.builtAt) : null;
  if (now === null) return null;
  let best: { name: string; time: number } | null = null;
  for (const name of names) {
    const build = parseBackupName(name);
    if (!build || build.commit === current?.commit) continue;
    const time = isoTime(build.builtAt) as number;
    if (time < now && (!best || time > best.time)) best = { name, time };
  }
  return best?.name ?? null;
}

/** `<userData>/update-state.json`: the commit last rolled back from, whose row stays hidden. */
export function parseSkipped(text: string | null): string | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return object(value) && typeof value.rolledBackFrom === 'string' && COMMIT.test(value.rolledBackFrom)
      ? value.rolledBackFrom
      : null;
  } catch {
    return null;
  }
}
