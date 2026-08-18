import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useGridNavigation } from '@/renderer/features/disk-explorer/hooks/useGridNavigation';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import type { DiskEntry } from '@/types/disk';

const ENTRIES: DiskEntry[] = ['a', 'b', 'c', 'd', 'e'].map((n) =>
  entry({ path: `/V/${n}`, name: n })
);

/** Minimal host so the hook can be driven through real key events. */
const Harness: React.FC<{ columns: number }> = ({ columns }) => {
  const { onKeyDown } = useGridNavigation({ entries: ENTRIES, columns });
  return <div tabIndex={0} data-testid="grid" onKeyDown={onKeyDown} />;
};

async function press(key: string) {
  const user = userEvent.setup();
  screen.getByTestId('grid').focus();
  await user.keyboard(key);
}

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({ selectedPath: null, filter: '' });
});

describe('useGridNavigation', () => {
  it('selects the first entry when nothing is selected', async () => {
    render(<Harness columns={3} />);
    await press('{ArrowDown}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/a');
  });

  it('moves right and left by one', async () => {
    useDiskStore.setState({ selectedPath: '/V/b' });
    render(<Harness columns={3} />);

    await press('{ArrowRight}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/c');

    await press('{ArrowLeft}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/b');
  });

  it('moves down and up by one row', async () => {
    useDiskStore.setState({ selectedPath: '/V/a' });
    render(<Harness columns={3} />);

    await press('{ArrowDown}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/d');

    await press('{ArrowUp}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/a');
  });

  it('clamps at the edges instead of wrapping', async () => {
    useDiskStore.setState({ selectedPath: '/V/a' });
    render(<Harness columns={3} />);

    await press('{ArrowLeft}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/a');

    await press('{ArrowUp}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/a');
  });

  it('clamps a downward move that would overshoot the last row', async () => {
    useDiskStore.setState({ selectedPath: '/V/c' });
    render(<Harness columns={3} />);

    // c is index 2; +3 would be index 5, which does not exist. Land on the last.
    await press('{ArrowDown}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/e');
  });

  it('Home and End jump to the ends', async () => {
    useDiskStore.setState({ selectedPath: '/V/c' });
    render(<Harness columns={3} />);

    await press('{End}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/e');

    await press('{Home}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/a');
  });

  it('leaves Enter alone, so the app can bind it to rename', async () => {
    useDiskStore.setState({ selectedPath: '/V/b' });
    render(<Harness columns={3} />);

    await press('{Enter}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/b');
  });

  it('type-to-select jumps to the first entry starting with the typed letter', async () => {
    useDiskStore.setState({ selectedPath: '/V/a' });
    render(<Harness columns={3} />);

    await press('d');
    expect(useDiskStore.getState().selectedPath).toBe('/V/d');
  });

  it('ignores modified keys so app shortcuts still work', async () => {
    useDiskStore.setState({ selectedPath: '/V/a' });
    render(<Harness columns={3} />);

    await press('{Meta>}d{/Meta}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/a');
  });

  it('does nothing on an empty list', async () => {
    const Empty: React.FC = () => {
      const { onKeyDown } = useGridNavigation({ entries: [], columns: 3 });
      return <div tabIndex={0} data-testid="grid" onKeyDown={onKeyDown} />;
    };
    render(<Empty />);

    await press('{ArrowDown}');
    expect(useDiskStore.getState().selectedPath).toBeNull();
  });
});
