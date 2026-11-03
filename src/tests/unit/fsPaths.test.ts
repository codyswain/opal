import { describe, expect, it } from 'vitest';
import {
  basenameFsPath,
  isAbsoluteFsPath,
  isFsPathAtOrBelow,
  normalizeFsPath,
  parentFsPath,
  remapFsPath,
} from '@/common/fsPaths';

describe('renderer-safe filesystem paths', () => {
  it.each([
    ['/Vault//Notes/./today.md', '/Vault/Notes/today.md'],
    ['/Vault/Notes/../Photos/', '/Vault/Photos'],
    ['C:\\Users\\Cody\\..\\Notes\\', 'C:/Users/Notes'],
    ['/', '/'],
    ['C:\\', 'C:/'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeFsPath(input)).toBe(expected);
  });

  it('recognizes POSIX and drive-letter absolute paths', () => {
    expect(isAbsoluteFsPath('/Vault/note.md')).toBe(true);
    expect(isAbsoluteFsPath('C:\\Vault\\note.md')).toBe(true);
    expect(isAbsoluteFsPath('Vault/note.md')).toBe(false);
  });

  it('compares complete path segments rather than string prefixes', () => {
    expect(isFsPathAtOrBelow('/Vault/Photos', '/Vault/Photos/raw/a.jpg')).toBe(
      true
    );
    expect(
      isFsPathAtOrBelow('/Vault/Photos', '/Vault/Photos-backup/a.jpg')
    ).toBe(false);
  });

  it('finds parents and basenames without Node path APIs', () => {
    expect(parentFsPath('/Vault/Notes/today.md')).toBe('/Vault/Notes');
    expect(parentFsPath('/Vault')).toBe('/');
    expect(parentFsPath('/')).toBeNull();
    expect(parentFsPath('C:/Vault')).toBe('C:/');
    expect(basenameFsPath('/Vault/Notes/today.md')).toBe('today.md');
  });

  it('remaps an exact path and every child without touching siblings', () => {
    expect(remapFsPath('/Vault/Photos', '/Vault/Photos', '/Archive/Images')).toBe(
      '/Archive/Images'
    );
    expect(
      remapFsPath(
        '/Vault/Photos/raw/a.jpg',
        '/Vault/Photos',
        '/Archive/Images'
      )
    ).toBe('/Archive/Images/raw/a.jpg');
    expect(
      remapFsPath(
        '/Vault/Photos-backup/a.jpg',
        '/Vault/Photos',
        '/Archive/Images'
      )
    ).toBe('/Vault/Photos-backup/a.jpg');
  });
});
