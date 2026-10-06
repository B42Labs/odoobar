import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  applicationType,
  launch,
  macOnly,
  makeUserDataDir,
  menuBarOwner,
  projectRoot,
  removeUserDataDir,
  stop,
  storedConfig,
  waitForApplicationType,
  waitForExit,
  writeConfig,
} from '../support/app-process';
import {
  devtoolsPort,
  evaluate,
  eventually,
  waitForBar,
  waitForPrompt,
  waitForSettings,
  type Page,
} from '../support/devtools';
import {
  answerDialogs,
  appMenuEntries,
  appMenuLabels,
  chooseAppMenuEntry,
  closeSettings,
  desktopCalls,
  dialogs,
  lastDialog,
  launchInspected,
  pressCommand,
  recordDesktopCalls,
} from '../support/main-process';

const { version } = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { version: string };
const repository = 'https://github.com/B42Labs/odoobar';

let electronBinary = '';

// In plain Node.js, require('electron') returns the binary path and downloads
// the binary on first use. The hook keeps that download out of the test timeout.
before(() => {
  if (process.platform === 'darwin') electronBinary = require('electron');
});

interface Running {
  readonly userDataDir: string;
  readonly app: ChildProcess;
  readonly main: Page;
  readonly port: number;
}

/**
 * Runs OdooBar with a stored configuration without apps and passes everything
 * to `run` once the app bar is drawn.
 */
async function withWindow(run: (running: Running) => Promise<void>, lang = 'en'): Promise<void> {
  const userDataDir = makeUserDataDir();
  let app: ChildProcess | undefined;
  try {
    writeConfig(userDataDir, storedConfig);
    const inspected = await launchInspected(
      electronBinary,
      [projectRoot, '--remote-debugging-port=0', `--lang=${lang}`],
      userDataDir,
    );
    app = inspected.app;
    const port = await devtoolsPort(userDataDir, 30_000);
    await waitForBar(port);
    await run({ userDataDir, app, main: inspected.main, port });
  } finally {
    if (app) await stop(app);
    removeUserDataDir(userDataDir);
  }
}

/** Whether the menu bar shows the menu of this app. */
const ownsMenuBar = (app: ChildProcess) => menuBarOwner() === app.pid;

test('a window brings the Dock icon and the menu of OdooBar, and the last window takes them along', macOnly, async () => {
  await withWindow(async ({ userDataDir, app, main, port }) => {
    await waitForApplicationType(app, 'Foreground', 5_000);
    await eventually(() => ownsMenuBar(app), 'the menu bar to show the menu of OdooBar');

    await chooseAppMenuEntry(main, 'Settings…');
    await waitForSettings(port);
    // ⌘W hides the window, and the settings keep the Dock icon.
    await pressCommand(main, '/renderer/app-bar.html', 'w');
    await eventually(() => !ownsMenuBar(app), 'another app to get the menu bar');
    await sleep(500);
    assert.equal(applicationType(app.pid ?? 0), 'Foreground');

    await closeSettings(main);
    await waitForApplicationType(app, 'UIElement', 5_000);

    // Starting OdooBar again shows the window, as a user does it.
    const again = launch(electronBinary, [projectRoot], userDataDir);
    try {
      assert.equal(await waitForExit(again, 15_000), 0);
    } finally {
      await stop(again);
    }
    await waitForApplicationType(app, 'Foreground', 5_000);
    await eventually(() => ownsMenuBar(app), 'the menu bar to show the menu of OdooBar again');
  });
});

test('the app menu opens the settings and the About dialog, which leads to the repository', macOnly, async () => {
  await withWindow(async ({ main, port }) => {
    assert.deepEqual(await appMenuLabels(main), ['OdooBar', 'Edit', 'View', 'Window']);
    assert.deepEqual(await appMenuEntries(main), [
      { label: 'About OdooBar', enabled: true },
      { label: 'Settings…', enabled: true },
      { label: 'Hide OdooBar', enabled: true },
      { label: 'Hide Others', enabled: true },
      { label: 'Show All', enabled: true },
      { label: 'Quit OdooBar', enabled: true },
    ]);

    await recordDesktopCalls(main);
    // The first button closes the dialog.
    await answerDialogs(main, 0);
    await chooseAppMenuEntry(main, 'About OdooBar');
    await eventually(async () => (await dialogs(main)).length === 1, 'the About dialog');
    assert.deepEqual(await lastDialog(main), {
      message: 'OdooBar',
      detail: `Version ${version}\n\n${repository}`,
      buttons: ['OK', 'Open on GitHub'],
    });
    // Time for the browser, which must not open.
    await sleep(500);
    assert.deepEqual(await desktopCalls(main), []);

    await answerDialogs(main, 1);
    await chooseAppMenuEntry(main, 'About OdooBar');
    await eventually(async () => (await desktopCalls(main)).length === 1, 'the repository to open');
    assert.deepEqual(await desktopCalls(main), [['openExternal', repository]]);

    await chooseAppMenuEntry(main, 'Settings…');
    await waitForSettings(port);
  });
});

test('the app menu is German for a German locale', macOnly, async () => {
  await withWindow(async ({ main }) => {
    assert.deepEqual(await appMenuLabels(main), ['OdooBar', 'Bearbeiten', 'Darstellung', 'Fenster']);
    assert.deepEqual(
      (await appMenuEntries(main)).map(({ label }) => label),
      [
        'Über OdooBar',
        'Einstellungen …',
        'OdooBar ausblenden',
        'Andere ausblenden',
        'Alle einblenden',
        'OdooBar beenden',
      ],
    );
    await answerDialogs(main, 0);
    await chooseAppMenuEntry(main, 'Über OdooBar');
    await eventually(async () => (await dialogs(main)).length === 1, 'the About dialog');
    assert.deepEqual((await lastDialog(main))?.buttons, ['OK', 'Auf GitHub öffnen']);
  }, 'de');
});

test('the first-start prompt has the menu without the way to the settings, which a configuration opens', macOnly, async () => {
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
    const { port, page } = await waitForPrompt(userDataDir);
    await waitForApplicationType(app, 'Foreground', 5_000);
    const settings = async () => (await appMenuEntries(main)).find(({ label }) => label === 'Settings…');
    assert.deepEqual(await settings(), { label: 'Settings…', enabled: false });

    await evaluate(
      page,
      `document.getElementById('base-url').value = 'odoo.example.com'; document.getElementById('form').requestSubmit(); true`,
    );
    await waitForBar(port);
    assert.deepEqual(await settings(), { label: 'Settings…', enabled: true });
    // The prompt took the Dock icon along, and the window brought it back.
    await waitForApplicationType(app, 'Foreground', 5_000);
    const { pid } = app;
    await eventually(() => menuBarOwner() === pid, 'the menu bar to show the menu of OdooBar');
  } finally {
    if (app) await stop(app);
    removeUserDataDir(userDataDir);
  }
});
