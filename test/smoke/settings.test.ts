import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { serializeConfig, type AppConfig } from '../../src/main/config';
import { messagesFor } from '../../src/main/messages';
import {
  iconCount,
  isRunning,
  macOnly,
  makeUserDataDir,
  projectRoot,
  removeUserDataDir,
  stop,
  waitForExit,
  writeConfig,
} from '../support/app-process';
import {
  devtoolsPort,
  evaluate,
  eventually,
  listPages,
  loadedPage,
  navigate,
  readBar,
  waitForBar,
  waitForSettings,
  type Page,
} from '../support/devtools';
import {
  answerDialogs,
  blurSettings,
  closeSettings,
  dialogs,
  holdsShortcut,
  launchInspected,
  loginItemSettings,
  menuBarIcons,
  pressCommand,
  pressKey,
  recordLoginItem,
  recordMenuBar,
  recordShortcuts,
  refuseShortcut,
  shortcutStates,
} from '../support/main-process';
import { startOdooServer, type OdooServer } from '../support/odoo-server';

let electronBinary = '';

// In plain Node.js, require('electron') returns the binary path and downloads
// the binary on first use. The hook keeps that download out of the test timeout.
before(() => {
  if (process.platform === 'darwin') electronBinary = require('electron');
});

const en = messagesFor('en');

const ICON_COUNT = iconCount();

// No test sends a real key to another program, and these are unlikely to be a shortcut of one.
const F13 = 'Control+Alt+Shift+F13';
const F15 = 'Control+Alt+Shift+F15';

function entry(id: string, name: string, more: Partial<AppConfig> = {}): AppConfig {
  return { id, name, url: `/odoo/${id}`, icon: '', shortcut: '', menuBar: true, ...more };
}

const home = entry('home', 'Home', { url: '/odoo', icon: 'house' });
const timesheets = entry('timesheets', 'Timesheets', { icon: 'clock' });
const discuss = entry('discuss', 'Discuss', { icon: 'messages-square', shortcut: F13, menuBar: false });

/** A configuration with Home, Timesheets, and Discuss, of which only Discuss has a shortcut. */
const threeApps = (baseUrl: string) => ({ baseUrl, launchAtLogin: true, apps: [home, timesheets, discuss] });

/** The selector of the row of the app at `index`. */
const row = (index: number) => `#apps .app:nth-child(${index + 1})`;

/** Clicks the element. The timeout lets the evaluation answer before the click changes the page. */
function click(page: Page, selector: string): Promise<unknown> {
  return evaluate(page, `setTimeout(() => document.querySelector(${JSON.stringify(selector)}).click(), 0); true`);
}

/**
 * Types a text into a field, or checks or clears a checkbox for a boolean,
 * with the event that a user's edit raises. A value that DevTools writes
 * raises none.
 */
function setField(page: Page, selector: string, value: string | boolean): Promise<unknown> {
  const [property, event] = typeof value === 'boolean' ? ['checked', 'change'] : ['value', 'input'];
  return evaluate(
    page,
    `(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      field.${property} = ${JSON.stringify(value)};
      field.dispatchEvent(new Event('${event}', { bubbles: true }));
      return true;
    })()`,
  );
}

function property(page: Page, selector: string, name: string): Promise<unknown> {
  return evaluate(page, `document.querySelector(${JSON.stringify(selector)}).${name}`);
}

function attribute(page: Page, selector: string, name: string): Promise<unknown> {
  return evaluate(page, `document.querySelector(${JSON.stringify(selector)}).getAttribute(${JSON.stringify(name)})`);
}

const textOf = (page: Page, selector: string) => property(page, selector, 'textContent');
const noticeOf = (page: Page, index: number) => textOf(page, `${row(index)} p.notice`);
const pickerOpen = async (page: Page) => (await property(page, '#icon-picker', 'open')) === true;
const appPickerOpen = async (page: Page) => (await property(page, '#app-picker', 'open')) === true;
const saveDisabled = async (page: Page) => (await property(page, '#save', 'disabled')) === true;

/** The grid buttons of the picker that show. */
function visibleIcons(page: Page): Promise<number> {
  return evaluate(
    page,
    `[...document.querySelectorAll('#icon-grid button')].filter((button) => button.checkVisibility()).length`,
  ) as Promise<number>;
}

/** The address of the image in the icon button of a row, once it has loaded, with its width. */
function rowIcon(page: Page, index: number): Promise<{ src: string; width: number } | undefined> {
  return evaluate(
    page,
    `(() => {
      const image = document.querySelector(${JSON.stringify(`${row(index)} button.icon img`)});
      if (!image.complete || image.naturalWidth === 0) return undefined;
      return { src: image.currentSrc, width: image.naturalWidth };
    })()`,
  ) as Promise<{ src: string; width: number } | undefined>;
}

interface Shown {
  readonly baseUrl: string;
  readonly launchAtLogin: boolean;
  readonly apps: AppConfig[];
}

/** What the settings page shows right now. */
async function readSettings(page: Page): Promise<Shown> {
  return (await evaluate(
    page,
    `({
      baseUrl: document.getElementById('base-url').value,
      launchAtLogin: document.getElementById('launch-at-login').checked,
      apps: [...document.querySelectorAll('#apps .app')].map((row) => ({
        id: row.dataset.id,
        name: row.querySelector('input.name').value,
        url: row.querySelector('input.url').value,
        icon: row.querySelector('button.icon').dataset.icon,
        shortcut: row.querySelector('input.shortcut').value,
        menuBar: row.querySelector('input.menu-bar').checked,
      })),
    })`,
  )) as Shown;
}

const ids = async (page: Page) => (await readSettings(page)).apps.map((app) => app.id);

async function settingsShown(port: number): Promise<boolean> {
  return (await listPages(port)).some((page) => page.url.endsWith('/renderer/settings.html'));
}

/**
 * Counts every 'settings:dirty' message that reaches the main process. The
 * counter listens after the one of OdooBar, so a count tells that OdooBar has
 * heard the message.
 */
async function countDirtyMessages(main: Page): Promise<void> {
  await evaluate(
    main,
    `globalThis.dirtyMessages = 0;
    process.mainModule.require('electron').ipcMain.on('settings:dirty', () => globalThis.dirtyMessages++);
    true`,
  );
}

const crmLogin = '/web/login?redirect=%2Fodoo%2Fcrm';

/** Sends the form of the login page. The timeout lets the evaluation answer before the page goes. */
function logIn(page: Page): Promise<unknown> {
  return evaluate(page, `setTimeout(() => document.getElementById('login').requestSubmit(), 0); true`);
}

interface Running {
  readonly server: OdooServer;
  readonly userDataDir: string;
  /** The path of config.json. */
  readonly file: string;
  readonly app: ChildProcess;
  readonly main: Page;
  readonly port: number;
  readonly bar: Page;
  readonly settings: Page;
}

/**
 * Runs OdooBar with the configuration that `config` returns for the address
 * of a fresh OdooServer, opens the settings with the gear of the app bar, and
 * passes everything to `run` once the settings page is drawn. The shortcuts
 * and the menu bar are recorded from the start, so their states and icons are
 * readable after a save.
 */
async function withSettings(
  config: (baseUrl: string) => object,
  run: (running: Running) => Promise<void>,
  { lang = 'en', login = false, menus = undefined as unknown } = {},
): Promise<void> {
  const server = await startOdooServer(0, { login, menus });
  const userDataDir = makeUserDataDir();
  let app: ChildProcess | undefined;
  try {
    const file = writeConfig(userDataDir, JSON.stringify(config(server.baseUrl)));
    const inspected = await launchInspected(
      electronBinary,
      [projectRoot, '--remote-debugging-port=0', `--lang=${lang}`],
      userDataDir,
    );
    app = inspected.app;
    const { main } = inspected;
    await recordShortcuts(main);
    await recordMenuBar(main);
    const port = await devtoolsPort(userDataDir, 30_000);
    const bar = await waitForBar(port);
    await click(bar, '#settings');
    const settings = await waitForSettings(port);
    await run({ server, userDataDir, file, app, main, port, bar, settings });
  } finally {
    if (app) await stop(app);
    await server.close();
    removeUserDataDir(userDataDir);
  }
}

test('the settings show the saved configuration', macOnly, async () => {
  await withSettings(threeApps, async ({ server, settings }) => {
    assert.deepEqual(await readSettings(settings), {
      baseUrl: server.baseUrl,
      launchAtLogin: true,
      apps: [home, timesheets, discuss],
    });
    assert.equal(await evaluate(settings, 'document.title'), 'OdooBar Settings');
    assert.equal(await textOf(settings, '#shortcut-hint'), en.settings.shortcutHint);
    assert.equal(await saveDisabled(settings), true);
    assert.equal(await property(settings, `${row(0)} button.up`, 'disabled'), true);
    assert.equal(await property(settings, `${row(0)} button.down`, 'disabled'), false);
    assert.equal(await property(settings, `${row(2)} button.down`, 'disabled'), true);
    // Discuss holds its shortcut.
    assert.equal(await noticeOf(settings, 2), '');
  });
});

test('the settings are German for a German locale', macOnly, async () => {
  await withSettings(
    threeApps,
    async ({ settings }) => {
      assert.equal(await evaluate(settings, 'document.title'), 'OdooBar-Einstellungen');
      assert.equal(await textOf(settings, '#save'), 'Speichern');
      assert.equal(await textOf(settings, `${row(0)} button.record`), 'Aufnehmen');
      assert.equal(await textOf(settings, '#blank-app'), 'Leere App');
      assert.equal(await textOf(settings, '#odoo-apps-title'), 'Apps deines Odoo-Kontos');
    },
    { lang: 'de' },
  );
});

test('saving writes the edited configuration, and the window, the menu bar, the shortcuts, and the login item follow', macOnly, async () => {
  await withSettings(
    (baseUrl) => ({ ...threeApps(`${baseUrl}/old`), launchAtLogin: false }),
    async ({ server, file, main, bar, settings }) => {
      await recordLoginItem(main);
      await setField(settings, '#base-url', `${server.baseUrl}/`);
      await setField(settings, '#launch-at-login', true);
      await setField(settings, `${row(0)} input.name`, 'Start');
      await click(settings, `${row(1)} button.up`);
      await eventually(
        async () => isDeepStrictEqual(await ids(settings), ['timesheets', 'home', 'discuss']),
        'the move',
      );
      await click(settings, `${row(2)} button.remove`);
      await eventually(async () => isDeepStrictEqual(await ids(settings), ['timesheets', 'home']), 'the removal');
      await click(settings, '#add');
      await eventually(() => appPickerOpen(settings), 'the app picker to open');
      assert.equal(await evaluate(settings, 'document.activeElement.id'), 'blank-app');
      await click(settings, '#blank-app');
      await eventually(async () => isDeepStrictEqual(await ids(settings), ['timesheets', 'home', '']), 'the new row');
      assert.equal(await appPickerOpen(settings), false);
      assert.equal(await evaluate(settings, 'document.activeElement.dataset.path'), 'apps[2].name');
      await setField(settings, `${row(2)} input.name`, 'CRM');
      await setField(settings, `${row(2)} input.url`, '/odoo/crm');
      assert.equal(await saveDisabled(settings), false);

      await click(settings, '#save');
      await eventually(() => saveDisabled(settings), 'the save');
      const crm = { id: 'crm', name: 'CRM', url: '/odoo/crm', icon: '', shortcut: '', menuBar: true };
      const saved = {
        baseUrl: server.baseUrl,
        launchAtLogin: true,
        apps: [timesheets, { ...home, name: 'Start' }, crm],
      };
      assert.equal(readFileSync(file, 'utf8'), serializeConfig(saved));
      assert.deepEqual(await readSettings(settings), saved);
      await eventually(async () => {
        const apps = (await readBar(bar)).apps.map(({ id, name }) => [id, name]);
        return isDeepStrictEqual(apps, [
          ['timesheets', 'Timesheets'],
          ['home', 'Start'],
          ['crm', 'CRM'],
        ]);
      }, 'the app bar to follow');
      await eventually(
        async () => isDeepStrictEqual(await menuBarIcons(main), ['Timesheets', 'Start', 'CRM']),
        'the menu bar to follow',
      );
      // Discuss and its shortcut are gone.
      assert.deepEqual(await shortcutStates(main), []);
      assert.equal(await holdsShortcut(main, F13), false);
      assert.deepEqual(await loginItemSettings(main), [{ openAtLogin: true }]);
    },
  );
});

test('a value that breaks a rule is named and marked, and the file stays', macOnly, async () => {
  await withSettings(threeApps, async ({ file, settings }) => {
    const before = readFileSync(file, 'utf8');
    const url = '[data-path="apps[1].url"]';
    await setField(settings, url, 'crm');
    await click(settings, '#save');
    await eventually(async () => (await textOf(settings, '#error')) === en.configErrors['app-url'], 'the error');
    assert.equal(await attribute(settings, url, 'aria-invalid'), 'true');
    assert.equal(await evaluate(settings, 'document.activeElement.dataset.path'), 'apps[1].url');
    assert.equal(await saveDisabled(settings), false);
    assert.equal(readFileSync(file, 'utf8'), before);

    // The next save clears the error and the mark.
    await setField(settings, url, '/odoo/crm');
    await click(settings, '#save');
    await eventually(() => saveDisabled(settings), 'the save');
    assert.equal(await textOf(settings, '#error'), '');
    assert.equal(await evaluate(settings, `document.querySelectorAll('[aria-invalid]').length`), 0);
    assert.match(readFileSync(file, 'utf8'), /"url": "\/odoo\/crm"/);
  });
});

test('⌘W closes the settings, and opening them again shows the saved values', macOnly, async () => {
  await withSettings(threeApps, async ({ app, main, port, bar, settings }) => {
    await setField(settings, `${row(0)} input.name`, 'Start');
    await click(settings, '#save');
    await eventually(() => saveDisabled(settings), 'the save');

    await pressCommand(main, '/renderer/settings.html', 'w');
    await eventually(async () => !(await settingsShown(port)), 'the settings to close');
    assert.ok((await listPages(port)).some((page) => page.url.endsWith('/renderer/app-bar.html')));
    assert.ok(isRunning(app));

    await click(bar, '#settings');
    const again = await waitForSettings(port);
    assert.deepEqual((await readSettings(again)).apps[0], { ...home, name: 'Start' });
  });
});

test('closing with unsaved edits asks, and keeps or discards them', macOnly, async () => {
  await withSettings(threeApps, async ({ file, main, port, settings }) => {
    const before = readFileSync(file, 'utf8');
    await countDirtyMessages(main);
    await setField(settings, `${row(0)} input.name`, 'Start');
    assert.equal(await saveDisabled(settings), false);
    await eventually(
      async () => (await evaluate(main, 'globalThis.dirtyMessages')) === 1,
      'OdooBar to hear of the edit',
    );

    await answerDialogs(main, 0);
    await closeSettings(main);
    await eventually(async () => (await dialogs(main)).length === 1, 'the question');
    // Time for the window to close, which it must not.
    await sleep(500);
    assert.equal(await settingsShown(port), true);
    assert.equal((await readSettings(settings)).apps[0]?.name, 'Start');

    await answerDialogs(main, 1);
    await closeSettings(main);
    await eventually(async () => !(await settingsShown(port)), 'the settings to close');
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.deepEqual(await dialogs(main), ['Discard the unsaved changes?', 'Discard the unsaved changes?']);
  });
});

test('⌘R keeps the unsaved edits, and a page that loads anew starts clean', macOnly, async () => {
  await withSettings(threeApps, async ({ main, port, settings }) => {
    await countDirtyMessages(main);
    await setField(settings, `${row(0)} input.name`, 'Start');
    await eventually(
      async () => (await evaluate(main, 'globalThis.dirtyMessages')) === 1,
      'OdooBar to hear of the edit',
    );

    // Electron's default menu reloads the page on ⌘R and ⇧⌘R that the page
    // passes on. A key that a test sends never reaches the menu, so the page
    // must not see these keys at all.
    await evaluate(
      settings,
      `globalThis.keys = []; addEventListener('keydown', (event) => keys.push(event.key)); true`,
    );
    await pressCommand(main, '/renderer/settings.html', 'r');
    await pressKey(main, '/renderer/settings.html', 'R', ['meta', 'shift']);
    // Time for the keys, which must not come.
    await sleep(500);
    assert.deepEqual(await evaluate(settings, 'globalThis.keys'), []);

    // A page that loads anew, as the developer tools can make it, shows the
    // saved configuration, so a close asks nothing.
    await navigate(settings, settings.url);
    const again = await waitForSettings(port);
    assert.equal((await readSettings(again)).apps[0]?.name, 'Home');
    await answerDialogs(main, 0);
    await closeSettings(main);
    await eventually(async () => !(await settingsShown(port)), 'the settings to close');
    assert.deepEqual(await dialogs(main), []);
  });
});

test('quitting with unsaved edits quits without a question', macOnly, async () => {
  await withSettings(threeApps, async ({ app, main, settings }) => {
    await countDirtyMessages(main);
    await setField(settings, `${row(0)} input.name`, 'Start');
    await eventually(
      async () => (await evaluate(main, 'globalThis.dirtyMessages')) === 1,
      'OdooBar to hear of the edit',
    );
    // A question would keep the edits, and so OdooBar.
    await answerDialogs(main, 0);
    // Quit in the menu of an icon and ⌘Q call app.quit(). The timeout lets the evaluation answer first.
    await evaluate(main, `setTimeout(() => process.mainModule.require('electron').app.quit(), 0); true`);
    assert.equal(await waitForExit(app, 10_000), 0);
  });
});

test('another page in the settings window cannot use the settings channels', macOnly, async () => {
  await withSettings(threeApps, async ({ userDataDir, file, port, settings }) => {
    const before = readFileSync(file, 'utf8');
    // A page with every element of the settings page gets its preload script as well.
    const other = join(userDataDir, 'other.html');
    copyFileSync(join(projectRoot, 'out/src/renderer/settings.html'), other);
    // A page that the main process loads gets past will-navigate.
    await navigate(settings, pathToFileURL(other).href);
    const page = await loadedPage(port, '/other.html');
    // Time for the preload script to draw the page, which it must not.
    await sleep(500);
    assert.equal(await property(page, '#base-url', 'value'), '');
    assert.equal(await property(page, '#apps', 'childElementCount'), 0);
    assert.equal(await evaluate(page, 'document.body.hidden'), true);
    assert.equal(readFileSync(file, 'utf8'), before);
  });
});

test('the recorder releases the global shortcuts and writes the pressed keys', macOnly, async () => {
  await withSettings(
    (baseUrl) => ({ baseUrl, apps: [{ ...home, shortcut: 'Control+Alt+H' }, timesheets] }),
    async ({ main, settings }) => {
      const record = `${row(0)} button.record`;
      await eventually(() => holdsShortcut(main, 'Control+Alt+H'), 'the stored shortcut to be held');
      await click(settings, record);
      await eventually(async () => !(await holdsShortcut(main, 'Control+Alt+H')), 'the shortcuts to be released');
      assert.equal(await textOf(settings, record), 'Press the shortcut…');
      assert.equal(await attribute(settings, record, 'aria-pressed'), 'true');

      await pressKey(main, '/renderer/settings.html', 'D', ['control', 'alt']);
      await eventually(
        async () => (await property(settings, `${row(0)} input.shortcut`, 'value')) === 'Control+Alt+D',
        'the recorded shortcut',
      );
      assert.equal(await holdsShortcut(main, 'Control+Alt+H'), true);
      assert.equal(await textOf(settings, record), 'Record');
      assert.equal(await attribute(settings, record, 'aria-pressed'), 'false');
      assert.equal(await saveDisabled(settings), false);

      await click(settings, '#save');
      await eventually(() => saveDisabled(settings), 'the save');
      assert.deepEqual(await shortcutStates(main), [{ id: 'home', shortcut: 'Control+Alt+D', status: 'registered' }]);
      assert.equal(await holdsShortcut(main, 'Control+Alt+D'), true);
      assert.equal(await holdsShortcut(main, 'Control+Alt+H'), false);
    },
  );
});

test('Escape ends a recording and leaves the field as it was', macOnly, async () => {
  await withSettings(threeApps, async ({ main, settings }) => {
    const record = `${row(2)} button.record`;
    await click(settings, record);
    await eventually(async () => (await textOf(settings, record)) === 'Press the shortcut…', 'the recording');
    await eventually(async () => !(await holdsShortcut(main, F13)), 'the shortcuts to be released');

    await pressKey(main, '/renderer/settings.html', 'Escape', []);
    await eventually(async () => (await textOf(settings, record)) === 'Record', 'the recording to end');
    assert.equal(await attribute(settings, record, 'aria-pressed'), 'false');
    assert.equal(await property(settings, `${row(2)} input.shortcut`, 'value'), F13);
    assert.equal(await saveDisabled(settings), true);
    assert.equal(await holdsShortcut(main, F13), true);
  });
});

test('a second click on Record ends the recording, and a click in another row moves it', macOnly, async () => {
  await withSettings(threeApps, async ({ main, settings }) => {
    const record = (index: number) => `${row(index)} button.record`;
    const recording = async (index: number) => (await attribute(settings, record(index), 'aria-pressed')) === 'true';
    await click(settings, record(0));
    await eventually(async () => !(await holdsShortcut(main, F13)), 'the shortcuts to be released');
    await click(settings, record(0));
    await eventually(() => holdsShortcut(main, F13), 'the shortcuts to come back');
    assert.equal(await textOf(settings, record(0)), 'Record');
    assert.equal(await recording(0), false);

    await click(settings, record(0));
    await eventually(async () => !(await holdsShortcut(main, F13)), 'the shortcuts to be released again');
    await click(settings, record(1));
    await eventually(() => recording(1), 'the recording to move');
    assert.equal(await textOf(settings, record(1)), 'Press the shortcut…');
    assert.equal(await textOf(settings, record(0)), 'Record');
    assert.equal(await recording(0), false);
    assert.equal(await holdsShortcut(main, F13), false);

    await pressKey(main, '/renderer/settings.html', 'D', ['control', 'alt']);
    await eventually(
      async () => (await property(settings, `${row(1)} input.shortcut`, 'value')) === 'Control+Alt+D',
      'the recorded shortcut',
    );
    assert.equal(await property(settings, `${row(0)} input.shortcut`, 'value'), '');
    assert.equal(await recording(1), false);
    assert.equal(await holdsShortcut(main, F13), true);
  });
});

test('a click into another program ends a recording', macOnly, async () => {
  await withSettings(threeApps, async ({ main, settings }) => {
    const record = `${row(2)} button.record`;
    await click(settings, record);
    await eventually(async () => !(await holdsShortcut(main, F13)), 'the shortcuts to be released');
    await blurSettings(main);
    await eventually(() => holdsShortcut(main, F13), 'the shortcuts to come back');
    assert.equal(await textOf(settings, record), 'Record');
    assert.equal(await attribute(settings, record, 'aria-pressed'), 'false');
  });
});

test('a page that loads anew ends a recording', macOnly, async () => {
  await withSettings(threeApps, async ({ main, port, settings }) => {
    await click(settings, `${row(2)} button.record`);
    await eventually(async () => !(await holdsShortcut(main, F13)), 'the shortcuts to be released');

    // The developer tools can load the page anew without a blur of the window.
    await navigate(settings, settings.url);
    const again = await waitForSettings(port);
    await eventually(() => holdsShortcut(main, F13), 'the shortcuts to come back');
    // The new page gets the keys again.
    await evaluate(again, `globalThis.keys = []; addEventListener('keydown', (event) => keys.push(event.key)); true`);
    await pressKey(main, '/renderer/settings.html', 'A', []);
    await eventually(async () => (await evaluate(again, 'globalThis.keys.length')) === 1, 'the key');
  });
});

test('a text that is no shortcut saves, and its row shows a notice until it changes', macOnly, async () => {
  await withSettings(threeApps, async ({ file, settings }) => {
    const shortcut = `${row(0)} input.shortcut`;
    await setField(settings, shortcut, 'Contrl+D');
    // A notice belongs to the saved shortcut.
    assert.equal(await noticeOf(settings, 0), '');
    await click(settings, '#save');
    await eventually(async () => (await noticeOf(settings, 0)) === 'This is not a valid shortcut.', 'the notice');
    assert.equal(await textOf(settings, '#error'), '');
    assert.match(readFileSync(file, 'utf8'), /"shortcut": "Contrl\+D"/);

    await setField(settings, shortcut, 'Contrl+E');
    assert.equal(await noticeOf(settings, 0), '');
    await setField(settings, shortcut, 'Contrl+D');
    assert.equal(await noticeOf(settings, 0), 'This is not a valid shortcut.');
  });
});

test('a duplicate and a refused shortcut each show their notice after a save', macOnly, async () => {
  await withSettings(
    (baseUrl) => ({ baseUrl, apps: [{ ...home, shortcut: F13 }, timesheets, { ...discuss, shortcut: '' }] }),
    async ({ main, settings }) => {
      await refuseShortcut(main, F15);
      await setField(settings, `${row(1)} input.shortcut`, F13);
      await setField(settings, `${row(2)} input.shortcut`, F15);
      await click(settings, '#save');
      await eventually(async () => (await noticeOf(settings, 2)) === 'macOS refused this shortcut.', 'the notices');
      assert.equal(await noticeOf(settings, 0), '');
      assert.equal(
        await noticeOf(settings, 1),
        'An app further up already has this shortcut, and it works only there.',
      );
    },
  );
});

test('the icon picker narrows the icons by a search and sets the icon of a row', macOnly, async () => {
  await withSettings(threeApps, async ({ file, main, settings }) => {
    const shown = (name: string) =>
      evaluate(settings, `document.querySelector('#icon-grid [data-icon="${name}"]').checkVisibility()`);
    await click(settings, `${row(0)} button.icon`);
    await eventually(() => pickerOpen(settings), 'the picker to open');
    assert.equal(await evaluate(settings, `document.querySelectorAll('#icon-grid button').length`), ICON_COUNT);
    assert.equal(await evaluate(settings, 'document.activeElement.id'), 'icon-search');
    await setField(settings, '#icon-search', 'message-c');
    assert.equal(await shown('message-circle'), true);
    assert.equal(await shown('house'), false);

    await click(settings, '#icon-grid [data-icon="message-circle"]');
    await eventually(async () => !(await pickerOpen(settings)), 'the picker to close');
    assert.equal(await property(settings, `${row(0)} button.icon`, 'dataset.icon'), 'message-circle');
    await eventually(async () => (await rowIcon(settings, 0))?.width === 18, 'the icon image to load');
    assert.match(String((await rowIcon(settings, 0))?.src), /\/message-circle(@2x)?\.png$/);

    // The picker opens with an empty search, and Escape closes it without a change.
    await click(settings, `${row(1)} button.icon`);
    await eventually(() => pickerOpen(settings), 'the picker to open again');
    assert.equal(await property(settings, '#icon-search', 'value'), '');
    assert.equal(await visibleIcons(settings), ICON_COUNT);
    await setField(settings, '#icon-search', 'zzzz');
    assert.equal(await visibleIcons(settings), 0);
    await setField(settings, '#icon-search', '');
    assert.equal(await visibleIcons(settings), ICON_COUNT);
    await pressKey(main, '/renderer/settings.html', 'Escape', []);
    await eventually(async () => !(await pickerOpen(settings)), 'the picker to close on Escape');
    assert.equal(await property(settings, `${row(1)} button.icon`, 'dataset.icon'), 'clock');

    await click(settings, '#save');
    await eventually(() => saveDisabled(settings), 'the save');
    assert.match(readFileSync(file, 'utf8'), /"icon": "message-circle"/);
  });
});

test('No icon sets an empty icon, and a name that is no icon shows the fallback', macOnly, async () => {
  await withSettings(
    (baseUrl) => ({ baseUrl, apps: [home, { ...timesheets, icon: 'no-such-icon' }] }),
    async ({ file, settings }) => {
      const fallback = /\/app-window(@2x)?\.png$/;
      await eventually(async () => fallback.test(String((await rowIcon(settings, 1))?.src)), 'the fallback icon');
      assert.equal((await rowIcon(settings, 1))?.width, 18);
      assert.equal(await property(settings, `${row(1)} button.icon`, 'dataset.icon'), 'no-such-icon');

      await click(settings, `${row(0)} button.icon`);
      await eventually(() => pickerOpen(settings), 'the picker to open');
      await click(settings, '#no-icon');
      await eventually(async () => !(await pickerOpen(settings)), 'the picker to close');
      assert.equal(await property(settings, `${row(0)} button.icon`, 'dataset.icon'), '');
      await eventually(async () => fallback.test(String((await rowIcon(settings, 0))?.src)), 'the fallback icon');

      await click(settings, '#save');
      await eventually(() => saveDisabled(settings), 'the save');
      assert.equal(JSON.parse(readFileSync(file, 'utf8')).apps[0].icon, '');
    },
  );
});

/** CRM and Discuss of the instance at `baseUrl`. */
const loginApps = (baseUrl: string) => ({
  baseUrl,
  apps: [entry('crm', 'CRM'), entry('discuss', 'Discuss')],
});

test('signing out asks first and leads the active app to the login page', macOnly, async () => {
  await withSettings(
    loginApps,
    async ({ main, port, settings }) => {
      await logIn(await loadedPage(port, crmLogin));
      await loadedPage(port, '/odoo/crm');

      await answerDialogs(main, 1);
      await click(settings, '#sign-out');
      await loadedPage(port, crmLogin);
      await eventually(async () => (await property(settings, '#sign-out', 'disabled')) === false, 'the sign-out');
      assert.equal(await textOf(settings, '#sign-out-error'), '');
      assert.deepEqual(await dialogs(main), ['Sign out of Odoo?']);
    },
    { login: true },
  );
});

test('signing out stops when the question is cancelled', macOnly, async () => {
  await withSettings(
    loginApps,
    async ({ server, main, port, settings }) => {
      await logIn(await loadedPage(port, crmLogin));
      await loadedPage(port, '/odoo/crm');
      server.requests.length = 0;

      await answerDialogs(main, 0);
      await click(settings, '#sign-out');
      await eventually(async () => (await dialogs(main)).length === 1, 'the question');
      await eventually(async () => (await property(settings, '#sign-out', 'disabled')) === false, 'the answer');
      // Time for a request, which must not come.
      await sleep(500);
      assert.deepEqual(server.requests, []);
      assert.equal(await textOf(settings, '#sign-out-error'), '');
    },
    { login: true },
  );
});

/** The menu document of an Odoo with Discuss, CRM, and an app of its own without a path. */
const menus = {
  root: { id: 'root', children: [83, 235, 900] },
  '83': { id: 83, name: 'Discuss', xmlid: 'mail.menu_root_discuss', actionID: 137, actionPath: 'discuss' },
  '235': { id: 235, name: 'CRM', xmlid: 'crm.crm_menu_root', actionID: 394, actionPath: 'crm' },
  '900': { id: 900, name: 'Fleet of ours', xmlid: 'ours.menu_root', actionID: 1500, actionPath: false },
};

/** What the app picker offers: the name, the path, and the icon file of every choice. */
function odooChoices(page: Page): Promise<string[][]> {
  return evaluate(
    page,
    `[...document.querySelectorAll('#odoo-apps button')].map((choice) => [
      choice.querySelector('.app-name').textContent,
      choice.querySelector('.app-url').textContent,
      choice.querySelector('img').srcset.split(' ')[0].split('/').pop(),
    ])`,
  ) as Promise<string[][]>;
}

test('Add app offers the apps of the Odoo account once the login is there, and a choice fills a new row', macOnly, async () => {
  await withSettings(
    loginApps,
    async ({ server, file, main, port, settings }) => {
      // Without a login, Odoo answers with its login page.
      await click(settings, '#add');
      await eventually(() => appPickerOpen(settings), 'the app picker to open');
      await eventually(
        async () => (await textOf(settings, '#odoo-apps-status')) === en.settings.odooApps.signedOut,
        'the hint at the login',
      );
      assert.deepEqual(await odooChoices(settings), []);
      await pressKey(main, '/renderer/settings.html', 'Escape', []);
      await eventually(async () => !(await appPickerOpen(settings)), 'the app picker to close on Escape');
      assert.deepEqual(await ids(settings), ['crm', 'discuss']);
      assert.equal(await saveDisabled(settings), true);

      await logIn(await loadedPage(port, crmLogin));
      await loadedPage(port, '/odoo/crm');
      server.requests.length = 0;

      await click(settings, '#add');
      await eventually(async () => (await odooChoices(settings)).length === 3, 'the apps of the account');
      assert.deepEqual(await odooChoices(settings), [
        ['Discuss', '/odoo/discuss', 'message-circle.png'],
        ['CRM', '/odoo/crm', 'handshake.png'],
        ['Fleet of ours', '/odoo/action-1500', 'app-window.png'],
      ]);
      assert.equal(await textOf(settings, '#odoo-apps-status'), '');
      // The first address answered, so OdooBar asked no other.
      assert.deepEqual(server.requests, ['/web/webclient/load_menus']);

      await click(settings, '#odoo-apps button:nth-child(3)');
      await eventually(async () => !(await appPickerOpen(settings)), 'the app picker to close');
      const added = { id: '', name: 'Fleet of ours', url: '/odoo/action-1500', icon: '', shortcut: '', menuBar: true };
      assert.deepEqual((await readSettings(settings)).apps[2], added);
      assert.equal(await evaluate(settings, 'document.activeElement.dataset.path'), 'apps[2].name');
      assert.equal(await saveDisabled(settings), false);

      await click(settings, '#add');
      await eventually(async () => (await odooChoices(settings)).length === 3, 'the apps of the account again');
      await click(settings, '#odoo-apps button:nth-child(1)');
      await eventually(async () => (await ids(settings)).length === 4, 'the second new row');
      // The picker asked Odoo again and took no answer from a cache.
      assert.deepEqual(server.requests, ['/web/webclient/load_menus', '/web/webclient/load_menus']);

      await click(settings, '#save');
      await eventually(() => saveDisabled(settings), 'the save');
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).apps.slice(2), [
        { ...added, id: 'fleet-of-ours' },
        { id: 'discuss-2', name: 'Discuss', url: '/odoo/discuss', icon: 'message-circle', shortcut: '', menuBar: true },
      ]);
    },
    { login: true, menus },
  );
});
