// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, truncate, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { IpcMain } from 'electron';
import { RootRegistry } from '@/main/fs/RootRegistry';
import { FilesHandlers } from '@/main/files/FilesHandlers';
import { FilesService } from '@/main/files/FilesService';
import { FILE_IMPORT_LIMIT } from '@/types/files';

vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

describe('FilesHandlers', () => {
  let temporary: string, root: string, page: string;
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const showOpenDialog = vi.fn();
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args);

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-files-ipc-'));
    const registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    await mkdir(path.join(temporary, 'vault'));
    root = await registry.add(path.join(temporary, 'vault'));
    page = path.join(root, 'plan.mdo');
    await writeFile(page, '');
    handlers.clear();
    showOpenDialog.mockReset();
    const ipc = { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as unknown as IpcMain;
    // PDFs need no sips, so these run anywhere.
    new FilesHandlers({ ipc, service: new FilesService({ registry, links: { invalidateDirectories: vi.fn() } }), showOpenDialog }).registerAll();
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('validates every request', async () => {
    expect([...handlers.keys()].sort()).toEqual(['files:fetch', 'files:import', 'files:pick-and-import', 'files:status']);
    const invalid = { success: false, error: 'Invalid files request.' };
    expect(await invoke('files:import', 'plan.mdo', { bytes: new Uint8Array(1), name: 'a.pdf' })).toEqual(invalid);
    expect(await invoke('files:import', page, { bytes: [1, 2], name: 'a.pdf' })).toEqual(invalid);
    expect(await invoke('files:import', page, { bytes: new Uint8Array(1), name: '' })).toEqual(invalid);
    expect(await invoke('files:import', page, { path: 'relative.pdf' })).toEqual(invalid);
    expect(await invoke('files:status', 7)).toEqual(invalid);
    expect(await invoke('files:fetch', '')).toEqual(invalid);
    expect(await invoke('files:pick-and-import', null)).toEqual(invalid);
    expect(await invoke('files:status', path.join(temporary, 'outside.png'))).toMatchObject({ success: false, error: /not inside/ });
  });

  it('imports pasted bytes and answers where they went', async () => {
    const result = await invoke('files:import', page, { bytes: new Uint8Array(Buffer.from('%PDF')), name: 'Deck.pdf' }) as { success: true; data: { path: string; vaultPath: string } };
    expect(result).toMatchObject({ success: true, data: { name: 'Deck.pdf', vaultPath: expect.stringMatching(/^files\/\d{4}-\d\d\/deck\.[0-9a-f]{8}\.pdf$/) } });
    expect(await invoke('files:status', result.data.path)).toEqual({ success: true, data: 'here' });
    expect(await invoke('files:fetch', result.data.path)).toEqual({ success: true, data: 'here' });
  });

  it('asks for images with the open dialog, adds each in order and skips one it refuses', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await invoke('files:pick-and-import', page)).toEqual({ success: true, data: { files: [], skipped: [] } });

    await writeFile(path.join(temporary, 'a.pdf'), '%PDF a');
    await writeFile(path.join(temporary, 'huge.pdf'), '');
    await truncate(path.join(temporary, 'huge.pdf'), FILE_IMPORT_LIMIT + 1);
    await writeFile(path.join(temporary, 'b.pdf'), '%PDF b');
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['a.pdf', 'huge.pdf', 'b.pdf'].map((name) => path.join(temporary, name)) });
    const picked = await invoke('files:pick-and-import', page) as { data: { files: { name: string }[]; skipped: string[] } };
    expect(picked.data.files.map((file) => file.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(picked.data.skipped).toEqual(['"huge.pdf" is larger than 100 MB, so it was not added.']);
    expect(showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({ properties: ['openFile', 'multiSelections'], filters: [expect.objectContaining({ name: 'Images' })] }));
  });
});
