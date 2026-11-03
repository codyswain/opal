import { describe, it, expect } from 'vitest';
import { classifyFile } from '@/common/fileKind';

describe('classifyFile', () => {
  it('classifies common image extensions', () => {
    expect(classifyFile('IMG_2041.jpg')).toBe('image');
    expect(classifyFile('photo.JPEG')).toBe('image');
    expect(classifyFile('icon.png')).toBe('image');
    expect(classifyFile('animation.gif')).toBe('image');
    expect(classifyFile('shot.webp')).toBe('image');
    expect(classifyFile('raw.heic')).toBe('image');
    expect(classifyFile('vector.svg')).toBe('image');
  });

  it('classifies markdown separately from other text', () => {
    expect(classifyFile('note.md')).toBe('markdown');
    expect(classifyFile('README.markdown')).toBe('markdown');
    expect(classifyFile('data.txt')).toBe('text');
    expect(classifyFile('config.json')).toBe('text');
  });

  it('classifies video, audio, and pdf', () => {
    expect(classifyFile('clip.mp4')).toBe('video');
    expect(classifyFile('movie.mov')).toBe('video');
    expect(classifyFile('song.mp3')).toBe('audio');
    expect(classifyFile('voice.m4a')).toBe('audio');
    expect(classifyFile('paper.pdf')).toBe('pdf');
  });

  it('falls back to other for unknown and extensionless names', () => {
    expect(classifyFile('archive.zip')).toBe('other');
    expect(classifyFile('Makefile')).toBe('other');
    expect(classifyFile('binary')).toBe('other');
  });

  it('is case-insensitive and handles multi-dot names', () => {
    expect(classifyFile('IMG.JPG')).toBe('image');
    expect(classifyFile('archive.tar.gz')).toBe('other');
    expect(classifyFile('my.notes.md')).toBe('markdown');
  });

  it('treats a dotfile name as extensionless, not as an extension', () => {
    expect(classifyFile('.gitignore')).toBe('other');
    expect(classifyFile('.env')).toBe('other');
  });

  it('never returns directory', () => {
    expect(classifyFile('some-folder')).not.toBe('directory');
  });
});
