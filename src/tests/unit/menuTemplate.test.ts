import { describe, it, expect } from 'vitest';
import { buildMenuTemplate, type MenuCommand } from '@/main/menu/menuTemplate';
import { COMMAND_IDS, TAB_POSITION_COMMAND_IDS } from '@/common/commandIds';

/** What the renderer reports; AppCommands holds the real list. */
const COMMANDS: MenuCommand[] = [
  { id: COMMAND_IDS.openSettings, label: 'Settings…', accelerator: 'CmdOrCtrl+,' },
  { id: COMMAND_IDS.openFolder, label: 'Open Folder…', accelerator: 'CmdOrCtrl+O' },
  { id: COMMAND_IDS.newNote, label: 'New Note', accelerator: 'CmdOrCtrl+N' },
  { id: COMMAND_IDS.toggleLeftPane, label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\' },
  { id: COMMAND_IDS.toggleRightPane, label: 'Toggle Right Sidebar', accelerator: 'CmdOrCtrl+Shift+\\' },
  { id: COMMAND_IDS.toggleProperties, label: 'Show Properties', accelerator: 'CmdOrCtrl+Shift+I' },
  { id: COMMAND_IDS.collapseAllFolders, label: 'Collapse All Folders', accelerator: 'Alt+CmdOrCtrl+Left' },
  { id: COMMAND_IDS.nextSection, label: 'Next Section', accelerator: 'Alt+CmdOrCtrl+Down' },
  { id: COMMAND_IDS.previousSection, label: 'Previous Section', accelerator: 'Alt+CmdOrCtrl+Up' },
  { id: COMMAND_IDS.newTab, label: 'New Tab', accelerator: 'CmdOrCtrl+T' },
  { id: COMMAND_IDS.closeTab, label: 'Close Tab', accelerator: 'CmdOrCtrl+W' },
  { id: COMMAND_IDS.reopenClosedTab, label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T' },
  { id: COMMAND_IDS.previousTab, label: 'Show Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', aliases: ['Ctrl+Shift+Tab'] },
  { id: COMMAND_IDS.nextTab, label: 'Show Next Tab', accelerator: 'CmdOrCtrl+Shift+]', aliases: ['Ctrl+Tab'] },
  ...TAB_POSITION_COMMAND_IDS.map((id, index) => ({ id, label: `Show Tab ${index + 1}`, accelerator: `CmdOrCtrl+${index + 1}` })),
  { id: COMMAND_IDS.lastTab, label: 'Show Last Tab', accelerator: 'CmdOrCtrl+9' },
  { id: COMMAND_IDS.back, label: 'Back', accelerator: 'CmdOrCtrl+[' },
  { id: COMMAND_IDS.forward, label: 'Forward', accelerator: 'CmdOrCtrl+]' },
];

function build(commands = COMMANDS) {
  return buildMenuTemplate(commands, { appName: 'Opal' });
}

function labels(template: ReturnType<typeof build>) {
  return template.map((menu) => menu.label);
}

function menu(template: ReturnType<typeof build>, label: string) {
  const found = template.find((entry) => entry.label === label);
  if (!found) throw new Error(`No ${label} menu`);
  return found.submenu;
}

function findItem(template: ReturnType<typeof build>, commandId: string) {
  for (const entry of template) {
    for (const item of entry.submenu) {
      if (item.commandId === commandId && item.visible !== false) return item;
    }
  }
  return undefined;
}

/** What the shown part of a menu reads, separators as `-`. */
function shown(items: ReturnType<typeof menu>) {
  return items
    .filter((item) => item.visible !== false)
    .map((item) => (item.type === 'separator' ? '-' : `${item.label}${item.accelerator ? ` ${item.accelerator}` : ''}`));
}

/**
 * Electron's accelerator grammar (electronjs.org/docs/latest/api/accelerator):
 * modifiers joined by `+`, then one key code. The real menu is also parsed by
 * Electron itself in e2e/tests/tabs.spec.ts.
 */
const MODIFIERS = new Set(['Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta']);
const NAMED_KEYS = new Set(['Plus', 'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc']);
function isAccelerator(value: string): boolean {
  // A trailing `+` key (CmdOrCtrl++) is written as Plus, so splitting is safe.
  const parts = value.split('+');
  const key = parts.pop() ?? '';
  const keyOk = /^[A-Z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || NAMED_KEYS.has(key) || /^[`~!@#$%^&*()\-_=[\]{}\\|;:'",<.>/?]$/.test(key);
  return keyOk && parts.length > 0 && parts.every((part) => MODIFIERS.has(part)) && new Set(parts).size === parts.length;
}

describe('buildMenuTemplate', () => {
  it('produces the standard macOS menu spine, with Go for history', () => {
    expect(labels(build())).toEqual(['Opal', 'File', 'Edit', 'View', 'Go', 'Window']);
  });

  it('places Settings in the app menu with its accelerator', () => {
    expect(findItem(build(), COMMAND_IDS.openSettings)?.accelerator).toBe('CmdOrCtrl+,');
  });

  it('gives File the tab commands, with Cmd+W for the tab and Shift+Cmd+W for the window', () => {
    expect(shown(menu(build(), 'File'))).toEqual([
      'New Tab CmdOrCtrl+T',
      'New Note CmdOrCtrl+N',
      'Open Folder… CmdOrCtrl+O',
      '-',
      'Close Tab CmdOrCtrl+W',
      'Close Window CmdOrCtrl+Shift+W',
      'Reopen Closed Tab CmdOrCtrl+Shift+T',
    ]);
    expect(menu(build(), 'File').find((item) => item.label === 'Close Window')?.role).toBe('close');
  });

  it('puts Back and Forward in Go and the sidebar toggles on Cmd+\\ and Cmd+Shift+\\, leaving Cmd+B to bold', () => {
    expect(shown(menu(build(), 'Go'))).toEqual(['Back CmdOrCtrl+[', 'Forward CmdOrCtrl+]']);
    expect(findItem(build(), COMMAND_IDS.toggleLeftPane)?.accelerator).toBe('CmdOrCtrl+\\');
    expect(shown(menu(build(), 'View')).slice(0, 3)).toEqual([
      'Toggle Sidebar CmdOrCtrl+\\',
      'Toggle Right Sidebar CmdOrCtrl+Shift+\\',
      'Show Properties CmdOrCtrl+Shift+I',
    ]);
    // Collapse All Folders follows, on Option-Command-Left, which no other item and no editor key uses.
    expect(shown(menu(build(), 'View'))[4]).toBe('Collapse All Folders Alt+CmdOrCtrl+Left');
    // A stack's section commands come next, on the keys the editor gives up for them.
    expect(shown(menu(build(), 'View')).slice(6, 8)).toEqual(['Next Section Alt+CmdOrCtrl+Down', 'Previous Section Alt+CmdOrCtrl+Up']);
    const accelerators = build().flatMap((entry) => entry.submenu.map((item) => item.accelerator));
    expect(accelerators.filter((accelerator) => accelerator === 'Alt+CmdOrCtrl+Left')).toHaveLength(1);
    expect(accelerators).not.toContain('CmdOrCtrl+B');
    // Cmd+I is italic in the editor and Cmd+Option+I opens the developer tools.
    expect(accelerators).not.toContain('CmdOrCtrl+I');
    expect(menu(build(), 'View').find((item) => item.role === 'toggleDevTools')?.accelerator).toBeUndefined();
  });

  it('shows Previous and Next Tab in Window, with Ctrl+Tab aliases and tab positions hidden', () => {
    const window = menu(build(), 'Window');
    expect(shown(window)).toEqual([
      'Minimize',
      'Zoom',
      '-',
      'Show Previous Tab CmdOrCtrl+Shift+[',
      'Show Next Tab CmdOrCtrl+Shift+]',
      '-',
      'Bring All to Front',
    ]);
    const hidden = window.filter((item) => item.visible === false);
    expect(hidden.map((item) => [item.commandId, item.accelerator])).toEqual([
      [COMMAND_IDS.previousTab, 'Ctrl+Shift+Tab'],
      [COMMAND_IDS.nextTab, 'Ctrl+Tab'],
      ...TAB_POSITION_COMMAND_IDS.map((id, index) => [id, `CmdOrCtrl+${index + 1}`]),
      [COMMAND_IDS.lastTab, 'CmdOrCtrl+9'],
    ]);
  });

  it('gives Edit the clipboard roles rather than custom handlers', () => {
    // Roles are what make Cmd+C/V/A work inside custom widgets. A hand-rolled
    // handler here would break text selection in the rename dialog.
    const roles = menu(build(), 'Edit').map((item) => item.role).filter(Boolean);
    expect(roles).toEqual(
      expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
    );
  });

  it('never emits an item that has neither a role nor a commandId', () => {
    // Such an item renders as a dead menu entry.
    for (const entry of build()) {
      for (const item of entry.submenu) {
        if (item.type === 'separator') continue;
        expect(Boolean(item.role || item.commandId)).toBe(true);
      }
    }
  });

  it('omits commands that are not supplied, with no stray separators or empty menus', () => {
    const template = build([{ id: COMMAND_IDS.openSettings, label: 'Settings…' }]);
    expect(findItem(template, COMMAND_IDS.openFolder)).toBeUndefined();
    expect(labels(template)).not.toContain('Go');
    expect(shown(menu(template, 'File'))).toEqual(['Close Window CmdOrCtrl+Shift+W']);
    expect(shown(menu(template, 'Window'))).toEqual(['Minimize', 'Zoom', '-', 'Bring All to Front']);
  });

  it('uses each accelerator exactly once across the whole menu', () => {
    const seen = new Map<string, string>();
    for (const entry of build()) {
      for (const item of entry.submenu) {
        if (!item.accelerator) continue;
        expect(seen.has(item.accelerator)).toBe(false);
        seen.set(item.accelerator, item.label ?? item.role ?? '');
      }
    }
  });

  it('uses only accelerators in the grammar Electron 31 parses', () => {
    const accelerators = build().flatMap((entry) =>
      entry.submenu.flatMap((item) => (item.accelerator ? [item.accelerator] : []))
    );
    expect(accelerators.length).toBeGreaterThan(20);
    expect(accelerators.filter((accelerator) => !isAccelerator(accelerator))).toEqual([]);
    expect(isAccelerator('Ctrl+Bogus')).toBe(false);
  });
});

describe('COMMAND_IDS', () => {
  it('has no duplicate values', () => {
    const values = [...Object.values(COMMAND_IDS), ...TAB_POSITION_COMMAND_IDS];
    expect(new Set(values).size).toBe(values.length);
  });
});
