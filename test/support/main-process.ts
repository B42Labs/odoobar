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
      // process.mainModule is Electron's own module, so the path is absolute.
      const { join } = process.mainModule.require('node:path');
      const { WindowController } = process.mainModule.require(join(${electron}.app.getAppPath(), 'out/src/main/window.js'));
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
