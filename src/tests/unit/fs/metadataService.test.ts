import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, rename, symlink, chmod } from 'fs/promises';
import path from 'path';
import os from 'os';
import { MetadataService } from '@/main/fs/MetadataService';
import { RootRegistry } from '@/main/fs/RootRegistry';

let tmp: string;
let root: string;
let registry: RootRegistry;
let service: MetadataService;
const props = { tags: ['project', 'blue'], description: 'A useful item' };
const item = (name: string) => path.join(root, name);
async function save(target: string, values = props) {
  return service.saveProperties(target, values, (await service.read(target)).revision);
}
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-metadata-'));
  root = path.join(tmp, 'root');
  await mkdir(root);
  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  root = await registry.add(root);
  service = new MetadataService({ registry });
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('durable properties', () => {
  it.each(['note.md', 'photo.jpg', 'folder'])('persists %s without allocating identity on read', async (name) => {
    const target = item(name);
    if (name === 'folder') await mkdir(target); else await writeFile(target, 'body');
    const before = await readdir(root, { recursive: true });
    expect((await service.read(target)).id).toBeNull();
    expect(await readdir(root, { recursive: true })).toEqual(before);
    const saved = await save(target);
    expect(saved.id).toMatch(/^[a-f\d-]{36}$/);
    service = new MetadataService({ registry });
    const loaded = await service.read(target);
    expect(loaded.properties).toEqual(props);
    expect(loaded.id).toBe(saved.id);
  });
  it('preserves Markdown body bytes, BOM, CRLF and unrelated YAML comments/fields', async () => {
    const body = Buffer.from([35, 32, 104, 105, 13, 10, 0xff, 0, 10]);
    await writeFile(item('a.md'), Buffer.concat([Buffer.from('\ufeff---\r\n# retain\r\ncustom: value # comment\r\n---\r\n'), body]));
    await save(item('a.md'));
    const bytes = await readFile(item('a.md'));
    expect(bytes.subarray(-body.length)).toEqual(body);
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from('\ufeff'));
    expect(bytes.toString()).toContain('custom: value # comment\r\n');
    expect(bytes.toString()).toContain('# retain\r\n');
  });
  it('rejects stale revisions without overwriting external changes', async () => {
    await writeFile(item('a.md'), '# before');
    const original = await service.read(item('a.md'));
    await writeFile(item('a.md'), '# external');
    await expect(service.saveProperties(item('a.md'), props, original.revision)).rejects.toThrow(/changed|conflict/i);
    expect(await readFile(item('a.md'), 'utf8')).toBe('# external');
  });
  it.each([
    ['malformed', 'tags: [oops'],
    ['alias', 'other: &value hello\ntags: [*value]'],
    ['custom tag', 'other: !secret value'],
    ['oversize', `other: ${'x'.repeat(65536)}`],
    ['unsupported schema', 'opal: {schema: 2, id: 8}'],
    ['invalid tags', 'tags: wrong'],
  ])('rejects %s and never replaces it', async (_, yaml) => {
    const original = `---\n${yaml}\n---\nbody`;
    await writeFile(item('a.md'), original);
    await expect(service.saveProperties(item('a.md'), props, 'any')).rejects.toThrow();
    expect(await readFile(item('a.md'), 'utf8')).toBe(original);
  });
  it('rejects collisions and symlink carriers or paths even within allowed roots', async () => {
    await writeFile(item('a.jpg'), 'bytes');
    await writeFile(item('a.jpg.opal.yaml'), 'unrelated: true');
    await expect(service.read(item('a.jpg'))).rejects.toThrow(/collision|schema/i);
    await rm(item('a.jpg.opal.yaml'));
    await writeFile(item('other.yaml'), 'keep');
    await symlink(item('other.yaml'), item('a.jpg.opal.yaml'));
    await expect(service.read(item('a.jpg'))).rejects.toThrow(/symlink/i);
    await mkdir(item('dir'));
    await writeFile(item('dir/a.md'), 'body');
    await symlink(item('dir'), item('shortcut'));
    await expect(service.read(item('shortcut/a.md'))).rejects.toThrow(/symlink/i);
    expect(await readFile(item('other.yaml'), 'utf8')).toBe('keep');
  });
  it.each([
    { tags: Array(33).fill('tag'), description: '' },
    { tags: ['x'.repeat(65)], description: '' },
    { tags: [], description: 'x'.repeat(8193) },
  ])('enforces property limits', async (values) => {
    await writeFile(item('a.md'), 'body');
    await expect(save(item('a.md'), values)).rejects.toThrow(/limit|tags|description/i);
    expect(await readFile(item('a.md'), 'utf8')).toBe('body');
  });
  it('refuses oversized writable Markdown without changing it', async () => {
    await writeFile(item('a.md'), Buffer.alloc(16 * 1024 * 1024 + 1, 65));
    await expect(save(item('a.md'))).rejects.toThrow(/large|limit/i);
  });
  it('cleans atomic temporary files and preserves original on replacement failure', async () => {
    await writeFile(item('a.md'), 'body');
    service = new MetadataService({ registry, renameEntry: async () => { throw new Error('injected rename failure'); } });
    await expect(save(item('a.md'))).rejects.toThrow(/injected/);
    expect(await readFile(item('a.md'), 'utf8')).toBe('body');
    expect(await readdir(root)).toEqual(['a.md']);
  });
});

describe('Related catalog', () => {
  beforeEach(async () => { await writeFile(item('a.md'), 'A'); await writeFile(item('b.jpg'), 'B'); });
  it('authors once, resolves from both endpoints after reload and removes from the reverse end', async () => {
    const a = await service.addRelated(item('a.md'), item('b.jpg'));
    expect(a.related).toHaveLength(1);
    const edge = a.related[0];
    expect(edge.status).toBe('available');
    expect(edge.targetPath).toBe(item('b.jpg'));
    const binary = await readFile(item('b.jpg.opal.yaml'), 'utf8');
    expect(binary).not.toContain('targetId:');
    service = new MetadataService({ registry });
    const b = await service.read(item('b.jpg'));
    expect(b.related[0]).toMatchObject({ edgeId: edge.edgeId, targetPath: item('a.md'), direction: 'incoming' });
    await service.removeRelated(item('b.jpg'), edge.edgeId);
    expect((await service.read(item('a.md'))).related).toEqual([]);
    expect(await readFile(item('b.jpg'), 'utf8')).toBe('B');
  });
  it('does not duplicate a connection added from its reverse endpoint', async () => {
    await service.addRelated(item('a.md'), item('b.jpg'));
    expect((await service.addRelated(item('b.jpg'), item('a.md'))).related).toHaveLength(1);
  });
  it('uses IDs after rename, marks missing IDs and never rebinds a path replacement', async () => {
    await service.addRelated(item('a.md'), item('b.jpg'));
    await rename(item('b.jpg'), item('renamed.jpg'));
    await rename(item('b.jpg.opal.yaml'), item('renamed.jpg.opal.yaml'));
    service.invalidate();
    expect((await service.read(item('a.md'))).related[0].targetPath).toBe(item('renamed.jpg'));
    await rm(item('renamed.jpg'));
    await rm(item('renamed.jpg.opal.yaml'));
    await writeFile(item('b.jpg'), 'replacement');
    service.invalidate();
    expect((await service.read(item('a.md'))).related[0]).toMatchObject({ status: 'missing', targetPath: null });
  });
  it('reports duplicate IDs as ambiguous and refuses new ambiguous connections', async () => {
    await service.addRelated(item('a.md'), item('b.jpg'));
    await writeFile(item('copy.jpg'), 'B2');
    await writeFile(item('copy.jpg.opal.yaml'), await readFile(item('b.jpg.opal.yaml')));
    service.invalidate();
    expect((await service.read(item('a.md'))).related[0].status).toBe('ambiguous');
    await expect(service.addRelated(item('a.md'), item('copy.jpg'))).rejects.toThrow(/ambiguous|duplicate/i);
  });
  it('deduplicates overlapping roots, notices changed roots and skips hidden/symlink trees', async () => {
    await mkdir(item('sub'));
    await rename(item('b.jpg'), item('sub/b.jpg'));
    await registry.add(item('sub'));
    await service.addRelated(item('a.md'), item('sub/b.jpg'));
    expect((await service.read(item('a.md'))).related[0].status).toBe('available');
    await symlink(item('sub'), item('alias'));
    service.invalidate();
    expect((await service.read(item('a.md'))).related[0].status).toBe('available');
    await registry.remove(root);
    expect((await service.read(item('sub/b.jpg'))).related).toEqual([]);
  });
  it('surfaces incomplete catalog warnings without losing healthy connections', async () => {
    await service.addRelated(item('a.md'), item('b.jpg'));
    await writeFile(item('bad.md'), '---\ntags: [\n---\nbad');
    service.invalidate();
    const result = await service.read(item('a.md'));
    expect(result.related[0].status).toBe('available');
    expect(result.warnings.join(' ')).toContain('bad.md');
    expect(result.incomplete).toBe(true);
  });
});


describe('strict metadata edge cases', () => {
  it('rejects null properties without normalizing away authored malformed values', async () => {
    await writeFile(item('a.md'), '---\ntags: null\nannotation: null\n---\nbody');
    await expect(service.read(item('a.md'))).rejects.toThrow(/tags|description/i);
  });
  it('rejects invalid UTF-8 in metadata without changing the carrier', async () => {
    const bytes = Buffer.concat([Buffer.from('---\ncustom: '), Buffer.from([0xff]), Buffer.from('\n---\nbody')]);
    await writeFile(item('a.md'), bytes);
    await expect(service.saveProperties(item('a.md'), props, 'any')).rejects.toThrow(/UTF-8|encoding/i);
    expect(await readFile(item('a.md'))).toEqual(bytes);
  });
  it('does not replace read-only metadata and can still read healthy connections nearby', async () => {
    await writeFile(item('a.md'), 'A');
    await writeFile(item('b.jpg'), 'B');
    await service.addRelated(item('a.md'), item('b.jpg'));
    await chmod(item('a.md'), 0o444);
    const before = await readFile(item('a.md'));
    await expect(save(item('a.md'))).rejects.toThrow(/read.only|permission/i);
    expect(await readFile(item('a.md'))).toEqual(before);
    expect((await service.read(item('b.jpg'))).related[0].status).toBe('available');
  });
  it('preserves unknown opal fields and comments on surviving connections', async () => {
    await writeFile(item('a.md'), 'A');
    await writeFile(item('b.jpg'), 'B');
    await writeFile(item('c.jpg'), 'C');
    const first = await service.addRelated(item('a.md'), item('b.jpg'));
    let raw = await readFile(item('a.md'), 'utf8');
    raw = raw.replace('opal:', 'opal:\n  custom: preserved # keep me').replace('pathHint:', 'extra: retained # link comment\n      pathHint:');
    await writeFile(item('a.md'), raw);
    const connected = await service.addRelated(item('a.md'), item('c.jpg'));
    const second = connected.related.find((row) => row.edgeId !== first.related[0].edgeId);
    await service.removeRelated(item('a.md'), second.edgeId);
    const after = await readFile(item('a.md'), 'utf8');
    expect(after).toContain('custom: preserved # keep me');
    expect(after).toContain('extra: retained # link comment');
  });
});

it('preserves a comment-only frontmatter document when adding the first properties', async () => {
  await writeFile(item('a.md'), '---\n# existing comment\n---\nbody');
  await save(item('a.md'));
  const raw = await readFile(item('a.md'), 'utf8');
  expect(raw).toContain('# existing comment');
  expect(raw.endsWith('---\nbody')).toBe(true);
});

it('does not enumerate a removed root while rebuilding the catalog', async () => {
  await mkdir(item('detached'));
  await writeFile(item('detached/a.md'), '---\ntags: [\n---\ninvalid');
  await registry.add(item('detached'));
  const originalAssertAllowed = registry.assertAllowed.bind(registry);
  registry.assertAllowed = async (target) => {
    if (target === root) await registry.remove(root);
    return originalAssertAllowed(target);
  };
  const result = await service.read(item('detached'));
  // A rejected parent cannot authorize traversal into its children, even if
  // one descendant remains separately opened. Only a later scan may visit it.
  expect(result.warnings.some((warning) => warning.includes('detached/a.md'))).toBe(false);
});

it('connects to already identified large Markdown without rewriting that target', async () => {
  await writeFile(item('a.md'), 'A');
  await writeFile(item('large.md'), 'B');
  await save(item('large.md'));
  const original = Buffer.concat([await readFile(item('large.md')), Buffer.alloc(16 * 1024 * 1024, 65)]);
  await writeFile(item('large.md'), original);
  service.invalidate();
  const result = await service.addRelated(item('a.md'), item('large.md'));
  expect(result.related[0]).toMatchObject({ status: 'available', targetPath: item('large.md') });
  expect((await readFile(item('large.md'))).equals(original)).toBe(true);
});

it('resolves both directions for an explicitly opened root beneath a hidden ancestor', async () => {
  const project = item('.worktrees/project');
  await mkdir(project, { recursive: true });
  await registry.add(project);
  await writeFile(item('source.md'), 'source');
  const target = path.join(project, 'target.jpg');
  await writeFile(target, 'target');
  await save(target);
  // A copied identity in an ordinary hidden tree must remain excluded.
  await mkdir(item('.private'));
  await writeFile(item('.private/copy.jpg'), 'copy');
  await writeFile(item('.private/copy.jpg.opal.yaml'), await readFile(`${target}.opal.yaml`));
  service.invalidate();

  const source = await service.addRelated(item('source.md'), target);
  expect(source.related).toHaveLength(1);
  expect(source.related[0]).toMatchObject({ status: 'available', targetPath: target });
  const reverse = await service.read(target);
  expect(reverse.related).toHaveLength(1);
  expect(reverse.related[0]).toMatchObject({ status: 'available', direction: 'incoming', targetPath: item('source.md') });
});

it('detects duplicate identities inside an explicitly opened hidden descendant root', async () => {
  await writeFile(item('source.md'), 'source');
  await writeFile(item('target.md'), 'target');
  await service.addRelated(item('source.md'), item('target.md'));
  const project = item('.worktrees/project');
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, 'copy.md'), await readFile(item('target.md')));
  await registry.add(project);

  expect((await service.read(item('source.md'))).related[0].status).toBe('ambiguous');
  await expect(service.addRelated(item('source.md'), path.join(project, 'copy.md'))).rejects.toThrow(/ambiguous/i);
});

describe('activity hooks', () => {
  function recorder() {
    return { noteOrganized: vi.fn(async () => undefined), noteMoved: vi.fn(async () => undefined), noteRemoved: vi.fn(async () => undefined) };
  }
  it('records organized only after successful property saves and connection changes', async () => {
    const activity = recorder();
    service = new MetadataService({ registry, activity });
    await writeFile(item('a.md'), '# a'); await writeFile(item('b.md'), '# b');
    await expect(service.saveProperties(item('a.md'), props, 'stale')).rejects.toThrow();
    expect(activity.noteOrganized).not.toHaveBeenCalled();
    await save(item('a.md'));
    expect(activity.noteOrganized).toHaveBeenCalledWith(item('a.md'));
    const linked = await service.addRelated(item('a.md'), item('b.md'));
    expect(activity.noteOrganized).toHaveBeenLastCalledWith(item('a.md'));
    expect(activity.noteOrganized).toHaveBeenCalledTimes(2);
    // Re-adding an existing connection is a no-op and records nothing.
    await service.addRelated(item('b.md'), item('a.md'));
    expect(activity.noteOrganized).toHaveBeenCalledTimes(2);
    await service.removeRelated(item('b.md'), linked.related[0].edgeId);
    expect(activity.noteOrganized).toHaveBeenLastCalledWith(item('b.md'));
    expect(activity.noteOrganized).toHaveBeenCalledTimes(3);
  });
});
