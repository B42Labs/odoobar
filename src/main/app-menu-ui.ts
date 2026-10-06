import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { aboutDialog, appMenu, REPOSITORY_URL } from './app-menu';
import type { Messages } from './messages';

async function showAbout(messages: Messages): Promise<void> {
  const options = { ...aboutDialog(messages, app.getVersion()), defaultId: 0, cancelId: 0 };
  // A dialog without a window would block OdooBar until it closes, so it is a sheet of the window in front.
  const window = BrowserWindow.getFocusedWindow();
  const { response } = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));
  if (response === 1) await shell.openExternal(REPOSITORY_URL);
}

/**
 * The Electron side of the app menu: makes it the menu of OdooBar in place of
 * the one before. `openSettings` is the way to the settings window, once
 * OdooBar has a configuration.
 */
export function showAppMenu(messages: Messages, openSettings?: () => void): void {
  const about = () => {
    showAbout(messages).catch((error: unknown) => {
      console.error('OdooBar could not show the About dialog:', error);
    });
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenu(messages, { about, settings: openSettings })));
}
