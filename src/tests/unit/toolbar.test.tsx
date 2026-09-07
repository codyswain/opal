import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { Toolbar } from '@/renderer/features/disk-explorer/components/Toolbar';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { useViewDraftsStore } from '@/renderer/features/disk-explorer/store/viewDraftsStore';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({
    sort: { field: 'name', direction: 'asc' },
    filter: '',
    pendingAction: null,
  });
});

describe('Toolbar sorting', () => {
  it('changes the sort field', async () => {
    const user = userEvent.setup();
    render(<Toolbar dirPath="/V" />);

    await user.click(screen.getByTestId('sort-menu'));
    await user.click(await screen.findByTestId('sort-size'));
    expect(useDiskStore.getState().sort).toEqual({
      field: 'size',
      direction: 'asc',
    });
    expect(screen.getByTestId('sort-menu')).toHaveTextContent('Size');
  });

  it('flips direction when the active field is chosen again', async () => {
    const user = userEvent.setup();
    render(<Toolbar dirPath="/V" />);

    await user.click(screen.getByTestId('sort-menu'));
    await user.click(await screen.findByTestId('sort-name'));
    expect(useDiskStore.getState().sort.direction).toBe('desc');

    // The arrow beside the menu flips without opening it.
    await user.click(screen.getByTestId('sort-direction'));
    expect(useDiskStore.getState().sort.direction).toBe('asc');
  });

  it('marks the active sort field', async () => {
    const user = userEvent.setup();
    render(<Toolbar dirPath="/V" />);
    expect(screen.getByTestId('sort-menu')).toHaveTextContent('Name');
    await user.click(screen.getByTestId('sort-menu'));
    expect(await screen.findByTestId('sort-name')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('sort-size')).toHaveAttribute('aria-checked', 'false');
  });

  it('starts a new-folder action for the current directory', async () => {
    const user = userEvent.setup();
    render(<Toolbar dirPath="/V" />);

    await user.click(screen.getByTestId('toolbar-new-folder'));
    expect(useDiskStore.getState().pendingAction).toEqual({
      kind: 'new-folder',
      target: '/V',
    });
  });
});

describe('Toolbar filtering', () => {
  it('updates the filter as the user types', async () => {
    const user = userEvent.setup();
    render(<Toolbar dirPath="/V" />);

    await user.type(screen.getByTestId('filter-input'), 'img');
    expect(useDiskStore.getState().filter).toBe('img');
  });

  it('clears the filter with the clear button', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ filter: 'img' });
    render(<Toolbar dirPath="/V" />);

    await user.click(screen.getByTestId('filter-clear'));
    expect(useDiskStore.getState().filter).toBe('');
  });

  it('clears the filter on Escape', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ filter: 'img' });
    render(<Toolbar dirPath="/V" />);

    await user.type(screen.getByTestId('filter-input'), '{Escape}');
    expect(useDiskStore.getState().filter).toBe('');
  });

  it('hides the clear button when the filter is empty', () => {
    render(<Toolbar dirPath="/V" />);
    expect(screen.queryByTestId('filter-clear')).not.toBeInTheDocument();
  });

  it('focuses and selects the filter input on Cmd+F', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ filter: 'img' });
    render(<Toolbar dirPath="/V" />);

    const input = screen.getByTestId('filter-input') as HTMLInputElement;
    await user.click(screen.getByTestId('sort-direction'));
    expect(input).not.toHaveFocus();

    await user.keyboard('{Meta>}f{/Meta}');
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});

describe('Toolbar views', () => {
  it('starts a view scoped to this folder and its subfolders', async () => {
    useViewDraftsStore.getState().clearAll();
    const user = userEvent.setup();
    render(<Toolbar dirPath="/V/Papers" />);

    await user.click(screen.getByTestId('toolbar-filter-folder'));

    const id = useViewDraftsStore.getState().order[0];
    expect(useViewDraftsStore.getState().get(id)).toMatchObject({
      origin: '/V/Papers',
      query: { scope: { kind: 'folders', folders: ['/V/Papers'], includeDescendants: true }, filters: [] },
    });
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'query', id });
    expect(useDiskStore.getState().currentDirectory).toBeNull();
  });
});
