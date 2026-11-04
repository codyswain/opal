// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import { RootRegistry } from '@/main/fs/RootRegistry';
import { DigestReviewService, parseDigestReview } from '@/main/vault/DigestReviewService';
import type { DigestReviewRecord } from '@/types/digestReview';

const date = '2026-11-04';
const id = 'a'.repeat(64);
const record = (): DigestReviewRecord => ({
  schemaVersion: 1, id, date, createdAt: '2026-11-04T15:00:00Z', status: 'ready', budgetUsd: 0.25,
  source: { digestPath: `Library/digests/${date} digest.md`, sha256: 'b'.repeat(64), section: 'Top 3' },
  variants: {
    A: { kind: 'concise', items: [{ title: 'Answer Tom', detail: '[Tom](https://example.test/tom) asked.', checked: true }] },
    B: { kind: 'current', items: [{ title: 'Answer Tom on the transfer', detail: '[Tom](https://example.test/tom) asked.', checked: true }] },
  },
  generation: { model: 'claude-opus-5-5', reservedUsd: 0.25, maxOutputTokens: 4096, costUsd: 0.03 },
});
let temporary: string, root: string, folder: string, registry: RootRegistry, service: DigestReviewService;
beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-digest-review-'));
  root = path.join(temporary, 'vault');
  folder = path.join(root, 'Library/digests/reviews');
  await mkdir(folder, { recursive: true });
  registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
  root = await registry.add(root);
  service = new DigestReviewService({ registry, now: () => new Date('2026-11-04T18:00:00Z') });
  await writeFile(path.join(folder, `${date}.json`), JSON.stringify(record()));
  await writeFile(path.join(root, `Library/digests/${date} digest.md`), 'Canonical digest must stay byte-identical.\n');
});
afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

describe('DigestReviewService', () => {
  it('withholds identity and cost until reveal, exposing display text only', async () => {
    const result = await service.read(root, date);
    expect(result).toMatchObject({ id, revealed: false, variants: { A: { items: [{ title: 'Answer Tom', detail: 'Tom asked.', checked: true }] } } });
    expect(result).not.toHaveProperty('labels');
    expect(result).not.toHaveProperty('costUsd');
    expect(result?.variants?.A).not.toHaveProperty('kind');
  });
  it('persists a blind first vote across revisions and fresh service instances without changing the digest', async () => {
    const original = await readFile(path.join(root, `Library/digests/${date} digest.md`), 'utf8');
    const first = await service.vote(root, date, id, 'A', 'brief');
    expect(first).toMatchObject({ revealed: true, vote: { choice: 'A', blind: true }, labels: { A: 'Shorter headings', B: 'Current digest' }, costUsd: 0.03 });
    await service.vote(root, date, id, 'B', 'more context');
    const stored = JSON.parse(await readFile(path.join(folder, `${date}.vote.json`), 'utf8'));
    expect(stored.firstVote).toMatchObject({ choice: 'A', reason: 'brief', blind: true });
    expect(stored.vote).toMatchObject({ choice: 'B', reason: 'more context', blind: false });
    expect((await new DigestReviewService({ registry }).read(root, date))?.vote?.choice).toBe('B');
    expect(await readFile(path.join(root, `Library/digests/${date} digest.md`), 'utf8')).toBe(original);
  });
  it('records a reveal before voting as an unblinded choice', async () => {
    await service.reveal(root, date, id);
    await service.vote(root, date, id, 'tie', '');
    expect(JSON.parse(await readFile(path.join(folder, `${date}.vote.json`), 'utf8')).firstVote.blind).toBe(false);
  });
  it('serializes concurrent votes, retaining one first vote', async () => {
    await Promise.all([service.vote(root, date, id, 'A', 'first'), service.vote(root, date, id, 'B', 'second')]);
    const stored = JSON.parse(await readFile(path.join(folder, `${date}.vote.json`), 'utf8'));
    expect(stored.firstVote.choice).toBe('A');
    expect(stored.vote.choice).toBe('B');
  });
  it('refuses stale ids, invalid dates, and a symlinked vote file', async () => {
    await expect(service.vote(root, date, 'c'.repeat(64), 'A', '')).rejects.toThrow('changed');
    await expect(service.read(root, '../../elsewhere')).rejects.toThrow('valid calendar');
    const outside = path.join(temporary, 'outside.json'); await writeFile(outside, 'keep');
    await symlink(outside, path.join(folder, `${date}.vote.json`));
    await expect(service.vote(root, date, id, 'A', '')).rejects.toThrow('left unchanged');
    expect(await readFile(outside, 'utf8')).toBe('keep');
  });
  it('does not overwrite malformed or unrelated saved feedback', async () => {
    const file = path.join(folder, `${date}.vote.json`);
    await writeFile(file, '{broken');
    await expect(service.vote(root, date, id, 'A', '')).rejects.toThrow('left unchanged');
    expect(await readFile(file, 'utf8')).toBe('{broken');
  });
  it('rejects pairs whose detail facts or checkbox states differ', () => {
    const changed = record(); changed.variants!.B.items[0].detail = 'Different facts';
    expect(parseDigestReview(changed, date)).toBeNull();
    const checked = record(); checked.variants!.B.items[0].checked = false;
    expect(parseDigestReview(checked, date)).toBeNull();
  });
});
