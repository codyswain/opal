import type { MarkdownAPI } from '@/renderer/shared/types/markdownApi';

export interface DailyTask { line: number; text: string; raw: string }
export interface Candidate { id: string; title: string; status: 'active' | 'pending'; context?: string; source?: string }
type JournalAPI = Pick<MarkdownAPI, 'read' | 'write'>;

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && localDate(new Date(`${value}T12:00:00`)) === value;
}
export function shiftDate(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDate(date);
}

/** Routine-owned activity starts only at a real level-two heading outside code. */
export function splitDailyLog(body: string): { journal: string; activity: string } {
  let offset = 0;
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = null;
    } else if (!fence && /^##\s+Activity Log\s*#*\s*$/.test(line)) {
      return { journal: body.slice(0, offset), activity: body.slice(offset) };
    }
    offset += line.length + 1;
  }
  return { journal: body, activity: '' };
}

export function dailyBrief(body: string): string {
  const section = body.split(/^##\s+The brief\s*$/m)[1];
  if (!section) return '';
  return section.split(/^(?:>|##\s)/m)[0].trim();
}
export function parseTasks(body: string): DailyTask[] {
  return body.split('\n').flatMap((raw, line) => {
    const match = raw.match(/^\s*[-*+] \[ \]\s+(.+?)\s*$/);
    return match?.[1].trim() ? [{ line, raw, text: match[1] }] : [];
  });
}
export function parseCandidates(text: string, today = localDate()): Candidate[] {
  const data = JSON.parse(text);
  if (!data || typeof data.items !== 'object' || data.items === null || Array.isArray(data.items)) throw new Error('The action queue has an unsupported format.');
  return Object.entries(data.items).flatMap(([id, value]) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (item.status !== 'active' && item.status !== 'pending') return [];
    if (typeof item.snoozeUntil === 'string' && item.snoozeUntil.slice(0, 10) > today) return [];
    return [{ id, title: typeof item.title === 'string' ? item.title : id.replace(/^linear:/, ''), status: item.status,
      context: typeof item.context === 'string' ? item.context : undefined,
      source: typeof item.source === 'string' ? item.source : undefined } as Candidate];
  }).sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'));
}

function resolvePhoto(reference: string, base: string, root: string): string | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith('/') || reference.includes('\\')) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(reference); } catch { return null; }
  if (!/\.(?:png|jpe?g|webp|gif|avif|heic)$/i.test(decoded)) return null;
  const parts = base.split('/').filter(Boolean);
  for (const part of decoded.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  const result = '/' + parts.join('/');
  return result.startsWith(root.replace(/\/$/, '') + '/') ? result : null;
}
export function photoPaths(body: string, root: string, folder: string): string[] {
  const paths: string[] = [];
  for (const match of body.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(([^)]+)\)/g)) {
    const reference = (match[1] ?? match[2]).trim().replace(/^<|>$/g, '');
    const resolved = resolvePhoto(reference, match[1] ? root : folder, root);
    if (resolved) paths.push(resolved);
  }
  return [...new Set(paths)];
}

export async function saveJournal(api: JournalAPI, path: string, original: string, next: string): Promise<string> {
  const journal = next && !next.endsWith('\n') ? next + '\n' : next;
  if (splitDailyLog(journal).activity) throw new Error('Keep the Activity Log heading outside your journal; routines own that section.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const loaded = await api.read(path);
    if (!loaded.success) throw new Error(loaded.error);
    const parts = splitDailyLog(loaded.data.body);
    if (parts.journal !== original) throw new Error('Your journal changed in another editor. Your draft is kept here; open the source to compare before retrying.');
    const result = await api.write(path, journal + parts.activity, loaded.data.revision);
    if (result.success) return journal;
    if (!result.conflict) throw new Error(result.error);
  }
  throw new Error('The daily file is still changing. Your draft is kept; try saving again.');
}

export async function completeTask(api: JournalAPI, path: string, task: DailyTask): Promise<void> {
  const loaded = await api.read(path);
  if (!loaded.success) throw new Error(loaded.error);
  const lines = loaded.data.body.split('\n');
  if (lines[task.line] !== task.raw) throw new Error('This task changed on disk. Refresh the queue before completing it.');
  lines[task.line] = task.raw.replace('[ ]', '[x]');
  const result = await api.write(path, lines.join('\n'), loaded.data.revision);
  if (!result.success) throw new Error(result.error);
}
