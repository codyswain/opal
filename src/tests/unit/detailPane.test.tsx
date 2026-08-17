import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { DetailPane } from '@/renderer/features/disk-explorer/components/detail/DetailPane';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

beforeEach(() => {
  installDiskApi();
});

describe('DetailPane', () => {
  it('prompts when nothing is selected', () => {
    render(<DetailPane entry={null} />);
    expect(screen.getByTestId('detail-empty')).toBeInTheDocument();
  });

  it('renders an image through the opal-file protocol', () => {
    render(<DetailPane entry={entry({ path: '/V/a.jpg', name: 'a.jpg', kind: 'image', size: 2048 })} />);

    const image = screen.getByAltText('a.jpg');
    expect(image.getAttribute('src')).toMatch(/^opal-file:\/\//);
    expect(image.getAttribute('src')).not.toMatch(/^data:/);
  });

  it('shows name and size in the header', () => {
    render(<DetailPane entry={entry({ path: '/V/a.jpg', name: 'a.jpg', kind: 'image', size: 2048 })} />);
    expect(screen.getByTestId('detail-title')).toHaveTextContent('a.jpg');
    expect(screen.getByTestId('detail-subtitle')).toHaveTextContent('2 KB');
  });

  it('zooms in and out, and resets to fit', async () => {
    const user = userEvent.setup();
    render(<DetailPane entry={entry({ path: '/V/a.jpg', name: 'a.jpg', kind: 'image' })} />);

    expect(screen.getByTestId('image-zoom-level')).toHaveTextContent('Fit');

    await user.click(screen.getByTestId('image-zoom-in'));
    expect(screen.getByTestId('image-zoom-level')).toHaveTextContent('120%');

    await user.click(screen.getByTestId('image-zoom-out'));
    expect(screen.getByTestId('image-zoom-level')).toHaveTextContent('100%');

    await user.click(screen.getByTestId('image-zoom-fit'));
    expect(screen.getByTestId('image-zoom-level')).toHaveTextContent('Fit');
  });

  it('clamps zoom at the bounds', async () => {
    const user = userEvent.setup();
    render(<DetailPane entry={entry({ path: '/V/a.jpg', name: 'a.jpg', kind: 'image' })} />);

    for (let i = 0; i < 40; i += 1) {
      await user.click(screen.getByTestId('image-zoom-in'));
    }
    expect(screen.getByTestId('image-zoom-level')).toHaveTextContent('800%');

    for (let i = 0; i < 80; i += 1) {
      await user.click(screen.getByTestId('image-zoom-out'));
    }
    expect(screen.getByTestId('image-zoom-level')).toHaveTextContent('10%');
  });

  it('falls back gracefully for an unsupported kind', () => {
    render(<DetailPane entry={entry({ path: '/V/a.zip', name: 'a.zip', kind: 'other', size: 100 })} />);
    expect(screen.getByTestId('detail-unsupported')).toBeInTheDocument();
    expect(screen.getByTestId('detail-title')).toHaveTextContent('a.zip');
  });

  it('shows a directory summary rather than a viewer', () => {
    render(<DetailPane entry={entry({ path: '/V/Photos', name: 'Photos', kind: 'directory', isDirectory: true })} />);
    expect(screen.getByTestId('detail-directory')).toBeInTheDocument();
  });
});
