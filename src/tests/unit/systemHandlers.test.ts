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
