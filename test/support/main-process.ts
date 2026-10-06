import { spawn, type ChildProcess } from 'node:child_process';
import { evaluate, eventually, waitUntil, type Page } from './devtools';

export interface InspectedApp {
  readonly app: ChildProcess;
  /** The main process as a DevTools target. Pass it to `evaluate` from devtools.ts. */
  readonly main: Page;
}

/**
 * Launches like `launch` in app-process.ts, with the Node.js inspector of the
 * main process on a free port. Node.js prints the address of the inspector to
 * stderr.
 */
export async function launchInspected(executable: string, args: string[], userDataDir: string): Promise<InspectedApp> {
  const app = spawn(executable, ['--inspect=0', ...args, '--user-data-dir=' + userDataDir], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  app.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const main = (address: string): Page => ({ url: 'the main process', webSocketDebuggerUrl: address });
  try {
    const address = await waitUntil(
      () => /Debugger listening on (ws:\/\/\S+)/.exec(stderr)?.[1],
      30_000,
      'the inspector of the main process',
    );
    // The inspector answers before Electron has loaded main.js, and in the
    // development app before Electron's default app has made way for OdooBar.
    await waitUntil(
      async () =>
        (await evaluate(
          main(address),
          `typeof process.mainModule?.require === 'function' && !process.mainModule.require('electron').app.getAppPath().endsWith('default_app.asar')`,
        )) === true
          ? true
          : undefined,
      30_000,
      'the main module',
    );
    return { app, main: main(address) };
  } catch (error) {
    // No invisible app may outlive a failed launch.
    app.kill('SIGKILL');
    throw error;
  }
}

const electron = `process.mainModule.require('electron')`;

// process.mainModule is Electron's own module, so the path is absolute.
const mainModule = (file: string) =>
  `process.mainModule.require(process.mainModule.require('node:path').join(${electron}.app.getAppPath(), 'out/src/main/${file}'))`;

/**
 * Replaces shell.openExternal in the main process, so a test opens no
 * browser. `desktopCalls` returns what it was called with.
 */
export async function recordDesktopCalls(main: Page): Promise<void> {
  await evaluate(
    main,
    `globalThis.desktopCalls = [];
    ${electron}.shell.openExternal = async (url) => { globalThis.desktopCalls.push(['openExternal', url]); };
    true`,
  );
}

export async function desktopCalls(main: Page): Promise<[string, string][]> {
  return (await evaluate(main, 'globalThis.desktopCalls')) as [string, string][];
}

export type Modifier = 'shift' | 'control' | 'alt' | 'meta';

/**
 * Presses a key with these modifiers in the page whose address ends in
 * `urlSuffix`. The key goes through 'before-input-event', which a key sent
 * over the DevTools protocol of the page does not. Electron reports its `code`
 * by the position on the US layout, as for a real key: `D` arrives as KeyD.
 * The inspector may run the evaluation inside a callback of macOS, such as
 * one for a window that another covers. The timeout lets the key arrive from
 * the event loop instead, as a real key does, since a window that closes
 * inside such a callback can crash Electron.
 */
export async function pressKey(
  main: Page,
  urlSuffix: string,
  keyCode: string,
  modifiers: readonly Modifier[],
): Promise<void> {
  const event = (type: string) => JSON.stringify({ type, keyCode, modifiers });
  await evaluate(
    main,
    `(() => {
      const contents = ${electron}.webContents.getAllWebContents().find((candidate) => candidate.getURL().endsWith(${JSON.stringify(urlSuffix)}));
      if (!contents) throw new Error('no page ends in ' + ${JSON.stringify(urlSuffix)});
      setTimeout(() => {
        contents.sendInputEvent(${event('keyDown')});
        contents.sendInputEvent(${event('keyUp')});
      }, 0);
      return true;
    })()`,
  );
}

/** Presses ⌘ with a key in the page whose address ends in `urlSuffix`, as pressKey does. */
export function pressCommand(main: Page, urlSuffix: string, key: string): Promise<void> {
  return pressKey(main, urlSuffix, key, ['meta']);
}

/** Moves the keys to the page whose address ends in `urlSuffix`, as a click into it does. */
export async function focusPage(main: Page, urlSuffix: string): Promise<void> {
  await evaluate(
    main,
    `${electron}.webContents.getAllWebContents().find((candidate) => candidate.getURL().endsWith(${JSON.stringify(urlSuffix)})).focus(); true`,
  );
}

/** Closes the window the way its red button does. */
export async function closeWindow(main: Page): Promise<void> {
  await evaluate(main, `${electron}.BrowserWindow.getAllWindows()[0].close(); true`);
}

/** Gives the content area of the window, the app bar included, this size. */
export async function resizeWindow(main: Page, width: number, height: number): Promise<void> {
  await evaluate(main, `${electron}.BrowserWindow.getAllWindows()[0].setContentSize(${width}, ${height}); true`);
}

const windowOf = (urlSuffix: string) =>
  `${electron}.BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith(${JSON.stringify(urlSuffix)}))`;

export interface Place {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where the window is whose page ends in `urlSuffix`, and the part of its screen that windows may use. */
export async function placeOf(main: Page, urlSuffix: string): Promise<{ bounds: Place; workArea: Place }> {
  return (await evaluate(
    main,
    `(() => {
      const bounds = ${windowOf(urlSuffix)}.getBounds();
      return { bounds, workArea: ${electron}.screen.getDisplayMatching(bounds).workArea };
    })()`,
  )) as { bounds: Place; workArea: Place };
}

/** Moves the window whose page ends in `urlSuffix`, as a drag of its title bar and its edges does. */
export async function moveWindow(main: Page, urlSuffix: string, place: Place): Promise<void> {
  await evaluate(main, `${windowOf(urlSuffix)}.setBounds(${JSON.stringify(place)}); true`);
}

/**
 * Calls `method` of the settings window from the event loop, as pressKey
 * presses a key. closeWindow, resizeWindow, blurWindow, and isWindowFocused
 * take the first window, which may be either window once the settings are open.
 */
async function callSettings(main: Page, method: 'close' | 'blur'): Promise<void> {
  await evaluate(
    main,
    `(() => {
      const window = ${electron}.BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/renderer/settings.html'));
      if (!window) throw new Error('no window shows the settings');
      setTimeout(() => window.${method}(), 0);
      return true;
    })()`,
  );
}

/** Closes the settings window the way its red button does. */
export function closeSettings(main: Page): Promise<void> {
  return callSettings(main, 'close');
}

/** Takes the keys from the settings window, as a click into another program does. */
export function blurSettings(main: Page): Promise<void> {
  return callSettings(main, 'blur');
}

/**
 * Keeps the WindowController that shows the window next, so a test can call
 * it without a control. A start may have shown the window before this call,
 * so 'activate' shows it once more, as a click on the Dock icon does. Until
 * that start has a controller, nobody listens to the event.
 */
export async function captureController(main: Page): Promise<void> {
  await evaluate(
    main,
    `(() => {
      const { WindowController } = ${mainModule('window.js')};
      const show = WindowController.prototype.show;
      WindowController.prototype.show = function () {
        globalThis.controller = this;
        return show.call(this);
      };
      setTimeout(() => ${electron}.app.emit('activate'), 0);
      return true;
    })()`,
  );
}

/** Signs out the way the settings window does after its question. Resolves once the profile is cleared. */
export async function signOut(main: Page): Promise<void> {
  await evaluate(main, 'globalThis.controller.signOut().then(() => true)');
}

/**
 * Keeps the ConfigStore that saves next, so a test can save a configuration
 * without the settings window. Call it before the first-start prompt saves.
 */
export async function captureStore(main: Page): Promise<void> {
  await evaluate(
    main,
    `(() => {
      const { ConfigStore } = ${mainModule('config-store.js')};
      const save = ConfigStore.prototype.save;
      ConfigStore.prototype.save = function (config) {
        globalThis.store = this;
        return save.call(this, config);
      };
      return true;
    })()`,
  );
}

/** Saves a configuration, which every listener of the store hears about. */
export async function saveConfig(main: Page, config: object): Promise<void> {
  await evaluate(main, `globalThis.store.save(${JSON.stringify(config)}); true`);
}

/**
 * Keeps the callback of every global shortcut that Electron registers from
 * now on, and the GlobalShortcuts that takes a configuration next, so a test
 * can press a shortcut without the keyboard and read the states the settings
 * window shows. Call it before the first-start prompt saves.
 */
export async function recordShortcuts(main: Page): Promise<void> {
  await evaluate(
    main,
    `(() => {
      const { globalShortcut } = ${electron};
      globalThis.shortcutPresses = new Map();
      globalThis.refusedShortcuts = new Set();
      const register = globalShortcut.register;
      globalShortcut.register = function (accelerator, press) {
        if (globalThis.refusedShortcuts.has(accelerator)) return false;
        const registered = register.call(this, accelerator, press);
        if (registered) globalThis.shortcutPresses.set(accelerator, press);
        return registered;
      };
      const unregisterAll = globalShortcut.unregisterAll;
      globalShortcut.unregisterAll = function () {
        globalThis.shortcutPresses.clear();
        return unregisterAll.call(this);
      };
      const { GlobalShortcuts } = ${mainModule('global-shortcuts.js')};
      const setConfig = GlobalShortcuts.prototype.setConfig;
      GlobalShortcuts.prototype.setConfig = function (config) {
        globalThis.shortcuts = this;
        return setConfig.call(this, config);
      };
      return true;
    })()`,
  );
}

/**
 * Makes Electron refuse this global shortcut from now on, as it does one that
 * the system does not grant. Call it after recordShortcuts.
 */
export async function refuseShortcut(main: Page, accelerator: string): Promise<void> {
  await evaluate(main, `globalThis.refusedShortcuts.add(${JSON.stringify(accelerator)}); true`);
}

/** Presses a global shortcut the way macOS reports a press. Rejects for a shortcut that OdooBar does not hold in this spelling. */
export async function pressShortcut(main: Page, accelerator: string): Promise<void> {
  await evaluate(main, `globalThis.shortcutPresses.get(${JSON.stringify(accelerator)})(); true`);
}

export interface ShortcutState {
  readonly id: string;
  readonly shortcut: string;
  readonly status: string;
}

/** What GlobalShortcuts tells the settings window about each app with a shortcut. */
export async function shortcutStates(main: Page): Promise<ShortcutState[]> {
  return (await evaluate(main, 'globalThis.shortcuts.states()')) as ShortcutState[];
}

/** Whether OdooBar holds this global shortcut, in any spelling, once the app is ready. */
export async function holdsShortcut(main: Page, accelerator: string): Promise<boolean> {
  return (await evaluate(
    main,
    `${electron}.app.whenReady().then(() => ${electron}.globalShortcut.isRegistered(${JSON.stringify(accelerator)}))`,
  )) as boolean;
}

/**
 * Keeps every menu bar icon that gets its tooltip from now on: menu-bar-ui.ts
 * sets exactly one on each Tray, and the Tray export of electron cannot be
 * replaced. It also keeps the menu of an icon instead of opening it, since an
 * open menu waits for the mouse. Call it before the icons appear: during the
 * first-start prompt.
 */
export async function recordMenuBar(main: Page): Promise<void> {
  await evaluate(
    main,
    `(() => {
      const { Tray } = ${electron};
      globalThis.trays = [];
      const setToolTip = Tray.prototype.setToolTip;
      Tray.prototype.setToolTip = function (text) {
        this.toolTip = text;
        globalThis.trays.push(this);
        return setToolTip.call(this, text);
      };
      Tray.prototype.popUpContextMenu = function (menu) {
        globalThis.trayMenu = menu;
      };
      return true;
    })()`,
  );
}

const liveTrays = `globalThis.trays.filter((tray) => !tray.isDestroyed())`;
const trayOf = (name: string) => `${liveTrays}.find((tray) => tray.toolTip === ${JSON.stringify(name)})`;

/**
 * The tooltips of the icons in the menu bar, from left to right. macOS places
 * a new icon a moment after its creation, and until then every new icon
 * reports the same position, so this waits until no two icons share one.
 */
export function menuBarIcons(main: Page): Promise<string[]> {
  return waitUntil(
    async () => {
      const icons = (await evaluate(
        main,
        `${liveTrays}.map((tray) => [tray.toolTip, tray.getBounds().x])`,
      )) as [string, number][];
      if (new Set(icons.map(([, x]) => x)).size < icons.length) return undefined;
      return icons.sort(([, a], [, b]) => a - b).map(([name]) => name);
    },
    5_000,
    'macOS to place the menu bar icons',
  );
}

/**
 * Whether every icon in the menu bar takes the second of two quick clicks as a
 * click. clickIcon emits its click past the double-click detection of macOS.
 */
export async function iconsIgnoreDoubleClicks(main: Page): Promise<boolean> {
  return (await evaluate(main, `${liveTrays}.every((tray) => tray.getIgnoreDoubleClickEvents())`)) as boolean;
}

/** Clicks the icon with this tooltip the way the left mouse button does. */
export async function clickIcon(main: Page, name: string): Promise<void> {
  await evaluate(main, `${trayOf(name)}.emit('click', { ctrlKey: false }); true`);
}

export interface MenuEntry {
  readonly label: string;
  readonly enabled: boolean;
}

/**
 * Clicks the icon with this tooltip the way the right mouse button does, or
 * the left one with Control held, and returns the entries of the menu that opens.
 */
export async function openIconMenu(
  main: Page,
  name: string,
  click: 'right-click' | 'control-click' = 'right-click',
): Promise<MenuEntry[]> {
  const emit = click === 'right-click' ? `emit('right-click')` : `emit('click', { ctrlKey: true })`;
  return (await evaluate(
    main,
    `globalThis.trayMenu = undefined; ${trayOf(name)}.${emit}; globalThis.trayMenu.items.map(({ label, enabled }) => ({ label, enabled }))`,
  )) as MenuEntry[];
}

/** Picks an entry of the menu that openIconMenu opened last. The timeout lets the evaluation answer before "Quit" ends the process. */
export async function chooseMenuEntry(main: Page, index: number): Promise<void> {
  await evaluate(main, `setTimeout(() => globalThis.trayMenu.items[${index}].click(), 0); true`);
}

const appMenuItems = `${electron}.Menu.getApplicationMenu().items`;

/** The labels of the app menu, from left to right. macOS shows the name of the app bundle for the first. */
export async function appMenuLabels(main: Page): Promise<string[]> {
  return (await evaluate(main, `${appMenuItems}.map(({ label }) => label)`)) as string[];
}

/** The entries of the first menu of the app menu, the one with the name of the app, without the separators. */
export async function appMenuEntries(main: Page): Promise<MenuEntry[]> {
  return (await evaluate(
    main,
    `${appMenuItems}[0].submenu.items.filter(({ type }) => type !== 'separator').map(({ label, enabled }) => ({ label, enabled }))`,
  )) as MenuEntry[];
}

/** Picks the entry with this label in the first menu of the app menu. The timeout lets the evaluation answer first. */
export async function chooseAppMenuEntry(main: Page, label: string): Promise<void> {
  await evaluate(
    main,
    `(() => {
      const entry = ${appMenuItems}[0].submenu.items.find((candidate) => candidate.label === ${JSON.stringify(label)});
      if (!entry) throw new Error('no entry ' + ${JSON.stringify(label)});
      setTimeout(() => entry.click(), 0);
      return true;
    })()`,
  );
}

/**
 * Replaces dialog.showMessageBox in the main process with one that answers
 * every question at once with the button at `response`. `dialogs` returns the
 * message of every question since the first call.
 */
export async function answerDialogs(main: Page, response: number): Promise<void> {
  await evaluate(
    main,
    `globalThis.dialogs ??= [];
    ${electron}.dialog.showMessageBox = async (...args) => {
      // The options come last, after the window that the question belongs to.
      globalThis.dialogs.push(args[args.length - 1]);
      return { response: ${response}, checkboxChecked: false };
    };
    true`,
  );
}

export async function dialogs(main: Page): Promise<string[]> {
  return (await evaluate(main, '(globalThis.dialogs ?? []).map((options) => options.message)')) as string[];
}

export interface DialogTexts {
  readonly message: string;
  readonly detail: string | undefined;
  readonly buttons: string[];
}

/** The texts of the question that answerDialogs answered last. */
export async function lastDialog(main: Page): Promise<DialogTexts | undefined> {
  return (await evaluate(
    main,
    `(({ message, detail, buttons } = {}) => message === undefined ? undefined : { message, detail, buttons })((globalThis.dialogs ?? []).at(-1))`,
  )) as DialogTexts | undefined;
}

/**
 * Makes this run count as the installed app, whose launchAtLogin sets the
 * login item of macOS, and keeps every login item setting from now on instead
 * of passing it to macOS. `loginItemSettings` returns them.
 */
export async function recordLoginItem(main: Page): Promise<void> {
  await evaluate(
    main,
    `(() => {
      const { app } = ${electron};
      let openAtLogin = false;
      globalThis.loginItemSettings = [];
      // The recorders come first, so the login item of the system stays untouched.
      app.getLoginItemSettings = () => ({ openAtLogin, wasOpenedAtLogin: false });
      app.setLoginItemSettings = (settings) => {
        openAtLogin = settings.openAtLogin;
        globalThis.loginItemSettings.push(settings);
      };
      Object.defineProperty(app, 'isPackaged', { value: true });
      const hasSwitch = app.commandLine.hasSwitch;
      app.commandLine.hasSwitch = (name) => name !== 'user-data-dir' && hasSwitch.call(app.commandLine, name);
      return true;
    })()`,
  );
}

export async function loginItemSettings(main: Page): Promise<{ openAtLogin: boolean }[]> {
  return (await evaluate(main, 'globalThis.loginItemSettings')) as { openAtLogin: boolean }[];
}

/**
 * Takes the keys from the window, as a click into another program does. A
 * window that has just brought the Dock icon comes back to the front once
 * more when the icon is there, so this repeats until the window stays behind.
 */
export async function blurWindow(main: Page): Promise<void> {
  const window = `${electron}.BrowserWindow.getAllWindows()[0]`;
  await eventually(async () => {
    if ((await evaluate(main, `${window}.isFocused()`)) === false) return true;
    await evaluate(main, `${window}.blur(); true`);
    return false;
  }, 'the window to lose the keys');
}

export async function isWindowFocused(main: Page): Promise<boolean> {
  return (await evaluate(main, `${electron}.BrowserWindow.getAllWindows()[0].isFocused()`)) as boolean;
}

export interface IconImage {
  readonly size: { readonly width: number; readonly height: number };
  readonly scaleFactors: number[];
  readonly template: boolean;
  /** The image at scale factor 1 as a PNG file, in base64. */
  readonly png: string;
}

/** The menu bar image that iconImage of menu-bar-ui.js gives for each name, once the app is ready. */
export async function iconImages(main: Page, names: string[]): Promise<IconImage[]> {
  return (await evaluate(
    main,
    `${electron}.app.whenReady().then(() => {
      const { iconImage } = ${mainModule('menu-bar-ui.js')};
      return ${JSON.stringify(names)}.map((name) => {
        const image = iconImage(name);
        return {
          size: image.getSize(),
          scaleFactors: image.getScaleFactors(),
          template: image.isTemplateImage(),
          png: image.toPNG().toString('base64'),
        };
      });
    })`,
  )) as IconImage[];
}
