import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { Breadcrumb } from '@/renderer/features/disk-explorer/components/Breadcrumb';
import { installDiskApi } from '@/tests/helpers/diskApi';

const ROOT = '/V';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({
    roots: [ROOT],
    listings: {},
    expanded: {},
    selectedPath: null,
    sort: { field: 'name', direction: 'asc' },
    loading: { isLoading: false, error: null },
  });
});

describe('Breadcrumb', () => {
  it('renders one crumb per segment', () => {
    render(<Breadcrumb dirPath="/V/Photos/Rwanda" />);
    expect(screen.getByTestId('crumb-/V')).toHaveTextContent('V');
    expect(screen.getByTestId('crumb-/V/Photos')).toHaveTextContent('Photos');
    expect(screen.getByTestId('crumb-/V/Photos/Rwanda')).toHaveTextContent('Rwanda');
  });

  it('navigates to the folder when a crumb is clicked', async () => {
    const user = userEvent.setup();
    render(<Breadcrumb dirPath="/V/Photos/Rwanda" />);

    await user.click(screen.getByTestId('crumb-/V/Photos'));
    expect(useDiskStore.getState().currentDirectory).toBe('/V/Photos');
    expect(useDiskStore.getState().selectedPaths).toEqual([]);
  });

  it('marks the final crumb as current', () => {
    render(<Breadcrumb dirPath="/V/Photos" />);
    expect(screen.getByTestId('crumb-/V/Photos')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('crumb-/V')).not.toHaveAttribute('aria-current');
  });

  it('renders nothing when the path is outside every root', () => {
    render(<Breadcrumb dirPath="/somewhere/else" />);
    expect(screen.queryByTestId('breadcrumb')).not.toBeInTheDocument();
  });
});
