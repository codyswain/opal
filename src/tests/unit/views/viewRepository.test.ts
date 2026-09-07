import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { ViewConflictError, ViewError, ViewRepository } from '@/main/views/ViewRepository';
import { emptyQuery, folderScope } from '@/common/collectionQuery';
import type { SavedViewDefinition } from '@/types/savedView';

let tmp: string;
let repository: ViewRepository;
let now = 1_700_000_000_000;
const onChanged = vi.fn();
const definition = (over: Partial<SavedViewDefinition> = {}): SavedViewDefinition => ({
  name: 'Project references',
  layout: 'list',
  query: { ...emptyQuery(folderScope('/Vault/Projects')), filters: [{ field: 'kind', op: 'in', values: ['pdf', 'image'] }, { field: 'tags', op: 'has-any', values: ['reference'] }] },
  ...over,
});

beforeEach(async () => {
  onChanged.mockClear();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-views-'));
  repository = new ViewRepository({ libraryDirectory: tmp, onChanged, changeDebounceMs: 0, now: () => now++ });
});
afterEach(async () => { await repository.close(); await rm(tmp, { recursive: true, force: true }); });

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('ViewRepository', () => {
  it('creates a readable YAML definition and lists it in order', async () => {
    const created = await repository.create(definition());
    const raw = await readFile(path.join(tmp, 'views', `${created.id}.yaml`), 'utf8');
    expect(raw).toContain('schema: 1');
    expect(raw).toContain(`id: ${created.id}`);
    expect(raw).toContain('name: Project references');
    expect(raw).toContain('layout: list');
    expect(raw).toContain('field: kind');
    expect(raw).not.toMatch(/selected|scroll|result/);
    const second = await repository.create(definition({ name: 'Needs tags', query: { ...emptyQuery(), filters: [{ field: 'tags', op: 'is-empty' }] } }));
    const listing = await new ViewRepository({ libraryDirectory: tmp }).list();
    expect(listing.views.map((view) => view.name)).toEqual(['Project references', 'Needs tags']);
    expect(listing.views[0]).toMatchObject({ id: created.id, layout: 'list', query: definition().query, revision: created.revision });
    expect(listing.unreadable).toEqual([]);
    expect(JSON.parse(await readFile(path.join(tmp, 'library.json'), 'utf8'))).toEqual({ version: 1, viewOrder: [created.id, second.id] });
    await tick();
    expect(onChanged).toHaveBeenCalled();
  });

  it('rejects invalid definitions before writing', async () => {
    await expect(repository.create(definition({ name: '   ' }))).rejects.toThrow(ViewError);
    await expect(repository.create({ ...definition(), layout: 'board' })).rejects.toThrow(/layout/i);
    await expect(repository.create({ ...definition(), query: { version: 1 } })).rejects.toThrow(ViewError);
    await expect(readdir(path.join(tmp, 'views'))).rejects.toThrow();
  });

  it('keeps unreadable files on disk and reports them', async () => {
    const created = await repository.create(definition());
    const views = path.join(tmp, 'views');
    await writeFile(path.join(views, 'broken.yaml'), 'name: [oops');
    await writeFile(path.join(views, '11111111-1111-4111-8111-111111111111.yaml'), 'schema: 2\nid: 11111111-1111-4111-8111-111111111111\nname: Future\nlayout: list\n');
    await writeFile(path.join(views, '22222222-2222-4222-8222-222222222222.yaml'), `schema: 1\nid: ${created.id}\nname: Mismatch\nlayout: list\nquery:\n  version: 1\n  scope: { kind: all-roots }\n  filters: []\n  sort: { field: name, direction: asc }\n`);
    const listing = await repository.list();
    expect(listing.views.map((view) => view.id)).toEqual([created.id]);
    expect(listing.unreadable.map((entry) => [path.basename(entry.file), entry.error])).toEqual([
      ['11111111-1111-4111-8111-111111111111.yaml', expect.stringMatching(/schema 2/)],
      ['22222222-2222-4222-8222-222222222222.yaml', expect.stringMatching(/does not match/)],
      ['broken.yaml', expect.stringMatching(/Malformed|does not match/)],
    ]);
    expect((await readdir(views)).filter((name) => name.endsWith('.yaml'))).toHaveLength(4);
  });

  it('saves with the current revision and refuses a stale one without touching the file', async () => {
    const created = await repository.create(definition());
    const saved = await repository.save(created.id, definition({ name: 'Renamed', layout: 'gallery' }), created.revision);
    expect(saved.revision).not.toBe(created.revision);
    expect((await repository.list()).views[0]).toMatchObject({ name: 'Renamed', layout: 'gallery' });
    // External edit: the file changes underneath a draft based on `saved`.
    const file = path.join(tmp, 'views', `${created.id}.yaml`);
    const external = (await readFile(file, 'utf8')).replace('name: Renamed', 'name: Edited elsewhere');
    await writeFile(file, external);
    await expect(repository.save(created.id, definition({ name: 'Draft' }), saved.revision)).rejects.toThrow(ViewConflictError);
    expect(await readFile(file, 'utf8')).toBe(external);
    expect((await readdir(path.join(tmp, 'views'))).some((name) => name.startsWith('.view-'))).toBe(false);
    const current = (await repository.list()).views[0];
    expect(current.name).toBe('Edited elsewhere');
    await expect(repository.save(current.id, definition({ name: 'Draft' }), current.revision)).resolves.toMatchObject({ name: 'Draft' });
    await expect(repository.save('33333333-3333-4333-8333-333333333333', definition(), 'x')).rejects.toThrow(/no longer exists/);
    await expect(repository.save('not-an-id', definition(), 'x')).rejects.toThrow(/Invalid view id/);
  });

  it('duplicates next to the source with a new id', async () => {
    const first = await repository.create(definition({ name: 'A' }));
    await repository.create(definition({ name: 'B' }));
    const copy = await repository.duplicate(first.id);
    expect(copy.id).not.toBe(first.id);
    expect(copy).toMatchObject({ name: 'A copy', query: first.query, layout: first.layout });
    expect((await repository.list()).views.map((view) => view.name)).toEqual(['A', 'A copy', 'B']);
  });

  it('removes into trash, restores with the same id, and bounds the trash', async () => {
    const created = await repository.create(definition());
    const { undoToken } = await repository.remove(created.id);
    expect((await repository.list()).views).toEqual([]);
    const trash = path.join(tmp, 'views', '.trash');
    expect(await readdir(trash)).toEqual([`${undoToken}.yaml`]);
    const restored = await repository.restore(undoToken);
    expect(restored.id).toBe(created.id);
    expect(restored.query).toEqual(created.query);
    expect((await repository.list()).views.map((view) => view.id)).toEqual([created.id]);
    await expect(repository.restore(undoToken)).rejects.toThrow(/no longer be restored/);
    await expect(repository.remove(created.id)).resolves.toBeTruthy();
    await expect(repository.remove(created.id)).rejects.toThrow(/no longer exists/);
    for (let index = 0; index < 22; index += 1) {
      const view = await repository.create(definition({ name: `v${index}` }));
      await repository.remove(view.id);
    }
    expect((await readdir(trash)).length).toBeLessThanOrEqual(20);
  });

  it('notices external changes while watching', async () => {
    await repository.watch();
    onChanged.mockClear();
    await mkdir(path.join(tmp, 'views'), { recursive: true });
    await writeFile(path.join(tmp, 'views', '44444444-4444-4444-8444-444444444444.yaml'), `schema: 1\nid: 44444444-4444-4444-8444-444444444444\nname: External\nlayout: list\nquery:\n  version: 1\n  scope: { kind: all-roots }\n  filters: []\n  sort: { field: name, direction: asc }\n`);
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled(), { timeout: 5000, interval: 25 });
    expect((await repository.list()).views.map((view) => view.name)).toEqual(['External']);
  });
});
