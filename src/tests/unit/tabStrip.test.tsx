import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { TabStrip } from '@/renderer/features/disk-explorer/components/TabStrip';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { installDiskApi } from '@/tests/helpers/diskApi';

const A = '/V/alpha.md';
const B = '/V/beta.png';

beforeEach(() => {
  window.localStorage.clear();
  installDiskApi();
  useTabsStore.setState({
    openPaths: [],
    openedPath: null,
    activePath: null,
    previewPath: null,
  });
});

describe('TabStrip', () => {
  it('renders nothing when no tabs are open', () => {
    render(<TabStrip />);
    expect(screen.queryByTestId('tab-strip')).not.toBeInTheDocument();
  });

  it('renders one tab per open path, labelled by basename', () => {
    useTabsStore.setState({ openPaths: [A, B], activePath: A, previewPath: null });
    render(<TabStrip />);

    expect(screen.getByTestId('tab-strip')).toBeInTheDocument();
    expect(screen.getByText('alpha.md')).toBeInTheDocument();
    expect(screen.getByText('beta.png')).toBeInTheDocument();
  });

  it('marks the active tab for assistive tech', () => {
    useTabsStore.setState({ openPaths: [A, B], activePath: B, previewPath: null });
    render(<TabStrip />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('activates a tab when clicked', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({ openPaths: [A, B], activePath: A, previewPath: null });
    render(<TabStrip />);

    await user.click(screen.getByText('beta.png'));
    expect(useTabsStore.getState().activePath).toBe(B);
  });

  it('pins a preview tab on double click', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({ openPaths: [A], activePath: A, previewPath: A });
    render(<TabStrip />);

    await user.dblClick(screen.getByText('alpha.md'));
    expect(useTabsStore.getState().previewPath).toBeNull();
  });

  it('closes a tab from its close button without activating it', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({ openPaths: [A, B], activePath: A, previewPath: null });
    render(<TabStrip />);

    await user.click(screen.getByTestId(`tab-close-${B}`));
    expect(useTabsStore.getState().openPaths).toEqual([A]);
    expect(useTabsStore.getState().activePath).toBe(A);
  });

  it('gives each tab a title attribute carrying the full path', () => {
    // Basenames collide constantly; the tooltip is how you tell them apart.
    useTabsStore.setState({ openPaths: [A], activePath: A, previewPath: null });
    render(<TabStrip />);
    expect(screen.getByRole('tab')).toHaveAttribute('title', A);
  });

  it('renders the preview tab in italics', () => {
    useTabsStore.setState({ openPaths: [A], activePath: A, previewPath: A });
    render(<TabStrip />);
    expect(screen.getByTestId(`tab-label-${A}`).className).toMatch(/italic/);
  });
});
