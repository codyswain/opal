import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, Dialog, IpcMain } from 'electron';
import type { ThemeReport } from '@/common/theme';

vi.mock('@/main/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { SystemHandlers } from '@/main/services/system/SystemHandlers';

type Listener = (event: unknown, payload: unknown) => void;

function createIpcStub() {
  const listeners = new Map<string, Listener>();
  const ipc = {
    handle: vi.fn(),
    on: (channel: string, listener: Listener) => {
      listeners.set(channel, listener);
    },
  } as unknown as IpcMain;

  return {
    ipc,
    emit(channel: string, payload: unknown) {
      const listener = listeners.get(channel);
      if (!listener) throw new Error(`No listener registered for ${channel}`);
      listener({}, payload);
    },
  };
}

let ipcStub: ReturnType<typeof createIpcStub>;
let onThemeChanged: (report: ThemeReport) => void;
let onThemeChangedSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  ipcStub = createIpcStub();
  onThemeChangedSpy = vi.fn();
  onThemeChanged = onThemeChangedSpy;

  new SystemHandlers({
    ipc: ipcStub.ipc,
    dialog: {} as Dialog,
    browserWindow: {} as typeof BrowserWindow,
    onThemeChanged,
  }).registerAll();
});

describe('SystemHandlers theme report', () => {
  it('forwards a validated preference and resolved theme', () => {
    const report: ThemeReport = {
      preference: 'system',
      resolved: 'dark',
    };

    ipcStub.emit('system:report-theme', report);

    expect(onThemeChangedSpy).toHaveBeenCalledWith(report);
  });

  it.each([
    null,
    'dark',
    { preference: 'sepia', resolved: 'dark' },
    { preference: 'system', resolved: 'sepia' },
    { preference: 'dark' },
  ])('ignores an invalid renderer payload: %j', (payload) => {
    ipcStub.emit('system:report-theme', payload);

    expect(onThemeChangedSpy).not.toHaveBeenCalled();
  });
});

describe('SystemHandlers full screen', () => {
  it('answers whether the asking window is in full screen', async () => {
    const handlers = new Map<string, (event: unknown) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (event: unknown) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as unknown as IpcMain;
    const sender = {};
    const fromWebContents = vi.fn((contents: unknown) =>
      contents === sender ? { isFullScreen: () => true } : null
    );
    new SystemHandlers({
      ipc,
      dialog: {} as Dialog,
      browserWindow: { fromWebContents } as unknown as typeof BrowserWindow,
      onThemeChanged: vi.fn(),
    }).registerAll();

    const isFullScreen = handlers.get('system:is-full-screen');
    expect(isFullScreen?.({ sender })).toBe(true);
    expect(isFullScreen?.({ sender: {} })).toBe(false);
  });
});

describe('SystemHandlers close window', () => {
  it('closes the window that asked, as Close Tab does with no tab left', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const ipc = {
      handle: vi.fn(),
      on: (channel: string, listener: (event: unknown) => void) => listeners.set(channel, listener),
    } as unknown as IpcMain;
    const sender = {};
    const close = vi.fn();
    const fromWebContents = vi.fn((contents: unknown) => (contents === sender ? { close } : null));
    new SystemHandlers({
      ipc,
      dialog: {} as Dialog,
      browserWindow: { fromWebContents } as unknown as typeof BrowserWindow,
      onThemeChanged: vi.fn(),
    }).registerAll();

    listeners.get('system:close-window')?.({ sender: {} });
    expect(close).not.toHaveBeenCalled();
    listeners.get('system:close-window')?.({ sender });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
