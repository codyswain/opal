import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { FLUSH_TIMEOUT_MS, PendingSavesGuard } from '@/main/window/PendingSavesGuard';

class FakeWindow extends EventEmitter {
  destroyed = false;
  sent: Array<[string, number]> = [];
  webContents = { isDestroyed: () => this.destroyed, send: (channel: string, id: number) => { this.sent.push([channel, id]); } };
  isDestroyed = () => this.destroyed;
  /** Emits close the way Electron does and reports whether it went through. */
  close = vi.fn(() => {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    this.emit('close', event);
    if (!event.defaultPrevented) this.destroyed = true;
    return !event.defaultPrevented;
  });
}

let ipc: EventEmitter;
let app: EventEmitter & { quit: ReturnType<typeof vi.fn> };
let dialog: { showMessageBox: ReturnType<typeof vi.fn> };
let window: FakeWindow;

beforeEach(() => {
  vi.useFakeTimers();
  ipc = new EventEmitter();
  app = Object.assign(new EventEmitter(), { quit: vi.fn() });
  dialog = { showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: false })) };
  window = new FakeWindow();
  new PendingSavesGuard({ ipc: ipc as never, app: app as never, dialog: dialog as never }).attach(window as unknown as BrowserWindow);
});
afterEach(() => { vi.useRealTimers(); });

const answer = (id: number, unsaved: unknown = []) => ipc.emit('markdown:flushed', {}, id, unsaved);
const UNSAVED = [
  { name: 'brief', copy: '/Vault/Notes/brief (unsaved copy).md' },
  { name: 'plan', copy: null },
];

describe('PendingSavesGuard', () => {
  it('holds a window close until the renderer has flushed, then closes it', async () => {
    expect(window.close()).toBe(false);
    expect(window.sent).toEqual([['markdown:flush', 1]]);
    // A second click while the flush runs asks nothing new.
    window.close();
    expect(window.sent).toHaveLength(1);
    answer(1);
    await vi.waitFor(() => expect(window.destroyed).toBe(true));
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('resumes a quit that the held close cancelled', async () => {
    app.emit('before-quit');
    expect(window.close()).toBe(false);
    answer(window.sent[0][1]);
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1));
    // The resumed quit closes the window without asking again.
    expect(window.close()).toBe(true);
    expect(window.sent).toHaveLength(1);
  });

  it('asks before quitting over notes that could not be saved, and Cancel keeps the window open', async () => {
    app.emit('before-quit');
    window.close();
    answer(1, UNSAVED);
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(1));
    expect(dialog.showMessageBox.mock.calls[0][1]).toMatchObject({
      message: '2 notes could not be saved',
      detail: 'brief: your changes are in /Vault/Notes/brief (unsaved copy).md\nplan: your changes are only in the open page',
      buttons: ['Cancel', 'Quit anyway'],
      cancelId: 0,
    });
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
    expect(window.destroyed).toBe(false);
    expect(app.quit).not.toHaveBeenCalled();
    // Closing the window later asks again, and is a close, not the cancelled quit.
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
    window.close();
    answer(2, UNSAVED.slice(1));
    await vi.waitFor(() => expect(window.destroyed).toBe(true));
    expect(dialog.showMessageBox.mock.calls[1][1]).toMatchObject({ message: '1 note could not be saved', buttons: ['Cancel', 'Close anyway'] });
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('quits on Quit anyway and ignores a malformed answer', async () => {
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
    app.emit('before-quit');
    window.close();
    answer(1, [{ name: 'brief', copy: null }, { name: 7 }, null]);
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1));
    expect(dialog.showMessageBox.mock.calls[0][1]).toMatchObject({ message: '1 note could not be saved' });
  });

  it('closes anyway when the renderer does not answer in time', async () => {
    window.close();
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS);
    expect(window.destroyed).toBe(true);
  });
});
