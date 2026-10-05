import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Messages } from './messages';
import type { FirstStartTexts, StartupUi, SubmitResult } from './startup';

function askBaseUrl(messages: Messages, submit: (input: string) => SubmitResult): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let saved = false;
    const window = new BrowserWindow({
      width: 460,
      height: 240,
      useContentSize: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: 'OdooBar',
      webPreferences: { preload: join(__dirname, '../preload/first-start.js') },
    });
    // A dropped link or file would replace the prompt with a page that the
    // preload script serves as well, so that page could write config.json.
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // The main frame shows whatever page a navigation brings in, so only its URL
    // tells the prompt apart from a page that got past will-navigate. loadFile
    // would encode characters such as % or [ differently, so the window loads
    // this exact URL.
    const pageUrl = pathToFileURL(join(__dirname, '../renderer/first-start.html')).href;
    const fromPrompt = (event: IpcMainInvokeEvent) =>
      event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === pageUrl;
    ipcMain.handle('first-start:init', (event): FirstStartTexts => {
      if (!fromPrompt(event)) throw new Error('unexpected sender');
      return { ...messages.firstStart, quit: messages.quit };
    });
    ipcMain.handle('first-start:submit', (event, input: unknown): SubmitResult => {
      if (!fromPrompt(event)) throw new Error('unexpected sender');
      const result = submit(typeof input === 'string' ? input : '');
      if (result.ok) {
        saved = true;
        window.close();
      }
      return result;
    });
    const reveal = () => {
      window.show();
      // Without a Dock icon, the window would open behind other apps.
      app.focus({ steal: true });
    };
    window.once('ready-to-show', reveal);
    // Finder reopens a running OdooBar, and macOS brings the prompt forward. A
    // process started directly quits on the single-instance lock instead, so
    // the prompt, perhaps behind other windows by now, comes forward here.
    app.on('second-instance', reveal);
    window.once('closed', () => {
      app.off('second-instance', reveal);
      ipcMain.removeHandler('first-start:init');
      ipcMain.removeHandler('first-start:submit');
      resolve(saved);
    });
    window.loadURL(pageUrl).catch((error: unknown) => {
      // Closed while loading: the 'closed' listener has already resolved.
      if (window.isDestroyed()) return;
      // A page that fails to load never shows, and OdooBar would run without a prompt.
      reject(error);
      window.destroy();
    });
  });
}

/** The Electron side of StartupUi. It holds no decisions, startup.ts makes them. */
export function createStartupUi(messages: Messages): StartupUi {
  return {
    askBaseUrl: (submit) => askBaseUrl(messages, submit),
    async confirmReset(detail) {
      app.focus({ steal: true });
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        message: messages.invalidConfig.message,
        detail,
        buttons: [messages.quit, messages.invalidConfig.reset],
        defaultId: 0,
        cancelId: 0,
      });
      return response === 1;
    },
    async showFatal(message, detail) {
      app.focus({ steal: true });
      await dialog.showMessageBox({ type: 'error', message, detail, buttons: [messages.quit] });
    },
  };
}
