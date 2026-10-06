import { spawn, type ChildProcess } from 'node:child_process';
import { evaluate, waitUntil, type Page } from './devtools';

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
    // The inspector answers before Electron has loaded main.js.
    await waitUntil(
      async () =>
        (await evaluate(main(address), `typeof process.mainModule?.require === 'function'`)) === true ? true : undefined,
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
 * Replaces shell.openExternal and shell.showItemInFolder in the main process,
 * so a test opens neither the browser nor Finder. `desktopCalls` returns what
 * they were called with.
 */
export async function recordDesktopCalls(main: Page): Promise<void> {
  await evaluate(
    main,
    `globalThis.desktopCalls = [];
    ${electron}.shell.openExternal = async (url) => { globalThis.desktopCalls.push(['openExternal', url]); };
    ${electron}.shell.showItemInFolder = (path) => { globalThis.desktopCalls.push(['showItemInFolder', path]); };
    true`,
  );
}

export async function desktopCalls(main: Page): Promise<[string, string][]> {
  return (await evaluate(main, 'globalThis.desktopCalls')) as [string, string][];
}

/**
 * Presses ⌘ with a key in the page whose address ends in `urlSuffix`. The key
 * goes through 'before-input-event', which a key sent over the DevTools
 * protocol of the page does not.
 */
export async function pressCommand(main: Page, urlSuffix: string, key: string): Promise<void> {
  const event = (type: string) => JSON.stringify({ type, keyCode: key, modifiers: ['meta'] });
  await evaluate(
    main,
    `(() => {
      const contents = ${electron}.webContents.getAllWebContents().find((candidate) => candidate.getURL().endsWith(${JSON.stringify(urlSuffix)}));
      if (!contents) throw new Error('no page ends in ' + ${JSON.stringify(urlSuffix)});
      contents.sendInputEvent(${event('keyDown')});
      contents.sendInputEvent(${event('keyUp')});
      return true;
    })()`,
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

/**
 * Keeps the WindowController that shows the window next, so a test can call
 * what no control reaches yet. Call it before the window first shows.
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
      return true;
    })()`,
  );
}

/** Signs out the way the settings window will. Resolves once the profile is cleared. */
export async function signOut(main: Page): Promise<void> {
  await evaluate(main, 'globalThis.controller.signOut().then(() => true)');
}

/**
 * Keeps the ConfigStore that saves next, so a test can save a configuration
 * the way the settings window will. Call it before the first-start prompt
 * saves.
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
 * window will show. Call it before the first-start prompt saves.
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

/** Takes the keys from the window, as a click into another program does. */
export async function blurWindow(main: Page): Promise<void> {
  await evaluate(main, `${electron}.BrowserWindow.getAllWindows()[0].blur(); true`);
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
