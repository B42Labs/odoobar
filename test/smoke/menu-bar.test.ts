import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import {
  isRunning,
  macOnly,
  makeUserDataDir,
  projectRoot,
  removeUserDataDir,
  stop,
  storedConfig,
  waitForExit,
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
  waitForSettings,
  type Page,
} from '../support/devtools';
import {
  blurWindow,
  captureStore,
  chooseMenuEntry,
  clickIcon,
  iconImages,
  iconsIgnoreDoubleClicks,
  isWindowFocused,
  launchInspected,
  menuBarIcons,
  openIconMenu,
  recordDesktopCalls,
  recordMenuBar,
  saveConfig,
} from '../support/main-process';
import { startOdooServer, type OdooServer } from '../support/odoo-server';

let electronBinary = '';

// In plain Node.js, require('electron') returns the binary path and downloads
// the binary on first use. The hook keeps that download out of the test timeout.
before(() => {
  if (process.platform === 'darwin') electronBinary = require('electron');
});

interface Running {
  readonly server: OdooServer;
  readonly userDataDir: string;
  readonly app: ChildProcess;
  readonly main: Page;
  readonly port: number;
  readonly bar: Page;
}

/**
 * Runs a first start of OdooBar against a fresh OdooServer and passes
 * everything to `run` once the window shows Home. A first start seeds Home
 * and Timesheets, both with a menu bar icon. The test helpers hook into the
 * main process while the prompt waits, before the icons appear.
 */
async function withMenuBar(run: (running: Running) => Promise<void>, lang = 'en'): Promise<void> {
  const server = await startOdooServer();
  const userDataDir = makeUserDataDir();
  let app: ChildProcess | undefined;
  try {
    const inspected = await launchInspected(
      electronBinary,
      [projectRoot, '--remote-debugging-port=0', `--lang=${lang}`],
      userDataDir,
    );
    app = inspected.app;
    const { main } = inspected;
    await recordDesktopCalls(main);
    await captureStore(main);
    await recordMenuBar(main);
    const { port, page } = await waitForPrompt(userDataDir);
    await evaluate(
      page,
      `document.getElementById('base-url').value = ${JSON.stringify(server.baseUrl)}; document.getElementById('form').requestSubmit(); true`,
    );
    const bar = await waitForBar(port);
    await waitForPage(port, '/odoo', 5_000);
    await run({ server, userDataDir, app, main, port, bar });
  } finally {
    if (app) await stop(app);
    await server.close();
    removeUserDataDir(userDataDir);
  }
}

/** Waits until the menu bar shows icons with these tooltips, from left to right. */
function expectIcons(main: Page, names: string[]): Promise<true> {
  return eventually(
    async () => isDeepStrictEqual(await menuBarIcons(main), names),
    `the icons ${JSON.stringify(names)}`,
  );
}

async function activeOf(bar: Page): Promise<string | undefined> {
  return (await readBar(bar)).apps.find((app) => app.active)?.id;
}

test('every app with the menu bar flag has an icon, in the order of the configuration', macOnly, async () => {
  await withMenuBar(async ({ main }) => {
    await expectIcons(main, ['Home', 'Timesheets']);
    assert.equal(await iconsIgnoreDoubleClicks(main), true);
  });
});

test('a click on an icon shows its app, and a click while that app is in front hides the window', macOnly, async () => {
  await withMenuBar(async ({ server, app, main, port, bar }) => {
    const focused = () => isWindowFocused(main);
    const visible = async () => (await readBar(bar)).visible;
    await eventually(focused, 'the window to take the keys');

    await clickIcon(main, 'Timesheets');
    await loadedPage(port, '/odoo/timesheets');
    await eventually(async () => (await activeOf(bar)) === 'timesheets', 'Timesheets to be active');
    assert.equal(await visible(), true);
    await eventually(focused, 'the window to keep the keys');

    await clickIcon(main, 'Timesheets');
    await eventually(async () => !(await visible()), 'the window to hide');
    assert.ok(isRunning(app));

    await clickIcon(main, 'Home');
    await eventually(visible, 'the window to come back');
    await eventually(async () => (await activeOf(bar)) === 'home', 'Home to be active');
    await eventually(focused, 'the window to take the keys again');

    await blurWindow(main);
    await eventually(async () => !(await focused()), 'the window to lose the keys');
    await clickIcon(main, 'Home');
    await eventually(focused, 'the window to come to the front');
    // A window that came from behind others takes the keys before its page counts as visible.
    await eventually(visible, 'the window to show');
    assert.deepEqual(server.requests, ['/odoo', '/odoo/timesheets']);
  });
});

test('the menu of an icon reloads the app of that icon, opens the settings, and quits', macOnly, async () => {
  await withMenuBar(async ({ server, app, main, port, bar }) => {
    // Timesheets has no page yet, so there is nothing to reload.
    assert.deepEqual(await openIconMenu(main, 'Timesheets'), [
      { label: 'Reload', enabled: false },
      { label: 'Settings…', enabled: true },
      { label: 'Quit', enabled: true },
    ]);

    await clickIcon(main, 'Timesheets');
    await loadedPage(port, '/odoo/timesheets');
    assert.equal((await openIconMenu(main, 'Home'))[0]?.enabled, true);
    await chooseMenuEntry(main, 0);
    await eventually(() => server.requests.length === 3, 'Home to reload');
    assert.deepEqual(server.requests, ['/odoo', '/odoo/timesheets', '/odoo']);
    assert.equal(await activeOf(bar), 'timesheets');

    await chooseMenuEntry(main, 1);
    await waitForSettings(port);

    await chooseMenuEntry(main, 2);
    assert.equal(await waitForExit(app, 10_000), 0);
  });
});

test('a Control-click on an icon opens its menu, as a right click does', macOnly, async () => {
  await withMenuBar(async ({ main }) => {
    assert.deepEqual(await openIconMenu(main, 'Timesheets', 'control-click'), [
      { label: 'Reload', enabled: false },
      { label: 'Settings…', enabled: true },
      { label: 'Quit', enabled: true },
    ]);
  });
});

test('the menu of an icon is German for a German locale', macOnly, async () => {
  await withMenuBar(async ({ main }) => {
    const entries = await openIconMenu(main, 'Zeiterfassung');
    assert.deepEqual(entries.map((entry) => entry.label), ['Neu laden', 'Einstellungen …', 'Beenden']);
  }, 'de');
});

test('a saved configuration replaces the icons', macOnly, async () => {
  await withMenuBar(async ({ server, main, bar }) => {
    const entry = (id: string, name: string, icon: string, menuBar: boolean) => ({
      id,
      name,
      url: `/odoo/${id}`,
      icon,
      shortcut: '',
      menuBar,
    });
    const crm = entry('crm', 'CRM', 'handshake', true);
    const discuss = entry('discuss', 'Discuss', 'message-circle', false);
    const calendar = entry('calendar', 'Calendar', 'no-such-icon', true);
    const save = (apps: object[]) => saveConfig(main, { baseUrl: server.baseUrl, launchAtLogin: false, apps });

    await save([crm, discuss, calendar]);
    await expectIcons(main, ['CRM', 'Calendar']);
    await clickIcon(main, 'Calendar');
    await eventually(async () => (await activeOf(bar)) === 'calendar', 'Calendar to be active');

    await save([calendar, crm]);
    await expectIcons(main, ['Calendar', 'CRM']);

    await save([{ ...crm, menuBar: false }]);
    await expectIcons(main, []);
  });
});

test('an icon is a template image in two sizes, and a name without an icon gets the fallback', macOnly, async () => {
  const userDataDir = makeUserDataDir();
  let app: ChildProcess | undefined;
  try {
    writeConfig(userDataDir, storedConfig);
    const inspected = await launchInspected(electronBinary, [projectRoot], userDataDir);
    app = inspected.app;
    const others = ['', 'no-such-icon', 'House', '../icons/house', 'house.png'];
    const [house, fallback, ...rest] = await iconImages(inspected.main, ['house', 'app-window', ...others]);
    assert.ok(house && fallback);
    assert.deepEqual(house.size, { width: 18, height: 18 });
    assert.deepEqual(house.scaleFactors, [1, 2]);
    assert.equal(house.template, true);
    assert.notEqual(house.png, fallback.png);
    // Each of these names either reaches no file or never reaches the file system.
    assert.deepEqual(others.filter((_, index) => rest[index]?.png !== fallback.png), []);
    // The fallback for the empty name is a template image as well.
    assert.equal(rest[0]?.template, true);
  } finally {
    if (app) await stop(app);
    removeUserDataDir(userDataDir);
  }
});
