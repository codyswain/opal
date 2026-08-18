import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppMenu } from '@/main/menu/AppMenu';
import { COMMAND_IDS } from '@/common/commandIds';

interface FakeMenuItem {
  label?: string;
  role?: string;
  accelerator?: string;
  click?: () => void;
  type?: string;
  submenu?: FakeMenuItem[];
}

let built: FakeMenuItem[] | null;
let applied: FakeMenuItem[] | null;
let sent: string[];

const menuStub = {
  buildFromTemplate: vi.fn((template: FakeMenuItem[]) => {
    built = template;
    return template;
  }),
  setApplicationMenu: vi.fn((template: FakeMenuItem[]) => {
    applied = template;
  }),
};

function makeMenu() {
  return new AppMenu({
    menu: menuStub,
    appName: 'Opal',
    send: (id: string) => sent.push(id),
  });
}

const COMMANDS = [
  { id: COMMAND_IDS.openSettings, label: 'Settings…', accelerator: 'CmdOrCtrl+,' },
  { id: COMMAND_IDS.openFolder, label: 'Open Folder…', accelerator: 'CmdOrCtrl+O' },
];

beforeEach(() => {
  built = null;
  applied = null;
  sent = [];
  vi.clearAllMocks();
});

function allItems(template: FakeMenuItem[]): FakeMenuItem[] {
  return template.flatMap((menu) => menu.submenu ?? []);
}

describe('AppMenu', () => {
  it('installs a menu built from the template', () => {
    makeMenu().install(COMMANDS);
    expect(menuStub.buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(menuStub.setApplicationMenu).toHaveBeenCalledTimes(1);
    expect(applied).toBe(built);
  });

  it('gives every command-backed item a click handler', () => {
    makeMenu().install(COMMANDS);
    const settings = allItems(built!).find((item) => item.label === 'Settings…');
    expect(typeof settings?.click).toBe('function');
  });

  it('sends the command id to the renderer when an item is clicked', () => {
    makeMenu().install(COMMANDS);
    const settings = allItems(built!).find((item) => item.label === 'Settings…');
    settings?.click?.();
    expect(sent).toEqual([COMMAND_IDS.openSettings]);
  });

  it('does not attach a click handler to a role-based item', () => {
    // Attaching one overrides the role and breaks the native behaviour.
    makeMenu().install(COMMANDS);
    const copy = allItems(built!).find((item) => item.role === 'copy');
    expect(copy?.click).toBeUndefined();
  });

  it('strips the internal commandId before handing the template to Electron', () => {
    makeMenu().install(COMMANDS);
    for (const item of allItems(built!)) {
      expect(item).not.toHaveProperty('commandId');
    }
  });

  it('replaces the previous menu when installed again', () => {
    const menu = makeMenu();
    menu.install(COMMANDS);
    menu.install([{ id: COMMAND_IDS.openFolder, label: 'Open Folder…' }]);

    expect(menuStub.setApplicationMenu).toHaveBeenCalledTimes(2);
    expect(allItems(built!).some((item) => item.label === 'Settings…')).toBe(false);
  });
});
