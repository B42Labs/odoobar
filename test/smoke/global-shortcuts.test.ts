import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import {
  isRunning,
  macOnly,
  makeUserDataDir,
  projectRoot,
  removeUserDataDir,
  stop,
  writeConfig,
} from '../support/app-process';
import {
  evaluate,
  eventually,
  loadedPage,
  readBar,
  waitForBar,
  waitForPage,
  waitForPrompt,
  type Page,
} from '../support/devtools';
import {
  blurWindow,
  captureStore,
  holdsShortcut,
  isWindowFocused,
  launchInspected,
  pressShortcut,
  recordShortcuts,
  refuseShortcut,
  saveConfig,
  shortcutStates,
  windowCount,
} from '../support/main-process';
import { startOdooServer, type OdooServer } from '../support/odoo-server';

let electronBinary = '';

// In plain Node.js, require('electron') returns the binary path and downloads
// the binary on first use. The hook keeps that download out of the test timeout.
before(() => {
  if (process.platform === 'darwin') electronBinary = require('electron');
});

// No test sends a real key, and these are unlikely to be a shortcut of another program.
const HOME = 'Control+Alt+Shift+F13';
const TIMESHEETS = 'Control+Alt+Shift+F14';

interface Running {
  readonly server: OdooServer;
  readonly app: ChildProcess;
  readonly main: Page;
  readonly port: number;
  readonly bar: Page;
  /** Saves Home and Timesheets with these shortcuts, followed by `more`. */
  readonly save: (home: string, timesheets: string, more?: object[]) => Promise<void>;
}

/**
 * Runs a first start of OdooBar against a fresh OdooServer and passes
 * everything to `run` once the window shows Home. A first start seeds Home
 * and Timesheets, neither with a shortcut. The test helpers hook into the
 * main process while the prompt waits, before the shortcuts exist.
 */
async function withShortcuts(run: (running: Running) => Promise<void>): Promise<void> {
  const server = await startOdooServer();
  const userDataDir = makeUserDataDir();
  let app: ChildProcess | undefined;
  try {
    const inspected = await launchInspected(
      electronBinary,
      [projectRoot, '--remote-debugging-port=0', '--lang=en'],
      userDataDir,
    );
    app = inspected.app;
    const { main } = inspected;
    await captureStore(main);
    await recordShortcuts(main);
    const { port, page } = await waitForPrompt(userDataDir);
    await evaluate(
      page,
      `document.getElementById('base-url').value = ${JSON.stringify(server.baseUrl)}; document.getElementById('form').requestSubmit(); true`,
    );
    const bar = await waitForBar(port);
    await waitForPage(port, '/odoo', 5_000);
    const entry = (id: string, name: string, url: string, shortcut: string) => ({
      id,
      name,
      url,
      icon: '',
      shortcut,
      menuBar: false,
    });
    const save = (home: string, timesheets: string, more: object[] = []) =>
      saveConfig(main, {
        baseUrl: server.baseUrl,
        launchAtLogin: false,
        apps: [
          entry('home', 'Home', '/odoo', home),
          entry('timesheets', 'Timesheets', '/odoo/timesheets', timesheets),
          ...more,
        ],
      });
    await run({ server, app, main, port, bar, save });
  } finally {
    if (app) await stop(app);
    await server.close();
    removeUserDataDir(userDataDir);
  }
}

async function activeOf(bar: Page): Promise<string | undefined> {
  return (await readBar(bar)).apps.find((app) => app.active)?.id;
}

test('a first start registers no shortcut, since no seeded app has one', macOnly, async () => {
  await withShortcuts(async ({ main }) => {
    assert.deepEqual(await shortcutStates(main), []);
    assert.equal(await holdsShortcut(main, HOME), false);
  });
});

test('a global shortcut shows its app, and a press while that app is in front hides the window', macOnly, async () => {
  await withShortcuts(async ({ server, app, main, port, bar, save }) => {
    await save(HOME, TIMESHEETS);
    assert.deepEqual(await shortcutStates(main), [
      { id: 'home', shortcut: HOME, status: 'registered' },
      { id: 'timesheets', shortcut: TIMESHEETS, status: 'registered' },
    ]);
    assert.equal(await holdsShortcut(main, HOME), true);
    assert.equal(await holdsShortcut(main, TIMESHEETS), true);

    const focused = () => isWindowFocused(main);
    const visible = async () => (await readBar(bar)).visible;
    await eventually(focused, 'the window to take the keys');

    await pressShortcut(main, TIMESHEETS);
    await loadedPage(port, '/odoo/timesheets');
    await eventually(async () => (await activeOf(bar)) === 'timesheets', 'Timesheets to be active');
    assert.equal(await visible(), true);
    await eventually(focused, 'the window to keep the keys');

    await pressShortcut(main, TIMESHEETS);
    await eventually(async () => !(await visible()), 'the window to hide');
    assert.ok(isRunning(app));

    await pressShortcut(main, HOME);
    await eventually(visible, 'the window to come back');
    await eventually(async () => (await activeOf(bar)) === 'home', 'Home to be active');
    await eventually(focused, 'the window to take the keys again');

    await blurWindow(main);
    await eventually(async () => !(await focused()), 'the window to lose the keys');
    await pressShortcut(main, HOME);
    await eventually(focused, 'the window to come to the front');
    assert.equal(await visible(), true);
    assert.deepEqual(server.requests, ['/odoo', '/odoo/timesheets']);
  });
});

test('a saved configuration replaces the shortcuts', macOnly, async () => {
  await withShortcuts(async ({ main, bar, save }) => {
    await save(HOME, '');
    assert.deepEqual(await shortcutStates(main), [{ id: 'home', shortcut: HOME, status: 'registered' }]);
    assert.equal(await holdsShortcut(main, HOME), true);
    assert.equal(await holdsShortcut(main, TIMESHEETS), false);

    await save('', HOME);
    assert.deepEqual(await shortcutStates(main), [{ id: 'timesheets', shortcut: HOME, status: 'registered' }]);
    await pressShortcut(main, HOME);
    await eventually(async () => (await activeOf(bar)) === 'timesheets', 'Timesheets to be active');

    await save('', '');
    assert.deepEqual(await shortcutStates(main), []);
    assert.equal(await holdsShortcut(main, HOME), false);
    await assert.rejects(pressShortcut(main, HOME));
  });
});

test('a shortcut that is no accelerator or that an earlier app has is reported, and the others work', macOnly, async () => {
  await withShortcuts(async ({ main, bar, save }) => {
    const app = (id: string, name: string, shortcut: string) => ({ id, name, url: `/odoo/${id}`, shortcut });
    await save('Contrl+Alt+Shift+F13', TIMESHEETS, [
      // The same keys as Timesheets in another spelling: Electron refuses them.
      app('twin', 'Twin', 'shift+option+ctrl+f14'),
      // Electron throws for a text without a key it knows.
      app('unknown-key', 'Unknown key', 'Control+Alt+nosuchkey'),
      app('umlaut', 'Umlaut', 'Control+Alt+ä'),
    ]);
    assert.deepEqual(await shortcutStates(main), [
      { id: 'home', shortcut: 'Contrl+Alt+Shift+F13', status: 'invalid' },
      { id: 'timesheets', shortcut: TIMESHEETS, status: 'registered' },
      { id: 'twin', shortcut: 'shift+option+ctrl+f14', status: 'duplicate' },
      { id: 'unknown-key', shortcut: 'Control+Alt+nosuchkey', status: 'invalid' },
      { id: 'umlaut', shortcut: 'Control+Alt+ä', status: 'invalid' },
    ]);
    // Electron would have taken the misspelled modifier as no modifier at all.
    assert.equal(await holdsShortcut(main, 'Alt+Shift+F13'), false);
    assert.equal(await holdsShortcut(main, HOME), false);

    await pressShortcut(main, TIMESHEETS);
    await eventually(async () => (await activeOf(bar)) === 'timesheets', 'Timesheets to be active');
  });
});

test('a shortcut that the system refuses is reported apart from a duplicate, and the others work', macOnly, async () => {
  await withShortcuts(async ({ main, bar, save }) => {
    const refused = 'Control+Alt+Shift+F15';
    await refuseShortcut(main, refused);
    await save(refused, TIMESHEETS);
    assert.deepEqual(await shortcutStates(main), [
      { id: 'home', shortcut: refused, status: 'refused' },
      { id: 'timesheets', shortcut: TIMESHEETS, status: 'registered' },
    ]);
    assert.equal(await holdsShortcut(main, refused), false);

    await pressShortcut(main, TIMESHEETS);
    await eventually(async () => (await activeOf(bar)) === 'timesheets', 'Timesheets to be active');
  });
});

test('a later start registers the stored shortcuts and opens no window', macOnly, async () => {
  const userDataDir = makeUserDataDir();
  let app: ChildProcess | undefined;
  try {
    writeConfig(
      userDataDir,
      JSON.stringify({
        baseUrl: 'https://odoo.example.com',
        apps: [
          { id: 'home', name: 'Home', url: '/odoo', shortcut: HOME },
          { id: 'timesheets', name: 'Timesheets', url: '/odoo/timesheets' },
        ],
      }),
    );
    const inspected = await launchInspected(electronBinary, [projectRoot], userDataDir);
    app = inspected.app;
    const { main } = inspected;
    await eventually(() => holdsShortcut(main, HOME), 'the stored shortcut to be registered');
    assert.equal(await holdsShortcut(main, TIMESHEETS), false);
    assert.equal(await windowCount(main), 0);
  } finally {
    if (app) await stop(app);
    removeUserDataDir(userDataDir);
  }
});
