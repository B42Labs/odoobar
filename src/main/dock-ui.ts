import { app, type BrowserWindow } from 'electron';
import type { Dock, DockUi } from './dock';

/** Electron ignores a call that hides the Dock icon within a second of the call that showed it. */
const HIDE_PAUSE_MS = 1_100;

/**
 * The Electron side of DockUi. Where Electron has no Dock, it does nothing.
 * The icon goes on a timer, once Electron takes the call. A window that opens
 * before the timer runs keeps the icon, so the icon does not flicker when the
 * main window follows the first-start prompt.
 */
export function createDockUi(): DockUi {
  let shown = false;
  let shownAt = 0;
  let hiding: NodeJS.Timeout | undefined;
  return {
    show() {
      clearTimeout(hiding);
      hiding = undefined;
      if (shown) return;
      shown = true;
      shownAt = Date.now();
      // Nothing waits for the icon, and Electron never rejects this promise.
      void app.dock?.show();
    },
    hide() {
      if (!shown || hiding) return;
      hiding = setTimeout(
        () => {
          hiding = undefined;
          shown = false;
          app.dock?.hide();
        },
        Math.max(0, shownAt + HIDE_PAUSE_MS - Date.now()),
      );
    },
  };
}

/**
 * Shows a window of OdooBar in front of every other app. `name` is what the
 * window tells `dock` when it closes or hides.
 */
export function showInFront(dock: Dock, name: string, window: BrowserWindow): void {
  // The Dock icon comes first: an app that gets it while it is in front has
  // its menu only after Electron handed the focus to the Dock and took it back.
  dock.opened(name);
  // show() also brings a minimized window back, and one that app.hide() hid.
  window.show();
  // OdooBar is not the app in front, so the window would open behind other apps.
  app.focus({ steal: true });
}
