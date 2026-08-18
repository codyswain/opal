import { describe, it, expect } from 'vitest';
import { buildMenuTemplate, type MenuCommand } from '@/main/menu/menuTemplate';
import { COMMAND_IDS } from '@/common/commandIds';

const COMMANDS: MenuCommand[] = [
  { id: COMMAND_IDS.openSettings, label: 'Settings…', accelerator: 'CmdOrCtrl+,' },
  { id: COMMAND_IDS.openFolder, label: 'Open Folder…', accelerator: 'CmdOrCtrl+O' },
  { id: COMMAND_IDS.toggleLeftPane, label: 'Toggle Left Pane', accelerator: 'CmdOrCtrl+B' },
];

function build() {
  return buildMenuTemplate(COMMANDS, { appName: 'Opal' });
}

function labels(template: ReturnType<typeof build>) {
  return template.map((menu) => menu.label);
}

function findItem(template: ReturnType<typeof build>, commandId: string) {
  for (const menu of template) {
    for (const item of menu.submenu) {
      if (item.commandId === commandId) return item;
    }
  }
  return undefined;
}

describe('buildMenuTemplate', () => {
  it('produces the standard macOS menu spine', () => {
    expect(labels(build())).toEqual(['Opal', 'File', 'Edit', 'View', 'Window']);
  });

  it('puts the app menu first, named after the app', () => {
    expect(build()[0].label).toBe('Opal');
  });

  it('places Settings in the app menu with its accelerator', () => {
    const item = findItem(build(), COMMAND_IDS.openSettings);
    expect(item).toBeDefined();
    expect(item?.accelerator).toBe('CmdOrCtrl+,');
  });

  it('places Open Folder in the File menu', () => {
    const file = build().find((menu) => menu.label === 'File');
    expect(file?.submenu.some((item) => item.commandId === COMMAND_IDS.openFolder)).toBe(true);
  });

  it('places pane toggles in the View menu', () => {
    const view = build().find((menu) => menu.label === 'View');
    expect(view?.submenu.some((item) => item.commandId === COMMAND_IDS.toggleLeftPane)).toBe(true);
  });

  it('gives Edit the clipboard roles rather than custom handlers', () => {
    // Roles are what make Cmd+C/V/A work inside custom widgets. A hand-rolled
    // handler here would break text selection in the rename dialog.
    const edit = build().find((menu) => menu.label === 'Edit');
    const roles = edit?.submenu.map((item) => item.role).filter(Boolean);
    expect(roles).toEqual(
      expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
    );
  });

  it('never emits an item that has neither a role nor a commandId', () => {
    // Such an item renders as a dead menu entry.
    for (const menu of build()) {
      for (const item of menu.submenu) {
        if (item.type === 'separator') continue;
        expect(Boolean(item.role || item.commandId)).toBe(true);
      }
    }
  });

  it('omits a command that is not supplied rather than emitting a dead entry', () => {
    const template = buildMenuTemplate(
      [{ id: COMMAND_IDS.openSettings, label: 'Settings…' }],
      { appName: 'Opal' }
    );
    expect(findItem(template, COMMAND_IDS.openFolder)).toBeUndefined();
  });

  it('uses each accelerator exactly once across the whole menu', () => {
    const seen = new Map<string, string>();
    for (const menu of build()) {
      for (const item of menu.submenu) {
        if (!item.accelerator) continue;
        expect(seen.has(item.accelerator)).toBe(false);
        seen.set(item.accelerator, item.label ?? item.role ?? '');
      }
    }
  });
});

describe('COMMAND_IDS', () => {
  it('has no duplicate values', () => {
    const values = Object.values(COMMAND_IDS);
    expect(new Set(values).size).toBe(values.length);
  });
});
