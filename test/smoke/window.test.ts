import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import {
  isRunning,
  launch,
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
  devtoolsPort,
  evaluate,
  eventually,
  listPages,
  loadedPage,
  navigate,
  readBar,
  waitForBar,
  waitForPage,
  waitForPrompt,
  type Bar,
  type Page,
} from '../support/devtools';
import {
  closeWindow,
  desktopCalls,
  launchInspected,
  pressCommand,
  recordDesktopCalls,
  resizeWindow,
} from '../support/main-process';
import { startOdooServer, type OdooServer } from '../support/odoo-server';

let electronBinary = '';

// In plain Node.js, require('electron') returns the binary path and downloads
// the binary on first use. The hook keeps that download out of the test timeout.
before(() => {
  if (process.platform === 'darwin') electronBinary = require('electron');
});

/** A config.json with the apps CRM and Discuss of the instance at `baseUrl`. */
function twoApps(baseUrl: string): string {
  return JSON.stringify({
    baseUrl,
    apps: [
      { id: 'crm', name: 'CRM', url: '/odoo/crm' },
      { id: 'discuss', name: 'Discuss', url: '/odoo/discuss' },
    ],
  });
}

/** Starts OdooBar again, as a user does to bring its window to the front. */
async function startAgain(userDataDir: string): Promise<void> {
  const again = launch(electronBinary, [projectRoot], userDataDir);
  try {
    assert.equal(await waitForExit(again, 15_000), 0);
  } finally {
    await stop(again);
  }
}

/** Clicks the element. The timeout lets the evaluation answer before the click changes the page. */
function click(page: Page, selector: string): Promise<unknown> {
  return evaluate(page, `setTimeout(() => document.querySelector(${JSON.stringify(selector)}).click(), 0); true`);
}

function activeApp(bar: Bar): string | undefined {
  return bar.apps.find((app) => app.active)?.id;
}

function isActive(page: Page, id: string): Promise<boolean> {
  return readBar(page).then((bar) => activeApp(bar) === id);
}

const noteOf = (page: Page) => evaluate(page, `document.getElementById('note').value`);

interface Running {
  readonly server: OdooServer;
  readonly userDataDir: string;
  readonly app: ChildProcess;
  readonly main: Page;
  readonly port: number;
  readonly bar: Page;
}

/**
 * Runs OdooBar with the configuration that `config` returns for the address
 * of a fresh OdooServer and passes everything to `run` once the app bar is
 * drawn.
 */
async function withWindow(config: (baseUrl: string) => string, run: (running: Running) => Promise<void>): Promise<void> {
  const server = await startOdooServer();
  const userDataDir = makeUserDataDir();
  let app: ChildProcess | undefined;
  try {
    writeConfig(userDataDir, config(server.baseUrl));
    const inspected = await launchInspected(
      electronBinary,
      [projectRoot, '--remote-debugging-port=0', '--lang=en'],
      userDataDir,
    );
    app = inspected.app;
    await recordDesktopCalls(inspected.main);
    const port = await devtoolsPort(userDataDir, 30_000);
    const bar = await waitForBar(port);
    await run({ server, userDataDir, app, main: inspected.main, port, bar });
  } finally {
    if (app) await stop(app);
    await server.close();
    removeUserDataDir(userDataDir);
  }
}

test('a first start opens the window on the first app and loads no other', macOnly, async () => {
  const server = await startOdooServer();
  const userDataDir = makeUserDataDir();
  const app = launch(electronBinary, [projectRoot, '--remote-debugging-port=0', '--lang=en'], userDataDir);
  try {
    const { port, page } = await waitForPrompt(userDataDir);
    await evaluate(
      page,
      `document.getElementById('base-url').value = ${JSON.stringify(server.baseUrl)}; document.getElementById('form').requestSubmit(); true`,
    );
    const bar = await waitForBar(port);
    await waitForPage(port, '/odoo', 5_000);
    const state = await readBar(bar);
    assert.deepEqual(state.apps, [
      { id: 'home', name: 'Home', active: true },
      { id: 'timesheets', name: 'Timesheets', active: false },
    ]);
    assert.equal(state.notice, undefined);
    assert.equal(state.visible, true);
    assert.deepEqual(server.requests, ['/odoo']);
    assert.equal((await listPages(port)).length, 2);
  } finally {
    await stop(app);
    await server.close();
    removeUserDataDir(userDataDir);
  }
});

test('a later start opens the window on the first app and loads no other', macOnly, async () => {
  const server = await startOdooServer();
  const userDataDir = makeUserDataDir();
  writeConfig(userDataDir, twoApps(server.baseUrl));
  const app = launch(electronBinary, [projectRoot, '--remote-debugging-port=0', '--lang=en'], userDataDir);
  try {
    const port = await devtoolsPort(userDataDir, 30_000);
    const bar = await waitForBar(port);
    await waitForPage(port, '/odoo/crm', 5_000);
    const state = await readBar(bar);
    assert.deepEqual(state.apps, [
      { id: 'crm', name: 'CRM', active: true },
      { id: 'discuss', name: 'Discuss', active: false },
    ]);
    assert.equal(state.visible, true);
    assert.deepEqual(server.requests, ['/odoo/crm']);
  } finally {
    await stop(app);
    await server.close();
    removeUserDataDir(userDataDir);
  }
});

test('switching apps keeps the page of each app', macOnly, async () => {
  await withWindow(twoApps, async ({ server, port, bar }) => {
    const crm = await loadedPage(port, '/odoo/crm');
    await evaluate(crm, `document.getElementById('note').value = 'kept'; true`);

    await click(bar, '[data-app-id="discuss"]');
    const discuss = await loadedPage(port, '/odoo/discuss');
    await eventually(() => isActive(bar, 'discuss'), 'Discuss to be active');
    await eventually(async () => (await evaluate(discuss, 'document.hasFocus()')) === true, 'Discuss to have the focus');
    assert.equal(await evaluate(crm, 'document.visibilityState'), 'hidden');

    await click(bar, '[data-app-id="crm"]');
    await eventually(() => isActive(bar, 'crm'), 'CRM to be active');
    await eventually(async () => (await evaluate(crm, 'document.visibilityState')) === 'visible', 'CRM to show');
    assert.equal(await noteOf(crm), 'kept');
    assert.deepEqual(server.requests, ['/odoo/crm', '/odoo/discuss']);
  });
});

test('a view fills the window below the app bar and follows its size', macOnly, async () => {
  await withWindow(twoApps, async ({ main, port, bar }) => {
    const size = (page: Page) => evaluate(page, 'innerWidth + "x" + innerHeight');
    const crm = await loadedPage(port, '/odoo/crm');
    await resizeWindow(main, 900, 600);
    await eventually(async () => (await size(crm)) === '900x560', 'the CRM view to follow the window');
    assert.equal(await size(bar), '900x600');
    assert.equal(await evaluate(bar, `document.querySelector('nav').getBoundingClientRect().height`), 40);

    await click(bar, '[data-app-id="discuss"]');
    const discuss = await loadedPage(port, '/odoo/discuss');
    await eventually(async () => (await size(discuss)) === '900x560', 'the Discuss view to fill the window');
  });
});

test('the window shortcuts switch between apps and reload the active one', macOnly, async () => {
  await withWindow(twoApps, async ({ server, main, port, bar }) => {
    const crm = await loadedPage(port, '/odoo/crm');
    await evaluate(crm, `window.keys = []; addEventListener('keydown', (event) => window.keys.push(event.key)); true`);

    await pressCommand(main, '/odoo/crm', '2');
    await eventually(() => isActive(bar, 'discuss'), 'Discuss to be active');
    assert.deepEqual(await evaluate(crm, 'window.keys'), []);

    await pressCommand(main, '/renderer/app-bar.html', '1');
    await eventually(() => isActive(bar, 'crm'), 'CRM to be active');

    // There is no ninth app.
    await pressCommand(main, '/odoo/crm', '9');
    await sleep(500);
    assert.equal(activeApp(await readBar(bar)), 'crm');
    assert.deepEqual(server.requests, ['/odoo/crm', '/odoo/discuss']);

    await pressCommand(main, '/odoo/crm', 'r');
    await eventually(() => server.requests.length === 3, 'CRM to reload');
    assert.deepEqual(server.requests, ['/odoo/crm', '/odoo/discuss', '/odoo/crm']);
  });
});

test('hiding the window keeps OdooBar running and every page as it was', macOnly, async () => {
  await withWindow(twoApps, async ({ server, userDataDir, app, main, port, bar }) => {
    const crm = await loadedPage(port, '/odoo/crm');
    await evaluate(crm, `document.getElementById('note').value = 'kept'; true`);
    const visible = async () => (await readBar(bar)).visible;

    await pressCommand(main, '/odoo/crm', 'w');
    await eventually(async () => !(await visible()), 'the window to hide on ⌘W');
    await startAgain(userDataDir);
    await eventually(visible, 'the window to come back');
    await eventually(async () => (await evaluate(crm, 'document.hasFocus()')) === true, 'CRM to have the focus');

    await closeWindow(main);
    await eventually(async () => !(await visible()), 'the window to hide on its close button');
    await startAgain(userDataDir);
    await eventually(visible, 'the window to come back again');

    assert.equal(await noteOf(crm), 'kept');
    assert.deepEqual(server.requests, ['/odoo/crm']);
    assert.ok(isRunning(app));
    app.kill('SIGTERM');
    assert.equal(await waitForExit(app, 10_000), 0);
  });
});

test('a page on another origin stays in the view, and a click on the active app leads back', macOnly, async () => {
  await withWindow(twoApps, async ({ server, main, port, bar }) => {
    // Stands in for the identity provider of a single sign-on login.
    const provider = await startOdooServer();
    try {
      const crm = await loadedPage(port, '/odoo/crm');
      await evaluate(crm, `location.href = ${JSON.stringify(`${provider.baseUrl}/login`)}; true`);
      await waitForPage(port, `${provider.baseUrl}/login`, 5_000);
      assert.equal((await listPages(port)).length, 2);
      assert.deepEqual(await desktopCalls(main), []);

      await click(bar, '[data-app-id="crm"]');
      await eventually(() => server.requests.length === 2, 'the start address of CRM to load');
      assert.deepEqual(server.requests, ['/odoo/crm', '/odoo/crm']);
      assert.deepEqual(provider.requests, ['/login']);
    } finally {
      await provider.close();
    }
  });
});

test('only a page of the instance gets a permission, a page on another origin does not', macOnly, async () => {
  await withWindow(twoApps, async ({ port, bar }) => {
    const other = await startOdooServer();
    try {
      // Asking for a permission and checking it take different ways through Electron.
      const notifications = `Promise.all([
        Notification.requestPermission(),
        navigator.permissions.query({ name: 'notifications' }).then((status) => status.state),
      ])`;
      const crm = await loadedPage(port, '/odoo/crm');
      assert.deepEqual(await evaluate(crm, notifications), ['granted', 'granted']);

      await evaluate(crm, `location.href = ${JSON.stringify(`${other.baseUrl}/page`)}; true`);
      const page = await loadedPage(port, `${other.baseUrl}/page`);
      assert.deepEqual(await evaluate(page, notifications), ['denied', 'denied']);
      // The app bar is in the default session, which has no page of the instance.
      assert.deepEqual(await evaluate(bar, notifications), ['denied', 'denied']);
    } finally {
      await other.close();
    }
  });
});

test('a page of the instance finds no push service to subscribe to', macOnly, async () => {
  await withWindow(twoApps, async ({ port }) => {
    const crm = await loadedPage(port, '/odoo/crm');
    // Odoo subscribes this way once it may show notifications, and shows a failure in a red box.
    // Electron has no push service, so every subscription would fail.
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    const subscribe = `navigator.serviceWorker.register('/web/service-worker.js', { scope: '/odoo' })
      .then(() => navigator.serviceWorker.ready)
      .then(({ pushManager }) => pushManager
        ? pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ${JSON.stringify(key)} })
            .then(() => 'subscribed', (error) => error.message)
        : 'no push manager')`;
    assert.equal(await evaluate(crm, subscribe), 'no push manager');
    assert.equal(await evaluate(crm, 'Notification.permission'), 'granted');
  });
});

test('a view loads no page off the web and hands a mail link to the system', macOnly, async () => {
  await withWindow(twoApps, async ({ server, main, port }) => {
    const crm = await loadedPage(port, '/odoo/crm');
    await evaluate(crm, `document.getElementById('note').value = 'kept'; true`);
    // A file dropped onto the view leaves the web the same way, which a test cannot do.
    await evaluate(crm, `location.href = URL.createObjectURL(new Blob(['<p>other</p>'], { type: 'text/html' })); true`);
    // Time for the page to go, which it must not.
    await sleep(1_000);
    assert.equal(await evaluate(crm, 'location.href'), `${server.baseUrl}/odoo/crm`);

    await evaluate(crm, `location.href = 'mailto:someone@external.example'; true`);
    await eventually(async () => (await desktopCalls(main)).length > 0, 'the mail link to reach the system');
    assert.deepEqual(await desktopCalls(main), [['openExternal', 'mailto:someone@external.example']]);
    assert.equal(await noteOf(crm), 'kept');
    assert.equal((await listPages(port)).length, 2);
  });
});

test('a redirect or a frame hands an address off the web to the system only as a link would', macOnly, async () => {
  await withWindow(twoApps, async ({ server, main, port }) => {
    const crm = await loadedPage(port, '/odoo/crm');
    // Neither raises 'will-navigate', and a page on another origin may use both.
    const leave = async (query: string, address: string) => {
      const path = `/odoo/off?${query}=${encodeURIComponent(address)}`;
      await evaluate(crm, `location.href = ${JSON.stringify(path)}; true`);
      await eventually(() => server.requests.includes(path), `${path} to be asked for`);
    };
    for (const query of ['redirect', 'frame']) {
      await leave(query, `mailto:${query}@external.example`);
      await eventually(
        async () => (await desktopCalls(main)).some(([, url]) => url === `mailto:${query}@external.example`),
        `the mail link of the ${query} to reach the system`,
      );
    }
    for (const query of ['redirect', 'frame']) {
      await leave(query, `odoobar-test:${query}`);
      // Time for a call, which must not come.
      await sleep(500);
    }
    assert.deepEqual(await desktopCalls(main), [
      ['openExternal', 'mailto:redirect@external.example'],
      ['openExternal', 'mailto:frame@external.example'],
    ]);
  });
});

test('a view that its page closes opens again at the start address', macOnly, async () => {
  await withWindow(twoApps, async ({ server, port, bar }) => {
    const crm = await loadedPage(port, '/odoo/crm');
    await evaluate(crm, 'setTimeout(() => window.close(), 0); true');
    await eventually(() => server.requests.length === 2, 'CRM to open again');
    assert.deepEqual(server.requests, ['/odoo/crm', '/odoo/crm']);
    assert.equal((await readBar(bar)).notice, undefined);
    assert.equal((await listPages(port)).length, 2);
  });
});

test('a link to a new tab loads in the view inside the instance and opens the browser outside it', macOnly, async () => {
  await withWindow(twoApps, async ({ main, port }) => {
    const crm = await loadedPage(port, '/odoo/crm');
    await click(crm, '#new-tab');
    const linked = await loadedPage(port, '/odoo/linked');
    assert.equal((await listPages(port)).length, 2);
    assert.deepEqual(await desktopCalls(main), []);

    const hrefs = ['https://external.example/x?y=1', 'mailto:someone@external.example', 'file:///etc/hosts'];
    await evaluate(
      linked,
      `for (const href of ${JSON.stringify(hrefs)}) {
        const link = document.createElement('a');
        link.target = '_blank';
        link.href = href;
        document.body.append(link);
        link.click();
      }
      true`,
    );
    await eventually(async () => (await desktopCalls(main)).length >= 2, 'the browser to be asked');
    // Time for a call for the third link, which must not come.
    await sleep(500);
    assert.deepEqual(await desktopCalls(main), [
      ['openExternal', 'https://external.example/x?y=1'],
      ['openExternal', 'mailto:someone@external.example'],
    ]);
    assert.equal((await listPages(port)).length, 2);
    assert.equal(await evaluate(linked, 'location.pathname'), '/odoo/linked');
  });
});

test('the settings entry and its shortcut reveal config.json', macOnly, async () => {
  await withWindow(twoApps, async ({ userDataDir, main, port, bar }) => {
    await waitForPage(port, '/odoo/crm', 5_000);
    // The app reports the directory without the /var symlink of macOS.
    const file = join(realpathSync(userDataDir), 'config.json');

    await click(bar, '#settings');
    await eventually(async () => (await desktopCalls(main)).length === 1, 'the settings entry to reveal the file');
    await pressCommand(main, '/odoo/crm', ',');
    await eventually(async () => (await desktopCalls(main)).length === 2, 'the shortcut to reveal the file');
    assert.deepEqual(await desktopCalls(main), [
      ['showItemInFolder', file],
      ['showItemInFolder', file],
    ]);
    assert.equal(await evaluate(bar, `document.getElementById('settings').title`), 'Settings');
  });
});

test('a page that does not load shows a notice and loads on a retry', macOnly, async () => {
  // Nothing listens on the address of a closed server.
  const closed = await startOdooServer();
  await closed.close();
  await withWindow(
    () => twoApps(closed.baseUrl),
    async ({ port, bar }) => {
      const notice = `CRM could not be loaded.\n\n${closed.baseUrl}/odoo/crm\nERR_CONNECTION_REFUSED`;
      await eventually(async () => (await readBar(bar)).notice === notice, 'the notice');
      assert.equal((await readBar(bar)).retry, true);
      assert.equal(await evaluate(bar, `document.getElementById('retry').textContent`), 'Try again');

      const server = await startOdooServer(closed.port);
      try {
        await click(bar, '#retry');
        await eventually(async () => (await readBar(bar)).notice === undefined, 'the notice to go');
        const crm = await loadedPage(port, '/odoo/crm');
        assert.equal(await evaluate(crm, `document.getElementById('path').textContent`), '/odoo/crm');
        assert.deepEqual(server.requests, ['/odoo/crm']);
      } finally {
        await server.close();
      }
    },
  );
});

test('a frame that does not load leaves its page in the view', macOnly, async () => {
  // Nothing listens on the address of a closed server.
  const closed = await startOdooServer();
  await closed.close();
  const framed = `/odoo/crm?frame=${encodeURIComponent(closed.baseUrl)}`;
  await withWindow(
    (baseUrl) => JSON.stringify({ baseUrl, apps: [{ id: 'crm', name: 'CRM', url: framed }] }),
    async ({ port, bar }) => {
      const crm = await loadedPage(port, framed);
      await eventually(async () => (await evaluate(crm, 'window.framed')) === true, 'the frame to fail');
      // Time for a notice, which must not come.
      await sleep(500);
      assert.equal((await readBar(bar)).notice, undefined);
    },
  );
});

test('the app bar does not navigate to another page or open a window', macOnly, async () => {
  await withWindow(twoApps, async ({ userDataDir, main, port, bar }) => {
    await waitForPage(port, '/odoo/crm', 5_000);
    const other = join(userDataDir, 'other.html');
    writeFileSync(other, '<p>other</p>');
    // A link or file dropped onto the window navigates the same way.
    await evaluate(bar, `location.href = ${JSON.stringify(pathToFileURL(other).href)}; true`);
    await evaluate(bar, `window.open('https://external.example/x'); true`);
    // Time for another page or window, which must not come.
    await sleep(1_000);
    assert.match(String(await evaluate(bar, 'location.href')), /\/renderer\/app-bar\.html$/);
    assert.equal((await readBar(bar)).apps.length, 2);
    assert.equal((await listPages(port)).length, 2);
    assert.deepEqual(await desktopCalls(main), []);
  });
});

test('another page in the window cannot use the app bar channels', macOnly, async () => {
  await withWindow(twoApps, async ({ server, userDataDir, main, port, bar }) => {
    await waitForPage(port, '/odoo/crm', 5_000);
    // Counts the messages that reach the main process, whether refused or not.
    await evaluate(
      main,
      `globalThis.barMessages = 0;
      for (const channel of ['app-bar:settings', 'app-bar:retry'])
        process.mainModule.require('electron').ipcMain.on(channel, () => globalThis.barMessages++);
      true`,
    );
    // A page with the elements of the app bar gets its preload script as well.
    const other = join(userDataDir, 'other.html');
    writeFileSync(
      other,
      `<div id="apps"></div><button id="settings"></button>
<div id="notice"><p id="notice-text"></p><button id="retry"></button></div>
<script>addEventListener('load', () => {
  document.getElementById('settings').click();
  document.getElementById('retry').click();
});</script>`,
    );
    // A page that the main process loads gets past will-navigate.
    await navigate(bar, pathToFileURL(other).href);
    await eventually(async () => (await evaluate(main, 'globalThis.barMessages')) === 2, 'both messages to arrive');
    // Time for a reload of CRM, which must not come.
    await sleep(500);
    assert.deepEqual(await desktopCalls(main), []);
    assert.deepEqual(server.requests, ['/odoo/crm']);
    assert.equal(await evaluate(bar, `document.getElementById('apps').childElementCount`), 0);
    assert.equal((await listPages(port)).length, 2);
  });
});

test('an empty app list shows a notice and no app', macOnly, async () => {
  await withWindow(
    () => storedConfig,
    async ({ server, port, bar }) => {
      assert.deepEqual(await readBar(bar), {
        apps: [],
        notice: 'No apps are configured.',
        retry: false,
        visible: true,
      });
      assert.equal((await listPages(port)).length, 1);
      assert.deepEqual(server.requests, []);
    },
  );
});
