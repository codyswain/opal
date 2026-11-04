import { randomUUID } from 'crypto';
import { constants } from 'fs';
import { open, rename, unlink } from 'fs/promises';
import path from 'path';
import { filesystemMutationQueue } from '@/main/fs/MutationQueue';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { plainText } from '@/common/dayModel';
import { validDate } from '@/common/vaultModel';
import type { DigestReview, DigestReviewChoice, DigestReviewItem, DigestReviewRecord, DigestReviewVote, DigestReviewVoteRecord } from '@/types/digestReview';
import { inVault, missing, openedVault } from './vaultPaths';

const FOLDER = 'Library/digests/reviews';
const LIMIT = 256 * 1024;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit && !value.includes('\0');
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown): value is string => text(value, 100) && Number.isFinite(Date.parse(value));
const money = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export const isDigestReviewChoice = (value: unknown): value is DigestReviewChoice => ['A', 'B', 'tie', 'neither'].includes(value as string);

function items(value: unknown): value is DigestReviewItem[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 3 && value.every(item =>
    object(item) && text(item.title, 1000) && item.title.trim().length > 0 && !/[\r\n]/.test(item.title) && text(item.detail, 16000) && typeof item.checked === 'boolean');
}

export function parseDigestReview(value: unknown, date: string): DigestReviewRecord | null {
  if (!object(value) || value.schemaVersion !== 1 || value.date !== date || !identifier(value.id) || !timestamp(value.createdAt) ||
    !['generating', 'ready', 'failed', 'skipped'].includes(value.status as string) || !money(value.budgetUsd) ||
    !object(value.source) || value.source.digestPath !== `Library/digests/${date} digest.md` || !identifier(value.source.sha256) || value.source.section !== 'Top 3' ||
    !object(value.generation) || !text(value.generation.model, 200) || !money(value.generation.reservedUsd) ||
    !Number.isInteger(value.generation.maxOutputTokens) || (value.generation.maxOutputTokens as number) < 0 || (value.generation.maxOutputTokens as number) > 8192) return null;
  if (value.generation.costUsd !== undefined && !money(value.generation.costUsd)) return null;
  if (value.status === 'ready') {
    if (!object(value.variants) || !object(value.variants.A) || !object(value.variants.B)) return null;
    const { A, B } = value.variants;
    if (!['current', 'concise'].includes(A.kind as string) || !['current', 'concise'].includes(B.kind as string) || A.kind === B.kind || !items(A.items) || !items(B.items) || A.items.length !== B.items.length) return null;
    if (A.items.some((item, index) => item.detail !== (B.items as DigestReviewItem[])[index].detail || item.checked !== (B.items as DigestReviewItem[])[index].checked)) return null;
  }
  return value as unknown as DigestReviewRecord;
}

function vote(value: unknown): value is DigestReviewVote {
  return object(value) && isDigestReviewChoice(value.choice) && text(value.reason, 1000) && timestamp(value.chosenAt) && typeof value.blind === 'boolean';
}

function parseVotes(value: unknown, date: string, id: string): DigestReviewVoteRecord | null {
  if (!object(value) || value.schemaVersion !== 1 || value.date !== date || value.reviewId !== id ||
    (value.firstVote !== undefined && !vote(value.firstVote)) || (value.vote !== undefined && !vote(value.vote)) ||
    (value.revealedAt !== undefined && !timestamp(value.revealedAt))) return null;
  return value as unknown as DigestReviewVoteRecord;
}

/** Reads frozen pairs and writes only the separate, vault-synced vote file. */
export class DigestReviewService {
  constructor(private deps: { registry: RootRegistry; now?: () => Date }) {}

  read(target: string, date: string): Promise<DigestReview | null> {
    return filesystemMutationQueue.run(async () => {
      this.checkDate(date);
      const root = await openedVault(this.deps.registry, target);
      const record = await this.record(root, date);
      if (!record) return null;
      const stored = await this.json(root, `${date}.vote.json`);
      return this.view(record, parseVotes(stored, date, record.id));
    });
  }

  vote(target: string, date: string, id: string, choice: DigestReviewChoice, reason: string): Promise<DigestReview> {
    if (!isDigestReviewChoice(choice) || !text(reason, 1000)) return Promise.reject(new Error('Choose A, B, no preference or both need work.'));
    return this.update(target, date, id, previous => {
      const chosenAt = (this.deps.now?.() ?? new Date()).toISOString();
      const current: DigestReviewVote = { choice, reason: reason.trim(), chosenAt, blind: !previous.revealedAt };
      return { ...previous, firstVote: previous.firstVote ?? current, vote: current, revealedAt: previous.revealedAt ?? chosenAt };
    });
  }

  reveal(target: string, date: string, id: string): Promise<DigestReview> {
    return this.update(target, date, id, previous => ({ ...previous, revealedAt: previous.revealedAt ?? (this.deps.now?.() ?? new Date()).toISOString() }));
  }

  private update(target: string, date: string, id: string, change: (previous: DigestReviewVoteRecord) => DigestReviewVoteRecord): Promise<DigestReview> {
    return filesystemMutationQueue.run(async () => {
      this.checkDate(date);
      if (!identifier(id)) throw new Error('This comparison is no longer available.');
      const root = await openedVault(this.deps.registry, target);
      const record = await this.record(root, date);
      if (!record || record.status !== 'ready' || record.id !== id) throw new Error('This comparison changed. Reopen it before voting.');
      const raw = await this.json(root, `${date}.vote.json`);
      const stored = parseVotes(raw, date, id);
      if (raw !== null && !stored) throw new Error('The saved review could not be read. It has been left unchanged.');
      const next = change(stored ?? { schemaVersion: 1, date, reviewId: id });
      await this.write(root, `${date}.vote.json`, next);
      return this.view(record, next);
    });
  }

  private checkDate(date: string): void {
    if (typeof date !== 'string' || !validDate(date)) throw new Error('Choose a valid calendar date.');
  }

  private async record(root: string, date: string): Promise<DigestReviewRecord | null> {
    return parseDigestReview(await this.json(root, `${date}.json`), date);
  }

  private view(record: DigestReviewRecord, votes: DigestReviewVoteRecord | null): DigestReview {
    const revealed = !!votes?.revealedAt;
    const display = (value: { items: DigestReviewItem[] }) => ({ items: value.items.map(item => ({ ...item, title: plainText(item.title), detail: plainText(item.detail) })) });
    return {
      id: record.id, date: record.date, createdAt: record.createdAt, status: record.status, budgetUsd: record.budgetUsd, revealed,
      ...(record.variants && record.status === 'ready' ? { variants: { A: display(record.variants.A), B: display(record.variants.B) } } : {}),
      ...(revealed && record.variants ? { labels: { A: record.variants.A.kind === 'current' ? 'Current digest' : 'Shorter headings', B: record.variants.B.kind === 'current' ? 'Current digest' : 'Shorter headings' }, costUsd: record.generation.costUsd } : {}),
      ...(votes?.vote ? { vote: votes.vote } : {}),
    };
  }

  private async json(root: string, name: string): Promise<unknown | null> {
    let handle;
    try {
      const file = await inVault(root, path.join(root, FOLDER, name));
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > LIMIT) throw new Error('The saved comparison is too large.');
      return JSON.parse(await handle.readFile('utf8'));
    } catch (error) {
      if (missing(error)) return null;
      throw new Error('The saved comparison could not be read. It has been left unchanged.');
    } finally {
      await handle?.close();
    }
  }

  private async write(root: string, name: string, record: DigestReviewVoteRecord): Promise<void> {
    const folder = path.join(root, FOLDER);
    await inVault(root, folder);
    const file = await inVault(root, path.join(folder, name), true);
    const temporary = path.join(folder, `.${name}-${randomUUID()}`);
    try {
      const handle = await open(temporary, 'wx', 0o644);
      try { await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
    } finally { await unlink(temporary).catch(() => undefined); }
  }
}
