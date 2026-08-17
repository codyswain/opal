import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { Toolbar } from '@/renderer/features/disk-explorer/components/Toolbar';
import { installDiskApi } from '@/tests/helpers/diskApi';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({
    sort: { field: 'name', direction: 'asc' },
    filter: '',
    viewMode: null,
  });
});

describe('Toolbar sorting', () => {
  it('changes the sort field', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.click(screen.getByTestId('sort-size'));
    expect(useDiskStore.getState().sort).toEqual({
      field: 'size',
      direction: 'asc',
    });
  });

  it('flips direction when the active field is chosen again', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.click(screen.getByTestId('sort-name'));
    expect(useDiskStore.getState().sort.direction).toBe('desc');

    await user.click(screen.getByTestId('sort-name'));
    expect(useDiskStore.getState().sort.direction).toBe('asc');
  });

  it('marks the active sort field', () => {
    render(<Toolbar />);
    expect(screen.getByTestId('sort-name')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sort-size')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Toolbar filtering', () => {
  it('updates the filter as the user types', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.type(screen.getByTestId('filter-input'), 'img');
    expect(useDiskStore.getState().filter).toBe('img');
  });

  it('clears the filter with the clear button', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ filter: 'img' });
    render(<Toolbar />);

    await user.click(screen.getByTestId('filter-clear'));
    expect(useDiskStore.getState().filter).toBe('');
  });

  it('clears the filter on Escape', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ filter: 'img' });
    render(<Toolbar />);

    await user.type(screen.getByTestId('filter-input'), '{Escape}');
    expect(useDiskStore.getState().filter).toBe('');
  });

  it('hides the clear button when the filter is empty', () => {
    render(<Toolbar />);
    expect(screen.queryByTestId('filter-clear')).not.toBeInTheDocument();
  });

  it('focuses and selects the filter input on Cmd+F', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ filter: 'img' });
    render(<Toolbar />);

    const input = screen.getByTestId('filter-input') as HTMLInputElement;
    await user.click(screen.getByTestId('sort-size'));
    expect(input).not.toHaveFocus();

    await user.keyboard('{Meta>}f{/Meta}');
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});
