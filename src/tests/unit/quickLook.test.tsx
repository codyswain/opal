import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { QuickLook } from '@/renderer/features/disk-explorer/components/QuickLook';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import { installMetadataApi } from '@/tests/helpers/metadataApi';

const PHOTO = entry({ path: '/V/a.jpg', name: 'a.jpg', kind: 'image', size: 2048 });

beforeEach(() => {
  installDiskApi();
  installMetadataApi();
  useDiskStore.setState({
    focusedPath: null,
    selectedPath: null,
    quickPreviewPath: null,
    isQuickLookOpen: false,
    sort: { field: 'name', direction: 'asc' },
  });
});

describe('QuickLook', () => {
  it('renders nothing while closed', () => {
    render(<QuickLook entry={PHOTO} />);
    expect(screen.queryByTestId('quick-look')).not.toBeInTheDocument();
  });

  it('renders the preview when opened', () => {
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={PHOTO} />);

    expect(screen.getByTestId('quick-look')).toBeInTheDocument();
    expect(screen.getByAltText('a.jpg')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={PHOTO} />);

    await user.keyboard('{Escape}');
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
  });

  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={PHOTO} />);

    await user.click(screen.getByTestId('quick-look-backdrop'));
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
  });

  it('closes via the close button', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={PHOTO} />);

    await user.click(screen.getByTestId('quick-look-close'));
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
  });

  it('stays closed when there is no selection', () => {
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={null} />);
    expect(screen.queryByTestId('quick-look')).not.toBeInTheDocument();
  });

  it('is labelled as a dialog for assistive tech', () => {
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={PHOTO} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(dialog).toHaveAttribute('aria-label', 'a.jpg');
  });

  it('keeps Quick Look open when Escape closes the nested related chooser', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={PHOTO} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByLabelText('Tags');
    await user.click(screen.getByRole('button', { name: 'Add related item' }));
    expect(await screen.findByRole('dialog', { name: 'Add related item' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Add related item' })).not.toBeInTheDocument();
    expect(useDiskStore.getState().isQuickLookOpen).toBe(true);
  });
});

describe('quick look store actions', () => {
  it('toggles', () => {
    useDiskStore.getState().toggleQuickLook();
    expect(useDiskStore.getState().isQuickLookOpen).toBe(true);
    useDiskStore.getState().toggleQuickLook();
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
  });

  it('closes when the selection is cleared', () => {
    useDiskStore.setState({ isQuickLookOpen: true });
    useDiskStore.getState().select(null);
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
  });
});
