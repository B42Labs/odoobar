import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
} from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FALLBACK_ICON } from './menu-bar';
import { ICONS, iconNames } from './menu-bar-ui';
import type { Messages } from './messages';
import type { SaveResult, Settings, SettingsInit, SettingsUi, SignOutResult } from './settings';
import { shortcutFor } from './shortcuts';

/**
 * The Electron side of SettingsUi: one window whose page edits the
 * configuration. It holds no decisions, settings.ts makes them and hears about
 * clicks and keys through `events`.
 */
export function createSettingsUi(events: () => Settings, messages: Messages): SettingsUi {
  // loadFile would encode characters such as % or [ differently, so the window loads this exact URL.
  const pageUrl = pathToFileURL(join(__dirname, '../renderer/settings.html')).href;
  const iconsUrl = pathToFileURL(ICONS).href + '/';
  const texts = messages.settings;
  let window: BrowserWindow | undefined;
  let quitting = false;
  /** The icon names, read on the first open. The build fixes them. */
  let icons: readonly string[] | undefined;

  // Without this, the 'close' listener below would ask about unsaved edits and keep OdooBar from quitting.
  app.on('before-quit', () => {
    quitting = true;
  });

  // The main frame shows whatever page a navigation brings in, so only its URL
  // tells the settings page apart from a page that got past will-navigate.
  const fromPage = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    window !== undefined && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === pageUrl;
  ipcMain.handle('settings:init', (event): SettingsInit => {
    if (!fromPage(event)) throw new Error('unexpected sender');
    // A page that loads anew, as the developer tools can make it, drops the edits and the recording of the page before.
    events().setDirty(false);
    events().cancelRecording();
    icons ??= iconNames();
    return { state: events().state(), iconsUrl, icons, fallbackIcon: FALLBACK_ICON };
  });
  ipcMain.handle('settings:save', (event, draft: unknown): SaveResult => {
    if (!fromPage(event)) throw new Error('unexpected sender');
    return events().save(draft);
  });
  ipcMain.handle('settings:sign-out', (event): Promise<SignOutResult> => {
    if (!fromPage(event)) throw new Error('unexpected sender');
    return events().signOut();
  });
  ipcMain.on('settings:dirty', (event, dirty: unknown) => {
    if (fromPage(event)) events().setDirty(dirty === true);
  });
  ipcMain.on('settings:record-start', (event) => {
    if (fromPage(event)) events().startRecording();
  });
  ipcMain.on('settings:record-stop', (event) => {
    if (fromPage(event)) events().cancelRecording();
  });

  const create = () => {
    const created = new BrowserWindow({
      width: 760,
      height: 600,
      minWidth: 640,
      minHeight: 400,
      fullscreenable: false,
      show: false,
      title: texts.title,
      webPreferences: { preload: join(__dirname, '../preload/settings.js') },
    });
    window = created;
    // A dropped link or file would replace the page with one that the preload
    // script serves as well, so that page could write config.json.
    created.webContents.on('will-navigate', (event) => event.preventDefault());
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.webContents.on('before-input-event', (event, input) => {
      if (events().keyPressed(input)) {
        // A recording takes every key, so neither the page nor Electron's default menu sees it.
        event.preventDefault();
      } else if (shortcutFor(input)?.kind === 'hide') {
        // ⌘W closes the settings as it hides the main window.
        event.preventDefault();
        created.close();
      } else if (
        input.type === 'keyDown' &&
        input.meta &&
        !input.control &&
        !input.alt &&
        input.key.toLowerCase() === 'r'
      ) {
        // The default menu would reload the page on ⌘R and ⇧⌘R and drop the unsaved edits without asking.
        event.preventDefault();
      }
    });
    // A click into another program ends a recording.
    created.on('blur', () => events().cancelRecording());
    created.on('close', (event) => {
      if (quitting) return;
      // settings.ts closes the window, after a question when there are unsaved edits.
      event.preventDefault();
      events().requestClose();
    });
    created.on('closed', () => {
      window = undefined;
      events().closed();
    });
    created.once('ready-to-show', () => {
      created.show();
      // Without a Dock icon, the window would open behind other apps.
      app.focus({ steal: true });
    });
    created.loadURL(pageUrl).catch((error: unknown) => {
      // Closed while loading.
      if (created.isDestroyed()) return;
      // A page that fails to load never shows. The next showWindow creates a new window.
      console.error('OdooBar could not load the settings:', error);
      created.destroy();
    });
  };

  /** Asks in a sheet of the window. The first button cancels, and true means the user chose the second. */
  const ask = async (options: Pick<MessageBoxOptions, 'message' | 'detail' | 'buttons'>): Promise<boolean> => {
    if (!window) return false;
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      defaultId: 0,
      cancelId: 0,
      ...options,
    });
    return response === 1;
  };

  return {
    showWindow() {
      if (!window) return create();
      // show() also brings a minimized window back, and one that app.hide() hid.
      window.show();
      app.focus({ steal: true });
    },
    closeWindow() {
      window?.destroy();
    },
    recorded(accelerator) {
      window?.webContents.send('settings:recorded', accelerator ?? null);
    },
    confirmSignOut() {
      return ask({
        message: texts.confirmSignOut.message,
        detail: texts.confirmSignOut.detail,
        buttons: [texts.cancel, texts.signOut],
      });
    },
    confirmDiscard() {
      return ask({ message: texts.discard.message, buttons: [texts.discard.keep, texts.discard.discard] });
    },
  };
}
