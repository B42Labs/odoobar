import type { Config } from './config';

/** One icon in the menu bar: the app it stands for, its tooltip, and the `icon` value of config.json. */
export interface MenuBarItem {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
}

/** The seam between the menu bar decisions and the screen. menu-bar-ui.ts is the Electron side. */
export interface MenuBarUi {
  /** Replaces every icon in the menu bar with these. The first item is the leftmost. */
  showItems(items: readonly MenuBarItem[]): void;
}

/** The Lucide icon of an app whose `icon` is empty or names no icon. */
export const FALLBACK_ICON = 'app-window';

/** Whether `name` has the form of a Lucide icon name, such as `message-circle`. Anything else never reaches the file system. */
export function isIconName(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

/** The apps with the menu bar flag, in the order of the configuration. */
export function menuBarItems(config: Config): MenuBarItem[] {
  return config.apps.filter((app) => app.menuBar).map(({ id, name, icon }) => ({ id, name, icon }));
}

/**
 * Decides which icons the menu bar shows. It replaces all of them when a
 * saved configuration changes their apps, names, icons, or order, and leaves
 * them alone otherwise, so a save of anything else does not make them flicker.
 */
export class MenuBar {
  private shown = '[]';

  constructor(
    private readonly ui: MenuBarUi,
    config: Config,
  ) {
    this.setConfig(config);
  }

  setConfig(config: Config): void {
    const items = menuBarItems(config);
    const next = JSON.stringify(items);
    if (next === this.shown) return;
    this.shown = next;
    this.ui.showItems(items);
  }
}
