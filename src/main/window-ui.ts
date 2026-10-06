import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  WebContentsView,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Dock } from './dock';
import { showInFront } from './dock-ui';
import { shortcutFor } from './shortcuts';
import type { BarState, Desktop, WindowController, WindowUi } from './window';

/** The height of the app bar. app-bar.html uses the same value. */
const BAR_HEIGHT = 40;

/**
 * The session of every app view, so one login covers all apps. `persist:`
 * keeps it on disk, in Partitions/odoo below the user data directory.
 */
const PARTITION = 'persist:odoo';

/**
 * The Electron side of WindowUi: one window whose own page is the app bar,
 * with one view per app below the bar. It holds no decisions, window.ts makes
 * them and hears about clicks and keys through `events`.
 */
export function createWindowUi(events: () => WindowController, dock: Dock): WindowUi {
  const pageUrl = pathToFileURL(join(__dirname, '../renderer/app-bar.html')).href;
  const views = new Map<string, WebContentsView>();
  let window: BrowserWindow | undefined;
  let state: BarState | undefined;
  let shown: string | undefined;
  let quitting = false;
  const odoo = session.fromPartition(PARTITION);

  // Without this, the 'close' listener below would keep OdooBar from quitting.
  app.on('before-quit', () => {
    quitting = true;
  });

  // A page that a view reached on another origin, or a frame from one, gets no permission.
  // A redirect or a frame to an address that is not a web page skips 'will-navigate', and
  // Electron would hand it to macOS. It goes where a link to a new window goes instead.
  odoo.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission !== 'openExternal') return callback(events().grantsPermission(details.requestingUrl));
    callback(false);
    const id = [...views].find(([, view]) => view.webContents === contents)?.[0];
    const url = 'externalURL' in details ? details.externalURL : undefined;
    if (id !== undefined && url !== undefined) events().openLink(id, url);
  });
  // A check, such as navigator.permissions.query(), follows the same rule. Electron passes
  // no WebContents for some checks, so only the origin decides.
  odoo.setPermissionCheckHandler((_contents, _permission, requestingOrigin) =>
    events().grantsPermission(requestingOrigin),
  );
  // The default session holds only the app bar, which needs no permission.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const fromBar = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    window !== undefined && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === pageUrl;
  ipcMain.handle('app-bar:init', (event) => {
    if (!fromBar(event)) throw new Error('unexpected sender');
    return state;
  });
  ipcMain.on('app-bar:press', (event, id: unknown) => {
    if (fromBar(event) && typeof id === 'string') events().pressApp(id);
  });
  ipcMain.on('app-bar:settings', (event) => {
    if (fromBar(event)) events().openSettings();
  });

  const watchKeys = (contents: WebContents) => {
    contents.on('before-input-event', (event, input) => {
      const shortcut = shortcutFor(input);
      if (!shortcut) return;
      // Keeps the key from the page and from the app menu.
      event.preventDefault();
      events().handleShortcut(shortcut);
    });
  };

  // Keys go to the page the user sees, and its 'before-input-event' hears the shortcuts.
  const focusShown = () => {
    (views.get(shown ?? '')?.webContents ?? window?.webContents)?.focus();
  };

  // A click on one of these buttons moved the keys to the app bar. They go back to the page it acts on.
  ipcMain.on('app-bar:go', (event, direction: unknown) => {
    if (!fromBar(event) || (direction !== 'back' && direction !== 'forward')) return;
    events().go(direction);
    focusShown();
  });
  ipcMain.on('app-bar:reload', (event) => {
    if (!fromBar(event)) return;
    events().reloadActive();
    focusShown();
  });
  ipcMain.on('app-bar:update', (event) => {
    if (!fromBar(event)) return;
    events().openUpdate();
    focusShown();
  });

  const layout = () => {
    if (!window) return;
    const { width, height } = window.getContentBounds();
    const bounds = { x: 0, y: BAR_HEIGHT, width, height: Math.max(0, height - BAR_HEIGHT) };
    for (const view of views.values()) view.setBounds(bounds);
  };

  const ensureWindow = (): BrowserWindow => {
    if (window) return window;
    const created = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 480,
      minHeight: 320,
      fullscreenable: false,
      show: false,
      title: 'OdooBar',
      webPreferences: { preload: join(__dirname, '../preload/app-bar.js') },
    });
    window = created;
    // The app bar page never leaves its file, so no other page gets its preload script.
    created.webContents.on('will-navigate', (event) => event.preventDefault());
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    watchKeys(created.webContents);
    created.on('resize', layout);
    // A window that comes back from hiding takes the focus only now, not inside showWindow.
    created.on('focus', focusShown);
    created.on('close', (event) => {
      if (quitting) return;
      // The red button hides the window, so every view keeps its page.
      event.preventDefault();
      events().hide();
    });
    created.on('closed', () => {
      views.clear();
      window = undefined;
    });
    created.loadURL(pageUrl).catch((error: unknown) => {
      console.error('OdooBar could not load the app bar:', error);
    });
    return created;
  };

  return {
    openView(id, url) {
      // Electron has no push service, so a subscription always fails, and Odoo shows that in a
      // red box on every start. Without the Push API, Odoo does not try. It still shows its
      // notifications while OdooBar runs, since those need only the permission.
      const view = new WebContentsView({
        webPreferences: { partition: PARTITION, disableBlinkFeatures: 'PushMessaging' },
      });
      const contents = view.webContents;
      views.set(id, view);
      view.setVisible(false);
      ensureWindow().contentView.addChildView(view);
      layout();
      watchKeys(contents);
      contents.setWindowOpenHandler((details) => {
        events().openLink(id, details.url);
        return { action: 'deny' };
      });
      // A web page stays in the view, even on another origin. Any other address, such as
      // a dropped file, goes where a link to a new window goes, so mailto: still opens Mail.
      contents.on('will-navigate', (event) => {
        const protocol = URL.parse(event.url)?.protocol;
        if (protocol === 'http:' || protocol === 'https:') return;
        event.preventDefault();
        events().openLink(id, event.url);
      });
      // Odoo adds to the history on most clicks, and the answers of canGo mostly stay as they are.
      let reported = { back: false, forward: false };
      const reportHistory = () => {
        const history = contents.navigationHistory;
        const next = { back: history.canGoBack(), forward: history.canGoForward() };
        if (next.back === reported.back && next.forward === reported.forward) return;
        reported = next;
        events().historyChanged(id);
      };
      contents.on('did-frame-navigate', reportHistory);
      contents.on('did-navigate-in-page', reportHistory);
      contents.on('did-fail-load', (_event, _code, description, failedUrl, isMainFrame) => {
        // A page that did not load takes a place in the history as well.
        reportHistory();
        if (isMainFrame) events().loadFailed(id, failedUrl, description);
      });
      contents.once('destroyed', () => {
        // closeView has taken the view off the list by now. A page that closes itself has not.
        if (views.get(id) !== view) return;
        views.delete(id);
        window?.contentView.removeChildView(view);
        events().viewClosed(id);
      });
      // 'did-fail-load' reports a failed load.
      contents.loadURL(url).catch(() => {});
    },
    closeView(id) {
      const view = views.get(id);
      if (!view) return;
      views.delete(id);
      window?.contentView.removeChildView(view);
      view.webContents.close();
    },
    loadView(id, url) {
      // 'did-fail-load' reports a failed load.
      views.get(id)?.webContents.loadURL(url).catch(() => {});
    },
    reloadView(id) {
      views.get(id)?.webContents.reload();
    },
    canGo(id, direction) {
      const history = views.get(id)?.webContents.navigationHistory;
      if (!history) return false;
      return direction === 'back' ? history.canGoBack() : history.canGoForward();
    },
    go(id, direction) {
      const history = views.get(id)?.webContents.navigationHistory;
      if (direction === 'back') history?.goBack();
      else history?.goForward();
    },
    showView(id) {
      shown = id;
      for (const [viewId, view] of views) view.setVisible(viewId === id);
      focusShown();
    },
    renderBar(next) {
      state = next;
      window?.webContents.send('app-bar:state', next);
    },
    showWindow() {
      showInFront(dock, 'window', ensureWindow());
    },
    hideWindow() {
      window?.hide();
      // Hands the keyboard back to the app that was in front before OdooBar.
      app.hide();
      dock.closed('window');
    },
    isWindowFocused() {
      return window?.isFocused() ?? false;
    },
    windowBounds() {
      return window?.getBounds();
    },
    clearProfile() {
      return odoo.clearData();
    },
  };
}

/**
 * Fetches an address with the cookies of the Odoo pages and returns the JSON
 * document of the answer. An answer that holds none, such as the login page
 * that Odoo redirects to or an error page, gives undefined. An address that
 * does not answer within ten seconds fails.
 */
export async function fetchOdooJson(url: string): Promise<unknown> {
  return fetchSessionJson(session.fromPartition(PARTITION), url, 'application/json');
}

/**
 * Fetches an address through a session, uncached, and returns the JSON
 * document of the answer, or undefined for an answer that holds none. An
 * address that does not answer within ten seconds fails.
 */
export async function fetchSessionJson(from: Session, url: string, accept: string): Promise<unknown> {
  const response = await from.fetch(url, {
    headers: { accept },
    // Every caller needs the current answer: Odoo before 19 lets a browser keep its menus for a year, which would
    // outlast a new app and a change of the user, and GitHub lets a client keep the latest release for a minute.
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) return undefined;
  return response.json();
}

/** The Electron side of Desktop. main.ts hands in the way to the settings window. */
export function createDesktop(openSettings: () => void): Desktop {
  return {
    openExternal(url) {
      shell.openExternal(url).catch((error: unknown) => {
        console.error(`OdooBar could not open ${url}:`, error);
      });
    },
    openSettings,
  };
}
