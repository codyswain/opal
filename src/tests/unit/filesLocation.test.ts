import { describe, expect, it } from 'vitest';
import {
  RECENT_COLLECTION,
  browseRecent,
  fileLocation,
  filesLocationKey,
  focusFile,
  locationPath,
  parseFilesLocation,
  remapFilesLocation,
  serializeFilesLocation,
} from '@/renderer/features/disk-explorer/navigation/filesLocation';

const ROOT = '/Vault';
const FILE = '/Vault/Notes/Today #1%.md';
const RECENT = { mode: 'browse' as const, collection: RECENT_COLLECTION };

describe('files router locations', () => {
  it('round-trips Recent and files with reserved characters', () => {
    expect(serializeFilesLocation(RECENT)).toBe('?mode=browse&collection=recent');
    expect(parseFilesLocation(serializeFilesLocation(RECENT), [ROOT])).toEqual(RECENT);
    const focus = fileLocation(FILE);
    expect(parseFilesLocation(serializeFilesLocation(focus), [ROOT])).toEqual(focus);
    expect(serializeFilesLocation(fileLocation('/Vault/a.md'))).toBe('?mode=focus&file=%2FVault%2Fa.md');
  });

  it('normalizes Windows separators and equivalent location keys', () => {
    expect(parseFilesLocation('?mode=focus&file=C%3A%5CVault%5Ca.md', ['C:/Vault'])).toEqual(
      fileLocation('C:/Vault/a.md')
    );
    expect(filesLocationKey(fileLocation('C:\\Vault\\a.md'))).toBe(
      filesLocationKey(fileLocation('C:/Vault/a.md'))
    );
    expect(fileLocation('/Vault/Notes/../Notes/a.md')).toEqual({ mode: 'focus', file: '/Vault/Notes/a.md' });
  });

  it('still opens a file link written with its folder', () => {
    expect(parseFilesLocation('?mode=focus&dir=%2FVault&file=%2FVault%2Fa.md', [ROOT])).toEqual(
      fileLocation('/Vault/a.md')
    );
  });

  it.each([
    [''],
    ['?mode=browse'],
    ['?mode=unknown&file=%2FVault%2Fa.md'],
    ['?mode=focus'],
    ['?mode=focus&file=Vault%2Fa.md'],
    ['?mode=focus&file=%2FOtherRoot%2Fsecret.md'],
    // Folder pages, saved queries and views are gone.
    ['?mode=browse&dir=%2FVault%2FNotes'],
    ['?mode=browse&collection=query&id=q1'],
    ['?mode=browse&collection=view&id=v1'],
  ])('rejects malformed, retired or disallowed state: %s', (search) => {
    expect(parseFilesLocation(search, [ROOT])).toBeNull();
  });

  it('opens nothing until a folder is open', () => {
    expect(parseFilesLocation('?mode=browse&collection=recent', [])).toBeNull();
    expect(parseFilesLocation('?mode=focus&file=%2FVault%2Fa.md', [])).toBeNull();
  });

  it('builds intents and names the path a place shows', () => {
    expect(browseRecent()).toEqual({ location: RECENT, history: 'push' });
    expect(focusFile('/Vault/a.md', 'replace')).toEqual({ location: fileLocation('/Vault/a.md'), history: 'replace' });
    expect(locationPath(RECENT)).toBeNull();
    expect(locationPath(fileLocation(FILE))).toBe(FILE);
  });

  it('remaps a file with replace semantics and leaves Recent alone', () => {
    expect(remapFilesLocation(fileLocation(FILE), '/Vault/Notes', '/Vault/Writing')).toEqual({
      location: fileLocation('/Vault/Writing/Today #1%.md'),
      history: 'replace',
    });
    expect(remapFilesLocation(fileLocation(FILE), '/Vault/Other', '/Vault/Moved').history).toBe('none');
    expect(remapFilesLocation(RECENT, '/Vault/Notes', '/Vault/Writing')).toEqual({ location: RECENT, history: 'none' });
  });
});
