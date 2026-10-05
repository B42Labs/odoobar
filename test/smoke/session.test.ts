import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  launch,
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
  readBar,
  waitForBar,
  type Page,
} from '../support/devtools';
import { captureController, launchInspected, pressCommand, signOut } from '../support/main-process';
import { startOdooServer, type OdooServer } from '../support/odoo-server';

let electronBinary = '';

// In plain Node.js, require('electron') returns the binary path and downloads
// the binary on first use. The hook keeps that download out of the test timeout.
before(() => {
  if (process.platform === 'darwin') electronBinary = require('electron');
});

const crmLogin = '/web/login?redirect=%2Fodoo%2Fcrm';
const discussLogin = '/web/login?redirect=%2Fodoo%2Fdiscuss';

/** Sends the form of the login page. The timeout lets the evaluation answer before the page goes. */
function logIn(page: Page): Promise<unknown> {
  return evaluate(page, `setTimeout(() => document.getElementById('login').requestSubmit(), 0); true`);
}

/** Clicks Discuss in the app bar. */
function showDiscuss(bar: Page): Promise<unknown> {
  return evaluate(bar, `setTimeout(() => document.querySelector('[data-app-id="discuss"]').click(), 0); true`);
}

interface Running {
  readonly app: ChildProcess;
  readonly main: Page;
  readonly port: number;
  readonly bar: Page;
}

/**
 * Starts OdooBar on `userDataDir`, starts it again so the window opens, and
 * returns once the app bar is drawn. The caller stops `app`.
 */
async function openWindow(userDataDir: string, started: (app: ChildProcess) => void): Promise<Running> {
  const { app, main } = await launchInspected(
    electronBinary,
    [projectRoot, '--remote-debugging-port=0', '--lang=en'],
    userDataDir,
  );
  started(app);
  await captureController(main);
  const port = await devtoolsPort(userDataDir, 30_000);
  const again = launch(electronBinary, [projectRoot], userDataDir);
  try {
    assert.equal(await waitForExit(again, 15_000), 0);
  } finally {
    await stop(again);
  }
  return { app, main, port, bar: await waitForBar(port) };
}

interface Profile {
  readonly server: OdooServer;
  readonly userDataDir: string;
  /** Starts OdooBar on the profile, also a second time after `quit`. */
  open(): Promise<Running>;
  /** Ends the running OdooBar the way a user does, and checks that it quit in order. */
  quit(): Promise<void>;
}

/**
 * Runs `run` against an OdooServer that asks for a login and a user data
 * directory with the apps CRM and Discuss of that server.
 */
async function withProfile(run: (profile: Profile) => Promise<void>): Promise<void> {
  const server = await startOdooServer(0, { login: true });
  const userDataDir = makeUserDataDir();
  let app: ChildProcess | undefined;
  try {
    writeConfig(
      userDataDir,
      JSON.stringify({
        baseUrl: server.baseUrl,
        apps: [
          { id: 'crm', name: 'CRM', url: '/odoo/crm' },
          { id: 'discuss', name: 'Discuss', url: '/odoo/discuss' },
        ],
      }),
    );
    await run({
      server,
      userDataDir,
      open: () =>
        openWindow(userDataDir, (started) => {
          app = started;
        }),
      quit: async () => {
        assert.ok(app);
        app.kill('SIGTERM');
        assert.equal(await waitForExit(app, 10_000), 0);
      },
    });
  } finally {
    if (app) await stop(app);
    await server.close();
    removeUserDataDir(userDataDir);
  }
}

test('one login covers every app', macOnly, async () => {
  await withProfile(async ({ server, userDataDir, open }) => {
    const { main, port, bar } = await open();
    await logIn(await loadedPage(port, crmLogin));
    await loadedPage(port, '/odoo/crm');
    await showDiscuss(bar);
    await loadedPage(port, '/odoo/discuss');
    assert.deepEqual(server.requests, ['/odoo/crm', crmLogin, `POST ${crmLogin}`, '/odoo/crm', '/odoo/discuss']);

    // A view keeps its data on disk, apart from the app bar in the default session.
    const storagePath = (urlSuffix: string) =>
      evaluate(
        main,
        `process.mainModule.require('electron').webContents.getAllWebContents()
          .find((contents) => contents.getURL().endsWith(${JSON.stringify(urlSuffix)})).session.storagePath`,
      );
    const profile = realpathSync(userDataDir);
    assert.equal(await storagePath('/odoo/discuss'), join(profile, 'Partitions/odoo'));
    assert.equal(await storagePath('/renderer/app-bar.html'), profile);
  });
});

test('an app that still shows the login page opens on ⌘R after a login in another app', macOnly, async () => {
  await withProfile(async ({ server, open }) => {
    const { main, port, bar } = await open();
    await loadedPage(port, crmLogin);
    await showDiscuss(bar);
    await logIn(await loadedPage(port, discussLogin));
    await loadedPage(port, '/odoo/discuss');
    await pressCommand(main, '/odoo/discuss', '1');
    const crmActive = async () => (await readBar(bar)).apps.find((app) => app.active)?.id === 'crm';
    await eventually(crmActive, 'CRM to be active');

    server.requests.length = 0;
    await pressCommand(main, crmLogin, 'r');
    await loadedPage(port, '/odoo/crm');
    assert.deepEqual(server.requests, [crmLogin, '/odoo/crm']);
  });
});

test('a login survives a restart of OdooBar', macOnly, async () => {
  await withProfile(async ({ server, open, quit }) => {
    const first = await open();
    await logIn(await loadedPage(first.port, crmLogin));
    await loadedPage(first.port, '/odoo/crm');
    await quit();

    server.requests.length = 0;
    const second = await open();
    await loadedPage(second.port, '/odoo/crm');
    assert.deepEqual(server.requests, ['/odoo/crm']);
  });
});

test('the login page comes back when the login ends on the server', macOnly, async () => {
  await withProfile(async ({ server, open }) => {
    const { port } = await open();
    await logIn(await loadedPage(port, crmLogin));
    const crm = await loadedPage(port, '/odoo/crm');

    server.expireSessions();
    server.requests.length = 0;
    await evaluate(crm, 'setTimeout(() => location.reload(), 0); true');
    await logIn(await loadedPage(port, crmLogin));
    await loadedPage(port, '/odoo/crm');
    assert.deepEqual(server.requests, ['/odoo/crm', crmLogin, `POST ${crmLogin}`, '/odoo/crm']);
    assert.equal((await listPages(port)).length, 2);
  });
});

test('signing out deletes the login and what the pages stored, also for the next start', macOnly, async () => {
  await withProfile(async ({ server, open, quit }) => {
    const first = await open();
    await logIn(await loadedPage(first.port, crmLogin));
    const crm = await loadedPage(first.port, '/odoo/crm');
    await evaluate(crm, `localStorage.setItem('kept', 'yes'); true`);
    await quit();

    // Quitting wrote the login and the stored item to disk, where the sign-out has to delete them.
    const second = await open();
    const kept = await loadedPage(second.port, '/odoo/crm');
    assert.equal(await evaluate(kept, `localStorage.getItem('kept')`), 'yes');
    await showDiscuss(second.bar);
    await loadedPage(second.port, '/odoo/discuss');
    assert.equal((await listPages(second.port)).length, 3);

    server.requests.length = 0;
    await signOut(second.main);
    const login = await loadedPage(second.port, discussLogin);
    assert.equal(await evaluate(login, `localStorage.getItem('kept')`), null);
    assert.deepEqual(server.requests, ['/odoo/discuss', discussLogin]);
    // The views of both apps closed, and only the active app opened again.
    assert.equal((await listPages(second.port)).length, 2);
    await quit();

    server.requests.length = 0;
    const third = await open();
    const again = await loadedPage(third.port, crmLogin);
    assert.equal(await evaluate(again, `localStorage.getItem('kept')`), null);
    assert.deepEqual(server.requests, ['/odoo/crm', crmLogin]);
  });
});
