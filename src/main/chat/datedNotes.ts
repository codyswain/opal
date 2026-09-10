import path from 'path';
import { validDate } from '@/common/vaultModel';
import { readFile, stat } from 'fs/promises';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { scanRootsFor, walkRoot } from '@/main/fs/rootTraversal';
import { assertNoSymlinks, splitMarkdown } from '@/main/fs/MetadataCodec';
import type { IndexHit } from '@/types/chat';

export interface DateRequest { start: string; end: string; latest?: boolean }
export interface DatedContext { hits: IndexHit[]; coverage: string }
export function calendarDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function shifted(now: Date, days: number): string {
  const date = new Date(now); date.setDate(date.getDate() + days); return calendarDay(date);
}
/** Explicit calendar language is resolved before semantic similarity is considered. */
export function dateRequest(question: string, now: Date): DateRequest | null {
  const text = question.toLowerCase();
  const end = calendarDay(now);
  const explicit = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
  if (explicit.length) {
    if (explicit.some((date) => !validDate(date))) return null;
    if (explicit.length === 1) return { start: explicit[0], end: explicit[0] };
    const range = text.match(/\b(\d{4}-\d{2}-\d{2})\s+(?:to|through|until|and)\s+(\d{4}-\d{2}-\d{2})\b/);
    if (explicit.length === 2 && range) {
      const [start, finish] = [range[1], range[2]].sort();
      return { start, end: finish };
    }
    return null;
  }
  const weekday = (now.getDay() + 6) % 7;
  if (/\bthis week\b/.test(text)) return { start: shifted(now, -weekday), end };
  if (/\b(?:last|previous) week\b/.test(text)) return { start: shifted(now, -weekday - 7), end: shifted(now, -weekday - 1) };
  if (/\bthis month\b/.test(text)) return { start: calendarDay(new Date(now.getFullYear(), now.getMonth(), 1, 12)), end };
  if (/\b(?:last|previous) month\b/.test(text)) return {
    start: calendarDay(new Date(now.getFullYear(), now.getMonth() - 1, 1, 12)),
    end: calendarDay(new Date(now.getFullYear(), now.getMonth(), 0, 12)),
  };
  const days = text.match(/\b(?:last|past|previous)\s+(\d+|one|two|three|seven|ten|fourteen|thirty)\s+days?\b/);
  if (days) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, seven: 7, ten: 10, fourteen: 14, thirty: 30 };
    const count = words[days[1]] ?? Number(days[1]);
    if (count >= 1 && count <= 366) return { start: shifted(now, 1 - count), end };
  }
  if (/\byesterday\b/.test(text)) return { start: shifted(now, -1), end: shifted(now, -1) };
  if (/\btoday\b/.test(text)) return { start: end, end };
  if (/\bpast week\b/.test(text)) return { start: shifted(now, -6), end };
  if (/\bmost recent(?:ly)?\b/.test(text) || /\blatest\b.*\b(?:note|entry|journal|writing)/.test(text)) return { start: '0000-01-01', end, latest: true };
  return null;
}
function filenameDate(file: string): string | null {
  const match = path.basename(file).match(/^(\d{4}-\d{2}-\d{2})(?:$|[ ._-])/);
  if (!match) return null;
  const date = new Date(`${match[1]}T12:00:00`);
  return !Number.isNaN(date.getTime()) && calendarDay(date) === match[1] ? match[1] : null;
}

/** Reads only dated text notes in currently mounted roots, using shared traversal guards.
 * This deliberately bypasses stale embeddings; asking does not rebuild the index.
 */
export async function readDatedNotes(registry: RootRegistry, request: DateRequest): Promise<DatedContext> {
  const candidates: { file: string; date: string }[] = [];
  let unreadable = 0;
  for (const root of scanRootsFor(registry.list())) {
    await walkRoot(registry, root, {
      onDirectory: () => undefined,
      onFile: (file) => {
        if (!/\.(?:md|markdown|txt)$/i.test(file)) return;
        const date = filenameDate(file);
        if (date && date >= request.start && date <= request.end) candidates.push({ file, date });
      },
      onError: () => { unreadable += 1; },
    });
  }
  candidates.sort((a, b) => b.date.localeCompare(a.date) || a.file.localeCompare(b.file));
  const selected = request.latest ? candidates.filter((item) => item.date === candidates[0]?.date) : candidates;
  // Round-robin by date prevents a large collection on one day crowding out the others.
  const groups = new Map<string, typeof selected>();
  for (const item of selected) groups.set(item.date, [...(groups.get(item.date) ?? []), item]);
  const ordered: typeof selected = [];
  while ([...groups.values()].some((items) => items.length)) for (const items of groups.values()) { const item = items.shift(); if (item) ordered.push(item); }
  const hits: IndexHit[] = [];
  const dates = new Set<string>();
  let excerpted = 0;
  for (const { file, date } of ordered.slice(0, 60)) {
    try {
      await assertNoSymlinks(registry, file);
      if ((await stat(file)).size > 1024 * 1024) { unreadable += 1; continue; }
      const bytes = await readFile(file);
      let body = bytes.toString('utf8');
      if (/\.(?:md|markdown)$/i.test(file)) {
        try { body = bytes.subarray(splitMarkdown(bytes).bodyOffset).toString('utf8'); } catch { /* Keep readable malformed Markdown. */ }
      }
      if (!body.trim()) continue;
      if (body.length > 3000) excerpted += 1;
      hits.push({ path: file, chunkIndex: 0, start: 0, text: body.slice(0, 3000), score: 1 });
      dates.add(date);
    } catch { unreadable += 1; }
  }
  const period = request.latest ? `Newest dated notes on or before ${request.end}${selected[0] ? `: ${selected[0].date}` : ''}` : `${request.start} through ${request.end} (inclusive)`;
  const dayCount = request.latest ? 1 : Math.round((Date.parse(request.end) - Date.parse(request.start)) / 86400000) + 1;
  const coverage = `${period}. ${hits.length ? `Read ${hits.length} dated files across ${dates.size} days` : 'No readable dated notes found'}. ${dayCount - dates.size} days without readable dated notes. ${Math.max(0, ordered.length - 60)} files omitted by the 60-file limit; ${excerpted} files excerpted at 3,000 characters; ${unreadable} files or folders unreadable. Dates come from filenames, not modification times. This covers dated Markdown/text notes only, not all activity or all library formats. Missing notes do not mean nothing happened.`;
  return { hits, coverage };
}
