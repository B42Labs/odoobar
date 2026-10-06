import { app, Menu, nativeImage, Tray, type NativeImage } from 'electron';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FALLBACK_ICON, isIconName, type MenuBarUi } from './menu-bar';
import type { Messages } from './messages';
import type { WindowController } from './window';

/** The images that scripts/render-icons.ts writes. */
export const ICONS = join(__dirname, '../icons');

/**
 * Every icon name of the build, sorted. An error of readdirSync, such as
 * ENOENT, reaches the caller: only a broken build lacks the directory, and
 * test/unit/icons.test.ts checks it.
 */
export function iconNames(): string[] {
  return readdirSync(ICONS)
    .filter((file) => file.endsWith('.png') && !file.endsWith('@2x.png'))
    .map((file) => file.slice(0, -'.png'.length))
    .sort();
}

// Electron removes an icon from the menu bar when its Tray is garbage
// collected, so the module holds every Tray until showItems replaces it.
let trays: Tray[] = [];

/**
 * The menu bar image of a Lucide icon. An empty name, an unknown one, and one
 * that is no icon name give the fallback icon. macOS colors a template image
 * to match the menu bar.
 */
export function iconImage(icon: string): NativeImage {
  const load = (name: string) => nativeImage.createFromPath(join(ICONS, `${name}.png`));
  let image = isIconName(icon) ? load(icon) : nativeImage.createEmpty();
  if (image.isEmpty()) image = load(FALLBACK_ICON);
  image.setTemplateImage(true);
  return image;
}

/**
 * The Electron side of MenuBarUi: one Tray per item. It holds no decisions,
 * menu-bar.ts picks the items and window.ts answers the clicks.
 */
export function createMenuBarUi(controller: WindowController, messages: Messages): MenuBarUi {
  const menuOf = (id: string) =>
    Menu.buildFromTemplate([
      { label: messages.menuBar.reload, enabled: controller.canReload(id), click: () => controller.reloadApp(id) },
      { label: messages.menuBar.settings, click: () => controller.openSettings() },
      { label: messages.quit, click: () => app.quit() },
    ]);

  return {
    showItems(items) {
      for (const tray of trays) tray.destroy();
      // macOS puts a new icon to the left of the ones an app already has, so
      // the last item comes first.
      trays = items.toReversed().map((item) => {
        const tray = new Tray(iconImage(item.icon));
        tray.setToolTip(item.name);
        // Without this, the second of two quick clicks is a 'double-click' and no 'click'.
        tray.setIgnoreDoubleClickEvents(true);
        // macOS takes a Control-click as a secondary click.
        tray.on('click', (event) => {
          if (event.ctrlKey) return tray.popUpContextMenu(menuOf(item.id));
          controller.toggleApp(item.id);
        });
        // With setContextMenu, a left click would open the menu as well.
        tray.on('right-click', () => tray.popUpContextMenu(menuOf(item.id)));
        return tray;
      });
    },
  };
}
