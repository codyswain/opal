import { describe, expect, it } from 'vitest';
import {
  backupName,
  isNewer,
  parseBackupName,
  parseLatest,
  parseSkipped,
  parseSource,
  parseSources,
  pickUpdate,
  rollBackTarget,
} from '@/main/updates/updateModel';

const HOME = '/Users/someone';
const SHA = 'ab'.repeat(32);
const latest = (fields: Record<string, unknown> = {}) => ({
  version: 1,
  commit: 'abc1234',
  builtAt: '2026-01-05T07:40:00Z',
  file: 'Opal-abc1234.zip',
  sha256: SHA,
  notes: 'One line on what changed',
  ...fields,
});

describe('update sources', () => {
  it('takes absolute folders, ~ folders and https addresses', () => {
    expect(parseSource('/srv/opal-updates', HOME)).toEqual({ kind: 'folder', path: '/srv/opal-updates' });
    expect(parseSource('~/opal-updates/', HOME)).toEqual({ kind: 'folder', path: `${HOME}/opal-updates` });
    expect(parseSource('https://host.example/opal-updates/', HOME)).toEqual({ kind: 'https', url: 'https://host.example/opal-updates' });
  });

  it('refuses plain http, other schemes, relative paths and addresses with credentials or queries', () => {
    for (const entry of [
      'http://host.example/opal-updates',
      'HTTP://host.example/opal-updates',
      'ftp://host.example/opal-updates',
      'file:///srv/opal-updates',
      'opal-updates',
      './opal-updates',
      '~someone/opal-updates',
      'https://user:secret@host.example/opal-updates',
      'https://host.example/opal-updates?token=1',
      '',
      42,
      null,
    ]) {
      expect(parseSource(entry, HOME)).toBeNull();
    }
  });

  it('reads updates.json, keeping only the valid entries, and treats anything unreadable as no sources', () => {
    const text = JSON.stringify({ version: 1, sources: ['/srv/a', 'http://host.example/b', 'https://host.example/c'] });
    expect(parseSources(text, HOME)).toEqual([
      { kind: 'folder', path: '/srv/a' },
      { kind: 'https', url: 'https://host.example/c' },
    ]);
    expect(parseSources(null, HOME)).toEqual([]);
    expect(parseSources('{not json', HOME)).toEqual([]);
    expect(parseSources(JSON.stringify({ version: 2, sources: ['/srv/a'] }), HOME)).toEqual([]);
    expect(parseSources(JSON.stringify({ version: 1, sources: '/srv/a' }), HOME)).toEqual([]);
  });
});

describe('latest.json', () => {
  it('accepts a complete record and keeps the notes to one line', () => {
    expect(parseLatest(latest({ notes: 'Two\nlines  here', sha256: SHA.toUpperCase() }))).toEqual({
      commit: 'abc1234', builtAt: '2026-01-05T07:40:00Z', file: 'Opal-abc1234.zip', sha256: SHA, notes: 'Two lines here',
    });
    expect(parseLatest(latest({ notes: undefined }))?.notes).toBe('');
  });

  it('refuses a missing or malformed field, and a file outside the source', () => {
    for (const fields of [
      { version: 2 },
      { commit: 'not-a-commit' },
      { builtAt: 'yesterday' },
      { builtAt: '2026-01-05 07:40:00' },
      { file: '../Opal.zip' },
      { file: 'nested/Opal.zip' },
      { file: 'Opal.tar.gz' },
      { sha256: 'abc' },
      { notes: 7 },
    ]) {
      expect(parseLatest(latest(fields))).toBeNull();
    }
    expect(parseLatest(null)).toBeNull();
  });
});

describe('which build is ready', () => {
  const current = { commit: 'aaa1111', builtAt: '2026-01-05T07:40:00Z' };

  it('is ready when the commit differs and the build is later', () => {
    expect(isNewer({ commit: 'bbb2222', builtAt: '2026-01-05T08:00:00Z' }, current)).toBe(true);
    expect(isNewer({ commit: 'aaa1111', builtAt: '2026-01-05T08:00:00Z' }, current)).toBe(false);
    expect(isNewer({ commit: 'bbb2222', builtAt: '2026-01-05T07:40:00Z' }, current)).toBe(false);
    expect(isNewer({ commit: 'bbb2222', builtAt: '2026-01-04T08:00:00Z' }, current)).toBe(false);
    expect(isNewer({ commit: 'bbb2222', builtAt: '2026-01-05T08:00:00Z' }, null)).toBe(false);
  });

  it('picks the latest build across sources, the earlier source on a tie', () => {
    const offer = (source: string, commit: string, builtAt: string) => ({ source, build: parseLatest(latest({ commit, builtAt })) as NonNullable<ReturnType<typeof parseLatest>> });
    const found = [
      offer('a', 'bbb2222', '2026-01-05T08:00:00Z'),
      offer('b', 'ccc3333', '2026-01-06T08:00:00Z'),
      offer('c', 'ddd4444', '2026-01-06T08:00:00Z'),
      offer('d', 'aaa1111', '2026-01-07T08:00:00Z'),
      offer('e', 'eee5555', '2026-01-01T08:00:00Z'),
    ];
    expect(pickUpdate(found, current)?.source).toBe('b');
    expect(pickUpdate(found.slice(3), current)).toBeNull();
    expect(pickUpdate([], current)).toBeNull();
  });
});

describe('kept copies', () => {
  it('names a copy by its build time and commit, and reads the name back', () => {
    const build = { commit: 'abc1234', builtAt: '2026-01-05T07:40:00Z' };
    expect(backupName(build)).toBe('Opal-update-20260105T074000Z-abc1234.app');
    expect(parseBackupName(backupName(build))).toEqual(build);
    for (const name of ['Opal.app', 'Opal-backup-2026-01-01.app', 'Opal-update-20260105T074000Z-abc1234.app.zip', 'Opal-update-latest.app']) {
      expect(parseBackupName(name)).toBeNull();
    }
  });

  it('rolls back to the newest copy older than the running build, ignoring other names', () => {
    const current = { commit: 'ccc3333', builtAt: '2026-01-07T00:00:00Z' };
    const names = [
      'Opal-update-20260105T000000Z-aaa1111.app',
      'Opal-update-20260106T000000Z-bbb2222.app',
      'Opal-update-20260108T000000Z-ddd4444.app',
      'Opal-update-20260109T000000Z-ccc3333.app',
      'Opal before the big change.app',
    ];
    expect(rollBackTarget(names, current)).toBe('Opal-update-20260106T000000Z-bbb2222.app');
    expect(rollBackTarget(names.slice(2), current)).toBeNull();
    expect(rollBackTarget(names, null)).toBeNull();
  });

  it('remembers only a well-formed rolled-back commit', () => {
    expect(parseSkipped(JSON.stringify({ rolledBackFrom: 'abc1234' }))).toBe('abc1234');
    expect(parseSkipped(JSON.stringify({ rolledBackFrom: '../x' }))).toBeNull();
    expect(parseSkipped('nope')).toBeNull();
    expect(parseSkipped(null)).toBeNull();
  });
});
