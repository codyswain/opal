import type { MarkdownDocument } from '@/types/markdown';
import { isFsPathAtOrBelow } from '@/common/fsPaths';
import { dailyBrief, parseCandidates, parseTasks, photoPaths, splitDailyLog, type Candidate, type DailyTask } from './dailyModel';

export interface DayData {
  document: MarkdownDocument | null;
  brief: string;
  digestPath: string | null;
  tasks: DailyTask[];
  candidates: Candidate[];
  photos: string[];
  warnings: string[];
}

export async function discoverVaults(roots: string[]): Promise<string[]> {
  const matches = await Promise.all(roots.map(async root => {
    const result = await window.diskAPI.readDirectory(`${root}/Inbox/Logs`);
    return result.success ? root : null;
  }));
  return matches.filter((root): root is string => root !== null);
}

export async function loadDay(root: string, day: string): Promise<DayData> {
  const warnings: string[] = [];
  const logPath = `${root}/Inbox/Logs/${day}.md`;
  const listing = await window.diskAPI.readDirectory(`${root}/Inbox/Logs`);
  if (!listing.success) throw new Error(listing.error);
  let document: MarkdownDocument | null = null;
  if (listing.data.entries.some(entry => entry.path === logPath)) {
    const result = await window.markdownAPI.read(logPath);
    if (!result.success) throw new Error(result.error);
    document = result.data;
  }
  const readOptional = async (folder: string, name: string): Promise<string | null> => {
    const files = await window.diskAPI.readDirectory(folder);
    if (!files.success) { warnings.push(`Could not read ${folder.slice(root.length + 1)}.`); return null; }
    if (!files.data.entries.some(entry => entry.name === name)) return null;
    const result = await window.diskAPI.readTextFile(`${folder}/${name}`);
    if (!result.success) { warnings.push(`${name}: ${result.error}`); return null; }
    if (result.data.truncated) { warnings.push(`${name} is too large for the daily view. Open its source to read it.`); return null; }
    return result.data.text;
  };
  const [digest, todo, triage] = await Promise.all([
    readOptional(`${root}/Inbox/Digests`, `${day}.md`),
    readOptional(`${root}/RAM`, 'todo.md'),
    readOptional(`${root}/RAM/triage`, 'state.json'),
  ]);
  let candidates: Candidate[] = [];
  if (triage !== null) {
    try { candidates = parseCandidates(triage); }
    catch { warnings.push('The action queue could not be read. Open RAM/triage/state.json to inspect it.'); }
  }
  const linked = photoPaths(splitDailyLog(document?.body ?? '').journal, root, `${root}/Inbox/Logs`);
  const folder = await window.diskAPI.readDirectory(`${root}/Photos/${day}`);
  const dated = folder.success ? folder.data.entries.filter(entry => entry.kind === 'image').map(entry => entry.path) : [];
  const checked = await Promise.all([...new Set([...linked, ...dated])].map(async path => {
    const result = await window.diskAPI.stat(path);
    return result.success && result.data.kind === 'image' && isFsPathAtOrBelow(root, result.data.path) ? result.data.path : null;
  }));
  return {
    document, brief: dailyBrief(digest ?? ''), digestPath: digest === null ? null : `${root}/Inbox/Digests/${day}.md`,
    tasks: parseTasks(todo ?? ''), candidates,
    photos: [...new Set(checked.filter((path): path is string => path !== null))], warnings,
  };
}

export async function createDay(root: string, day: string): Promise<void> {
  const directory = `${root}/Inbox/Logs`;
  const listing = await window.diskAPI.readDirectory(directory);
  if (!listing.success) throw new Error(listing.error);
  if (listing.data.entries.some(entry => entry.name === `${day}.md`)) return;
  const template = await window.markdownAPI.read(`${root}/Archive/Journal/Template.md`);
  const created = await window.markdownAPI.create(directory, day);
  if (!created.success) throw new Error(created.error);
  if (created.data.path !== `${directory}/${day}.md`) throw new Error('A daily log was created elsewhere at the same moment. Refresh to open it.');
  const empty = await window.markdownAPI.read(created.data.path);
  if (!empty.success) throw new Error(empty.error);
  // A routine may already have claimed this day after we created it.
  if (empty.data.body !== '' || empty.data.hasFrontmatter) return;
  const body = template.success ? splitDailyLog(template.data.body).journal : '## Morning\n### What matters today\n\n## Evening\n### What I want to remember\n';
  const saved = await window.markdownAPI.write(created.data.path, `${body.trimEnd()}\n\n---\n## Activity Log\n`, empty.data.revision);
  if (!saved.success) throw new Error(saved.error);
}
