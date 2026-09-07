import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { DetailPane } from '@/renderer/features/disk-explorer/components/detail/DetailPane';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import { installMetadataApi, metadata } from '@/tests/helpers/metadataApi';
import { FilesNavigationContext } from '@/renderer/features/disk-explorer/navigation/FilesNavigationContext';
import type { ItemMetadata } from '@/types/metadata';

beforeEach(() => {
  installDiskApi();
  installMetadataApi();
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

  it('loads metadata only after Details is explicitly selected', async () => {
    const user = userEvent.setup();
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);

    expect(window.metadataAPI.read).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: 'Details' }));

    await waitFor(() => expect(window.metadataAPI.read).toHaveBeenCalledWith('/V/note.md'));
    expect(screen.getByLabelText('Tags')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });

  it('keeps the explicit Details request live during StrictMode effect replay', async () => {
    const user = userEvent.setup();
    render(
      <React.StrictMode>
        <DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />
      </React.StrictMode>
    );

    await user.click(screen.getByRole('tab', { name: 'Details' }));

    expect(await screen.findByLabelText('Tags')).toBeInTheDocument();
  });

  it('saves tags and description together and shows saved status', async () => {
    const user = userEvent.setup();
    const api = installMetadataApi({
      read: vi.fn(async () => ({
        success: true as const,
        data: metadata({ properties: { tags: ['work'], description: 'Initial' } }),
      })),
    });
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByDisplayValue('work');

    await user.clear(screen.getByLabelText('Tags'));
    await user.type(screen.getByLabelText('Tags'), 'work, urgent');
    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'Updated');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveProperties).toHaveBeenCalledWith(
      '/V/note.md',
      { tags: ['work', 'urgent'], description: 'Updated' },
      'rev-1'
    ));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('shows a conflict and lets the user deliberately reload Details', async () => {
    const user = userEvent.setup();
    const api = installMetadataApi({
      read: vi.fn()
        .mockResolvedValueOnce({ success: true, data: metadata({ properties: { tags: ['old'], description: '' } }) })
        .mockResolvedValueOnce({ success: true, data: metadata({ revision: 'rev-new', properties: { tags: ['disk'], description: 'Changed elsewhere' } }) }),
      saveProperties: vi.fn(async () => ({ success: false as const, error: 'Metadata changed on disk. Reload Details.' })),
    });
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByDisplayValue('old');
    await user.type(screen.getByLabelText('Description'), 'mine');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Metadata changed on disk. Reload Details.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload Details' }));

    expect(await screen.findByDisplayValue('Changed elsewhere')).toBeInTheDocument();
    expect(api.read).toHaveBeenCalledTimes(2);
  });

  it('leaves loading and offers reload when the Details IPC request rejects', async () => {
    const user = userEvent.setup();
    installMetadataApi({ read: vi.fn(async () => { throw new Error('bridge unavailable'); }) });
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);

    await user.click(screen.getByRole('tab', { name: 'Details' }));

    expect(await screen.findByText('Could not load Details.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload Details' })).toBeEnabled();
    expect(screen.queryByText('Loading Details…')).not.toBeInTheDocument();
  });

  it('clears saving and shows a legible error when save IPC rejects', async () => {
    const user = userEvent.setup();
    installMetadataApi({ saveProperties: vi.fn(async () => { throw new Error('bridge unavailable'); }) });
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByLabelText('Tags');
    await user.type(screen.getByLabelText('Description'), 'draft');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Could not save Details.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('never applies a stale Details response after the selected item changes', async () => {
    const user = userEvent.setup();
    let resolveA!: (value: { success: true; data: ItemMetadata }) => void;
    const a = new Promise<{ success: true; data: ItemMetadata }>((resolve) => { resolveA = resolve; });
    installMetadataApi({
      read: vi.fn((target: string) => target.endsWith('a.md')
        ? a
        : Promise.resolve({ success: true as const, data: metadata({ path: target, properties: { tags: ['beta'], description: 'B' } }) })),
    });
    const view = render(<DetailPane entry={entry({ path: '/V/a.md', name: 'a.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    view.rerender(<DetailPane entry={entry({ path: '/V/b.md', name: 'b.md', kind: 'markdown' })} />);

    expect(await screen.findByDisplayValue('beta')).toBeInTheDocument();
    resolveA({ success: true, data: metadata({ path: '/V/a.md', properties: { tags: ['alpha'], description: 'A' } }) });
    await Promise.resolve();

    expect(screen.getByDisplayValue('beta')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('alpha')).not.toBeInTheDocument();
  });

  it('never applies a stale save response after the selected item changes', async () => {
    const user = userEvent.setup();
    let resolveSave!: (value: { success: true; data: ItemMetadata }) => void;
    const pendingSave = new Promise<{ success: true; data: ItemMetadata }>((resolve) => { resolveSave = resolve; });
    installMetadataApi({
      read: vi.fn(async (target: string) => ({
        success: true as const,
        data: metadata({ path: target, properties: target.endsWith('a.md')
          ? { tags: ['alpha'], description: '' }
          : { tags: ['beta'], description: 'B' } }),
      })),
      saveProperties: vi.fn(() => pendingSave),
    });
    const view = render(<DetailPane entry={entry({ path: '/V/a.md', name: 'a.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByDisplayValue('alpha');
    await user.type(screen.getByLabelText('Description'), 'A draft');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    view.rerender(<DetailPane entry={entry({ path: '/V/b.md', name: 'b.md', kind: 'markdown' })} />);
    expect(await screen.findByDisplayValue('beta')).toBeInTheDocument();

    resolveSave({ success: true, data: metadata({ path: '/V/a.md', properties: { tags: ['saved-a'], description: 'A draft' } }) });
    await Promise.resolve();

    expect(screen.getByDisplayValue('beta')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('saved-a')).not.toBeInTheDocument();
  });

  it('labels unresolved connections and opens available files and folders', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const navigateDirectory = vi.fn();
    installMetadataApi({
      read: vi.fn(async () => ({ success: true as const, data: metadata({ related: [
        { edgeId: 'file-edge', ownerId: 'owner', ownerPath: '/V/note.md', direction: 'outgoing', targetId: 'file', targetPath: '/V/other.md', targetName: 'other.md', targetKind: 'markdown', pathHint: 'other.md', status: 'available' },
        { edgeId: 'folder-edge', ownerId: 'owner', ownerPath: '/V/note.md', direction: 'outgoing', targetId: 'folder', targetPath: '/V/Folder', targetName: 'Folder', targetKind: 'directory', pathHint: 'Folder', status: 'available' },
        { edgeId: 'missing-edge', ownerId: 'owner', ownerPath: '/V/note.md', direction: 'outgoing', targetId: 'missing', targetPath: null, targetName: 'lost.md', targetKind: null, pathHint: 'lost.md', status: 'missing' },
        { edgeId: 'ambiguous-edge', ownerId: 'owner', ownerPath: '/V/note.md', direction: 'incoming', targetId: 'ambiguous', targetPath: null, targetName: 'copy.md', targetKind: null, pathHint: 'copy.md', status: 'ambiguous' },
      ] }) })),
    });
    render(
      <FilesNavigationContext.Provider value={{ navigateDirectory, navigateCollection: vi.fn(), openFile, returnToFolder: vi.fn(), closeFile: vi.fn() }}>
        <DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />
      </FilesNavigationContext.Provider>
    );
    await user.click(screen.getByRole('tab', { name: 'Details' }));

    await user.click(await screen.findByRole('button', { name: 'Open other.md' }));
    await user.click(screen.getByRole('button', { name: 'Open Folder' }));
    expect(openFile).toHaveBeenCalledWith('/V/other.md');
    expect(navigateDirectory).toHaveBeenCalledWith('/V/Folder');
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByText('Ambiguous')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open lost.md' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open copy.md' })).toBeDisabled();
  });

  it('removes a connection without discarding property drafts', async () => {
    const user = userEvent.setup();
    const api = installMetadataApi({
      read: vi.fn(async () => ({ success: true as const, data: metadata({ related: [
        { edgeId: 'edge-1', ownerId: 'owner', ownerPath: '/V/note.md', direction: 'outgoing', targetId: 'file', targetPath: '/V/other.md', targetName: 'other.md', targetKind: 'markdown', pathHint: 'other.md', status: 'available' },
      ] }) })),
      removeRelated: vi.fn(async () => ({ success: true as const, data: metadata({ revision: 'rev-2' }) })),
    });
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByRole('button', { name: 'Remove related item other.md' });
    await user.click(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'draft');

    expect(screen.getByRole('button', { name: 'Remove related item other.md' })).toBeDisabled();
    expect(screen.getByText('Save or reload your property changes before editing related items.')).toBeInTheDocument();
    expect(api.removeRelated).not.toHaveBeenCalled();
  });

  it('removes a connection through its current Details path and edge ID', async () => {
    const user = userEvent.setup();
    const api = installMetadataApi({
      read: vi.fn(async () => ({ success: true as const, data: metadata({ related: [
        { edgeId: 'edge-1', ownerId: 'other', ownerPath: '/V/other.md', direction: 'incoming', targetId: 'owner', targetPath: '/V/other.md', targetName: 'other.md', targetKind: 'markdown', pathHint: 'other.md', status: 'available' },
      ] }) })),
      removeRelated: vi.fn(async () => ({ success: true as const, data: metadata({ revision: 'rev-2', related: [] }) })),
    });
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));

    await user.click(await screen.findByRole('button', { name: 'Remove related item other.md' }));

    await waitFor(() => expect(api.removeRelated).toHaveBeenCalledWith('/V/note.md', 'edge-1'));
    expect(screen.queryByText('other.md')).not.toBeInTheDocument();
  });

  it('chooses a file and connects it without recursive browsing or early writes', async () => {
    const user = userEvent.setup();
    const api = installMetadataApi();
    installDiskApi({
      listRoots: vi.fn(async () => ({ success: true as const, data: ['/V'] })),
      readDirectory: vi.fn(async () => ({ success: true as const, data: { path: '/V', entries: [
        entry({ path: '/V/Folder', name: 'Folder', kind: 'directory', isDirectory: true }),
        entry({ path: '/V/target.md', name: 'target.md', kind: 'markdown' }),
      ] } })),
    });
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByLabelText('Tags');
    await user.click(screen.getByRole('button', { name: 'Add related item' }));

    expect(api.addRelated).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('radio', { name: 'target.md' }));
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(api.addRelated).toHaveBeenCalledWith('/V/note.md', '/V/target.md'));
  });

  it('keeps chooser folder reads live during StrictMode effect replay', async () => {
    const user = userEvent.setup();
    installDiskApi({
      listRoots: vi.fn(async () => ({ success: true as const, data: ['/V'] })),
      readDirectory: vi.fn(async () => ({ success: true as const, data: { path: '/V', entries: [
        entry({ path: '/V/target.md', name: 'target.md', kind: 'markdown' }),
      ] } })),
    });
    render(
      <React.StrictMode>
        <DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />
      </React.StrictMode>
    );
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByLabelText('Tags');
    await user.click(screen.getByRole('button', { name: 'Add related item' }));

    expect(await screen.findByRole('radio', { name: 'target.md' })).toBeInTheDocument();
  });

  it('clears chooser loading when opened-folder IPC rejects', async () => {
    const user = userEvent.setup();
    installDiskApi({ listRoots: vi.fn(async () => { throw new Error('bridge unavailable'); }) });
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByLabelText('Tags');

    await user.click(screen.getByRole('button', { name: 'Add related item' }));

    expect(await screen.findByText('Could not load opened folders.')).toBeInTheDocument();
    expect(screen.queryByText('Loading folder…')).not.toBeInTheDocument();
  });

  it('clears selection on reopen and waits for the retained folder listing before connecting', async () => {
    const user = userEvent.setup();
    let resolveRoots: (value: Awaited<ReturnType<typeof window.diskAPI.listRoots>>) => void = () => undefined;
    let resolveFolder: (value: Awaited<ReturnType<typeof window.diskAPI.readDirectory>>) => void = () => undefined;
    const delayedRoots = new Promise<Awaited<ReturnType<typeof window.diskAPI.listRoots>>>((resolve) => { resolveRoots = resolve; });
    const delayedFolder = new Promise<Awaited<ReturnType<typeof window.diskAPI.readDirectory>>>((resolve) => { resolveFolder = resolve; });
    const readDirectory = vi.fn()
      .mockResolvedValueOnce({ success: true as const, data: { path: '/V', entries: [
        entry({ path: '/V/Folder', name: 'Folder', kind: 'directory', isDirectory: true }),
      ] } })
      .mockResolvedValueOnce({ success: true as const, data: { path: '/V/Folder', entries: [
        entry({ path: '/V/Folder/target.md', name: 'target.md', kind: 'markdown' }),
      ] } })
      .mockReturnValueOnce(delayedFolder);
    installDiskApi({
      listRoots: vi.fn()
        .mockResolvedValueOnce({ success: true as const, data: ['/V'] })
        .mockReturnValueOnce(delayedRoots),
      readDirectory,
    });
    const api = installMetadataApi();
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByLabelText('Tags');
    await user.click(screen.getByRole('button', { name: 'Add related item' }));
    await user.click(await screen.findByRole('button', { name: 'Browse Folder' }));
    await user.click(await screen.findByRole('radio', { name: 'target.md' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Add related item' }));
    const staleConnect = screen.getByRole('button', { name: 'Connect' });
    expect(staleConnect).toBeDisabled();
    await user.click(staleConnect);
    expect(api.addRelated).not.toHaveBeenCalled();
    expect(screen.queryByRole('radio', { name: 'target.md' })).not.toBeInTheDocument();
    resolveRoots({ success: true, data: ['/V'] });
    await waitFor(() => expect(readDirectory).toHaveBeenLastCalledWith('/V/Folder'));
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    resolveFolder({ success: true, data: { path: '/V/Folder', entries: [
      entry({ path: '/V/Folder/target.md', name: 'target.md', kind: 'markdown' }),
    ] } });
    expect(await screen.findByRole('radio', { name: 'target.md' })).not.toBeChecked();
    expect(api.addRelated).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', { success: false as const, error: 'Roots changed.' }],
    ['empty', { success: true as const, data: [] }],
  ])('clears a stale folder when reopened roots are %s', async (_, refreshedRoots) => {
    const user = userEvent.setup();
    installDiskApi({
      listRoots: vi.fn()
        .mockResolvedValueOnce({ success: true as const, data: ['/V'] })
        .mockResolvedValueOnce(refreshedRoots),
      readDirectory: vi.fn(async (target: string) => ({ success: true as const, data: { path: target, entries: [
        entry({ path: `${target}/target.md`, name: 'target.md', kind: 'markdown' }),
      ] } })),
    });
    const api = installMetadataApi();
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByLabelText('Tags');
    await user.click(screen.getByRole('button', { name: 'Add related item' }));
    await user.click(await screen.findByRole('radio', { name: 'target.md' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Add related item' }));
    if ('error' in refreshedRoots) expect(await screen.findByRole('alert')).toHaveTextContent('Roots changed.');
    else expect(await screen.findByText('No opened folders.')).toBeInTheDocument();
    expect(screen.queryByText('Current folder')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'target.md' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(api.addRelated).not.toHaveBeenCalled();
  });

  it('lets a directory be selected independently from browsing into it', async () => {
    const user = userEvent.setup();
    const api = installMetadataApi();
    installDiskApi({
      listRoots: vi.fn(async () => ({ success: true as const, data: ['/V'] })),
      readDirectory: vi.fn(async (target: string) => ({ success: true as const, data: { path: target, entries: target === '/V' ? [
        entry({ path: '/V/Folder', name: 'Folder', kind: 'directory', isDirectory: true }),
      ] : [] } })),
    });
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByLabelText('Tags');
    await user.click(screen.getByRole('button', { name: 'Add related item' }));

    const folderChoice = await screen.findByRole('radio', { name: 'Folder' });
    expect(screen.getByRole('button', { name: 'Browse Folder' })).toBeInTheDocument();
    await user.click(folderChoice);
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(api.addRelated).toHaveBeenCalledWith('/V/note.md', '/V/Folder'));
  });

  it('shows incomplete catalog warnings', async () => {
    const user = userEvent.setup();
    installMetadataApi({ read: vi.fn(async () => ({ success: true as const, data: metadata({ incomplete: true, warnings: ['Could not scan /V/Locked'] }) })) });
    render(<DetailPane entry={entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' })} />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));

    expect(await screen.findByText('Related results may be incomplete.')).toBeInTheDocument();
    expect(screen.getByText('Could not scan /V/Locked')).toBeInTheDocument();
  });
});

describe('Details integration integrity', () => {
  const related: ItemMetadata['related'][number] = {
    edgeId: 'edge-1', ownerId: 'owner', ownerPath: '/V/note.md', direction: 'outgoing',
    targetId: 'file', targetPath: '/V/other.md', targetName: 'other.md',
    targetKind: 'markdown', pathHint: 'other.md', status: 'available',
  };
  const source = entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown' });
  const renderDetails = () => {
    const navigation = { navigateDirectory: vi.fn(),
    navigateCollection: vi.fn(), openFile: vi.fn(), returnToFolder: vi.fn(), closeFile: vi.fn() };
    const view = render(<FilesNavigationContext.Provider value={navigation}><DetailPane entry={source} /></FilesNavigationContext.Provider>);
    return { ...view, navigation };
  };

  it.each([
    ['same-name replacement without its identity', [{ ...related, status: 'missing', targetPath: null, targetKind: null }]],
    ['ambiguous target', [{ ...related, status: 'ambiguous', targetPath: null, targetKind: null }]],
    ['removed edge', []],
    ['changed target identity', [{ ...related, targetId: 'replacement' }]],
    ['changed owner identity', [{ ...related, ownerId: 'replacement' }]],
    ['changed direction', [{ ...related, direction: 'incoming' }]],
    ['changed edge identity', [{ ...related, edgeId: 'replacement' }]],
  ] satisfies [string, ItemMetadata['related']][])('revalidates a retained row and refuses %s', async (_, freshRelated) => {
    const user = userEvent.setup();
    const api = installMetadataApi({ read: vi.fn()
      .mockResolvedValueOnce({ success: true, data: metadata({ related: [related] }) })
      .mockResolvedValueOnce({ success: true, data: metadata({ related: freshRelated }) }),
    });
    const { navigation } = renderDetails();
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await user.click(await screen.findByRole('button', { name: 'Open other.md' }));
    expect(navigation.openFile).not.toHaveBeenCalled();
    expect(navigation.navigateDirectory).not.toHaveBeenCalled();
    expect(api.read).toHaveBeenNthCalledWith(2, '/V/note.md');
    expect(await screen.findByRole('alert')).toHaveTextContent(/reload|remove|retry/i);
  });

  it.each([
    ['markdown', '/V/moved/renamed.md', 'openFile'],
    ['directory', '/V/moved/Folder', 'navigateDirectory'],
  ] as const)('follows a freshly resolved moved %s endpoint', async (targetKind, targetPath, action) => {
    const user = userEvent.setup();
    installMetadataApi({ read: vi.fn()
      .mockResolvedValueOnce({ success: true, data: metadata({ related: [related] }) })
      .mockResolvedValueOnce({ success: true, data: metadata({ related: [{ ...related, targetPath, targetKind, targetName: 'Moved' }] }) }),
    });
    const { navigation } = renderDetails();
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await user.click(await screen.findByRole('button', { name: 'Open other.md' }));
    expect(navigation[action]).toHaveBeenCalledExactlyOnceWith(targetPath);
    expect(screen.getByRole('button', { name: 'Open Moved' })).toBeInTheDocument();
  });

  it('refuses to follow when the current source identity changed', async () => {
    const user = userEvent.setup();
    installMetadataApi({ read: vi.fn()
      .mockResolvedValueOnce({ success: true, data: metadata({ related: [related] }) })
      .mockResolvedValueOnce({ success: true, data: metadata({ id: 'replacement-source', related: [related] }) }),
    });
    const { navigation } = renderDetails();
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await user.click(await screen.findByRole('button', { name: 'Open other.md' }));
    expect(navigation.openFile).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed.*reload/i);
  });

  it('refreshes Related warnings and status without overwriting drafts or their saved revision', async () => {
    const user = userEvent.setup();
    const api = installMetadataApi({ read: vi.fn()
      .mockResolvedValueOnce({ success: true, data: metadata({ related: [related], properties: { tags: ['original'], description: '' } }) })
      .mockResolvedValueOnce({ success: true, data: metadata({ revision: 'external-revision', properties: { tags: ['external'], description: 'External edit' }, related: [{ ...related, status: 'missing', targetPath: null, targetKind: null }], warnings: ['Duplicate identity warning'] }) }),
      saveProperties: vi.fn(async () => ({ success: false as const, error: 'Metadata changed on disk. Reload Details.' })),
    });
    const { navigation } = renderDetails();
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await user.type(await screen.findByLabelText('Description'), 'My draft');
    await user.type(screen.getByLabelText('Tags'), ', edited');
    await user.click(screen.getByRole('button', { name: 'Open other.md' }));
    expect(navigation.openFile).not.toHaveBeenCalled();
    expect(await screen.findByText('Missing')).toBeInTheDocument();
    expect(screen.getByText('Duplicate identity warning')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue('My draft');
    expect(screen.getByLabelText('Tags')).toHaveValue('original, edited');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.saveProperties).toHaveBeenCalledWith('/V/note.md', { tags: ['original', 'edited'], description: 'My draft' }, 'rev-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Metadata changed on disk.');
  });

  it.each(['save', 'remove'] as const)('locks property typing and Related actions during a delayed %s', async (operation) => {
    const user = userEvent.setup();
    let resolve!: (value: { success: true; data: ItemMetadata }) => void;
    const pending = new Promise<{ success: true; data: ItemMetadata }>((done) => { resolve = done; });
    const api = installMetadataApi({
      read: vi.fn(async () => ({ success: true as const, data: metadata({ related: [related], properties: { tags: ['work'], description: '' } }) })),
      saveProperties: vi.fn(() => pending), removeRelated: vi.fn(() => pending),
    });
    const { navigation } = renderDetails();
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByLabelText('Description');
    if (operation === 'save') await user.type(screen.getByLabelText('Description'), 'Submitted');
    await user.click(screen.getByRole('button', { name: operation === 'save' ? 'Save' : 'Remove related item other.md' }));
    await user.type(screen.getByLabelText('Description'), 'New typing');
    await user.type(screen.getByLabelText('Tags'), ', later');
    expect(screen.getByLabelText('Description')).toHaveValue(operation === 'save' ? 'Submitted' : '');
    expect(screen.getByLabelText('Tags')).toHaveValue('work');
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.getByLabelText('Tags')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Open other.md' }));
    expect(navigation.openFile).not.toHaveBeenCalled();
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Add related item' })).toBeDisabled();
    resolve({ success: true, data: metadata({ properties: { tags: ['work'], description: operation === 'save' ? 'Submitted' : '' }, revision: 'rev-2' }) });
    await waitFor(() => expect(screen.getByLabelText('Description')).toBeEnabled());
    await user.type(screen.getByLabelText('Description'), 'After');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('locks editing and concurrent actions while revalidating Open, then unlocks after a read error', async () => {
    const user = userEvent.setup();
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_, fail) => { reject = fail; });
    const api = installMetadataApi({ read: vi.fn()
      .mockResolvedValueOnce({ success: true, data: metadata({ related: [related] }) })
      .mockReturnValueOnce(pending),
    });
    const { navigation } = renderDetails();
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    const open = await screen.findByRole('button', { name: 'Open other.md' });
    await user.dblClick(open);
    await user.type(screen.getByLabelText('Description'), 'Late typing');
    await user.type(screen.getByLabelText('Tags'), 'Late tag');
    expect(screen.getByLabelText('Description')).toHaveValue('');
    expect(screen.getByLabelText('Tags')).toHaveValue('');
    expect(open).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add related item' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remove related item other.md' }));
    expect(api.removeRelated).not.toHaveBeenCalled();
    expect(api.read).toHaveBeenCalledTimes(2);
    reject(new Error('Disconnected'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not.*retry|reload/i);
    expect(screen.getByLabelText('Description')).toBeEnabled();
    expect(screen.getByLabelText('Tags')).toBeEnabled();
    expect(open).toBeEnabled();
    expect(navigation.openFile).not.toHaveBeenCalled();
  });

  it('ignores an Open response after the selected item changes', async () => {
    const user = userEvent.setup();
    let resolve!: (value: { success: true; data: ItemMetadata }) => void;
    const pending = new Promise<{ success: true; data: ItemMetadata }>((done) => { resolve = done; });
    installMetadataApi({ read: vi.fn()
      .mockResolvedValueOnce({ success: true, data: metadata({ related: [related] }) })
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce({ success: true, data: metadata({ path: '/V/new.md', properties: { tags: [], description: 'New item' } }) }),
    });
    const { navigation, rerender } = renderDetails();
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await user.click(await screen.findByRole('button', { name: 'Open other.md' }));
    rerender(<FilesNavigationContext.Provider value={navigation}><DetailPane entry={entry({ path: '/V/new.md', name: 'new.md', kind: 'markdown' })} /></FilesNavigationContext.Provider>);
    expect(await screen.findByDisplayValue('New item')).toBeInTheDocument();
    resolve({ success: true, data: metadata({ related: [related] }) });
    await Promise.resolve();
    expect(navigation.openFile).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Description')).toHaveValue('New item');
    expect(screen.getByLabelText('Description')).toBeEnabled();
  });

  it('preserves comma, whitespace and empty tags on a description-only save until tags are edited', async () => {
    const user = userEvent.setup();
    const api = installMetadataApi({ read: vi.fn(async () => ({ success: true as const, data: metadata({ properties: { tags: ['research, primary', ' padded ', ''], description: '' } }) })) });
    renderDetails();
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await screen.findByLabelText('Tags');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add related item' })).toBeEnabled();
    await user.type(screen.getByLabelText('Description'), 'Description only');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.saveProperties).toHaveBeenLastCalledWith('/V/note.md', { tags: ['research, primary', ' padded ', ''], description: 'Description only' }, 'rev-1');
    await screen.findByText('Saved');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Tags'));
    await user.type(screen.getByLabelText('Tags'), 'work, urgent');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.saveProperties).toHaveBeenLastCalledWith('/V/note.md', { tags: ['work', 'urgent'], description: 'Description only' }, 'rev-2');
  });

  it('shows a duplicate-current-identity warning without an incomplete-index message', async () => {
    const user = userEvent.setup();
    installMetadataApi({ read: vi.fn(async () => ({ success: true as const, data: metadata({ warnings: ['This item has a duplicate UUID; its identity is ambiguous.'], incomplete: false }) })) });
    renderDetails();
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    expect(await screen.findByText('This item has a duplicate UUID; its identity is ambiguous.')).toBeInTheDocument();
    expect(screen.queryByText('Related results may be incomplete.')).not.toBeInTheDocument();
  });

  it('shows the distinguishing current folder name with the absolute path in its title', async () => {
    const user = userEvent.setup();
    const folder = '/V/a/long/path/Distinctive';
    installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: [folder] })), readDirectory: vi.fn(async () => ({ success: true as const, data: { path: folder, entries: [] } })) });
    renderDetails();
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await user.click(await screen.findByRole('button', { name: 'Add related item' }));
    expect(await screen.findByTitle(folder)).toHaveTextContent(/^Distinctive$/);
  });
});
