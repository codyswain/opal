import { buildMenuTemplate, type MenuCommand, type MenuTemplateItem } from './menuTemplate';

/**
 * The subset of Electron's Menu that this class uses. Declaring it structurally
 * rather than importing Electron is what lets the class be unit-tested.
 */
export interface MenuLike {
  buildFromTemplate: (template: unknown[]) => unknown;
  setApplicationMenu: (menu: unknown) => void;
}

export interface AppMenuDependencies {
  menu: MenuLike;
  appName: string;
  /** Dispatches a command id to the focused renderer. */
  send: (commandId: string) => void;
}

export class AppMenu {
  private deps: AppMenuDependencies;

  constructor(deps: AppMenuDependencies) {
    this.deps = deps;
  }

  /**
   * Rebuilds and installs the application menu.
   *
   * Called again whenever the renderer's command list changes, because a
   * command registered after startup would otherwise never gain a menu entry.
   */
  install(commands: MenuCommand[]): void {
    const template = buildMenuTemplate(commands, { appName: this.deps.appName });

    const electronTemplate = template.map((entry) => ({
      label: entry.label,
      submenu: entry.submenu.map((item) => this.toElectronItem(item)),
    }));

    const menu = this.deps.menu.buildFromTemplate(electronTemplate);
    this.deps.menu.setApplicationMenu(menu);
  }

  private toElectronItem(item: MenuTemplateItem): Record<string, unknown> {
    // commandId is internal bookkeeping; Electron would reject the unknown key.
    const { commandId, ...rest } = item;
    if (!commandId) return { ...rest };

    return {
      ...rest,
      click: () => this.deps.send(commandId),
    };
  }
}
