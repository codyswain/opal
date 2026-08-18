import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DetailPane } from '@/renderer/features/disk-explorer/components/detail/DetailPane';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

beforeEach(() => {
  installDiskApi();
});

describe('media previews', () => {
  it('renders a video element with controls', () => {
    render(<DetailPane entry={entry({ path: '/V/clip.mp4', name: 'clip.mp4', kind: 'video' })} />);

    const video = screen.getByTestId('video-preview');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('controls');
    expect(video.getAttribute('src')).toMatch(/^opal-file:\/\//);
  });

  it('renders an audio element with controls', () => {
    render(<DetailPane entry={entry({ path: '/V/song.mp3', name: 'song.mp3', kind: 'audio' })} />);

    const audio = screen.getByTestId('audio-preview');
    expect(audio.tagName).toBe('AUDIO');
    expect(audio).toHaveAttribute('controls');
    expect(audio.getAttribute('src')).toMatch(/^opal-file:\/\//);
  });

  it('renders a pdf in an embedded frame', () => {
    render(<DetailPane entry={entry({ path: '/V/paper.pdf', name: 'paper.pdf', kind: 'pdf' })} />);

    const frame = screen.getByTestId('pdf-preview');
    expect(frame.getAttribute('src')).toMatch(/^opal-file:\/\//);
  });

  it('does not autoplay media', () => {
    render(<DetailPane entry={entry({ path: '/V/clip.mp4', name: 'clip.mp4', kind: 'video' })} />);
    expect(screen.getByTestId('video-preview')).not.toHaveAttribute('autoplay');
  });
});
