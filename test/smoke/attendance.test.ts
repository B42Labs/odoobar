import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { macOnly, makeUserDataDir, projectRoot, removeUserDataDir, stop, writeConfig } from '../support/app-process';
import { devtoolsPort, evaluate, eventually, loadedPage, readBar, waitForBar, type Page } from '../support/devtools';
import { answerDialogs, dialogs, focusWindow, lastDialog, launchInspected } from '../support/main-process';
import { attendanceSettled, startOdooServer, type OdooServer, type OdooServerOptions } from '../support/odoo-server';

let electronBinary = '';

// In plain Node.js, require('electron') returns the binary path and downloads
// the binary on first use. The hook keeps that download out of the test timeout.
before(() => {
  if (process.platform === 'darwin') electronBinary = require('electron');
});

const STATE = 'POST /hr_attendance/attendance_user_data';
const TOGGLE = 'POST /hr_attendance/systray_check_in_out';

/** A config.json of a version without the attendance button, with the app CRM of the instance at `baseUrl`. */
function crmOnly(baseUrl: string): string {
  return JSON.stringify({ baseUrl, apps: [{ id: 'crm', name: 'CRM', url: '/odoo/crm' }] });
}

const crmLogin = '/web/login?redirect=%2Fodoo%2Fcrm';

/** Sends the form of the login page. The timeout lets the evaluation answer before the page goes. */
function logIn(page: Page): Promise<unknown> {
  return evaluate(page, `setTimeout(() => document.getElementById('login').requestSubmit(), 0); true`);
}

/** Clicks the element. The timeout lets the evaluation answer before the click changes the page. */
function click(page: Page, selector: string): Promise<unknown> {
  return evaluate(page, `setTimeout(() => document.querySelector(${JSON.stringify(selector)}).click(), 0); true`);
}

interface Running {
  readonly server: OdooServer;
  readonly main: Page;
  readonly port: number;
  readonly bar: Page;
}

/**
 * Runs OdooBar with the app CRM of a fresh OdooServer with these options and
 * passes everything to `run` once the app bar is drawn. Every message box is
 * answered at once with OK, so `dialogs` and `lastDialog` tell what it said.
 */
async function withAttendance(options: OdooServerOptions, run: (running: Running) => Promise<void>): Promise<void> {
  const server = await startOdooServer(0, options);
  const userDataDir = makeUserDataDir();
  let app: ChildProcess | undefined;
  try {
    writeConfig(userDataDir, crmOnly(server.baseUrl));
    const inspected = await launchInspected(
      electronBinary,
      [projectRoot, '--remote-debugging-port=0', '--lang=en'],
      userDataDir,
    );
    app = inspected.app;
    await answerDialogs(inspected.main, 0);
    const port = await devtoolsPort(userDataDir, 30_000);
    const bar = await waitForBar(port);
    await run({ server, main: inspected.main, port, bar });
  } finally {
    if (app) await stop(app);
    await server.close();
    removeUserDataDir(userDataDir);
  }
}

const attendanceOf = async (bar: Page) => (await readBar(bar)).attendance;

/** Waits until the button shows and the reads of the start have ended. Returns the number of requests so far. */
async function shownButton(server: OdooServer, bar: Page): Promise<number> {
  await eventually(async () => (await attendanceOf(bar)) !== undefined, 'the attendance button');
  return attendanceSettled(server);
}

test('a click checks in, and a second click checks out again', macOnly, async () => {
  await withAttendance({ attendance: {} }, async ({ server, main, bar }) => {
    const start = await shownButton(server, bar);
    assert.deepEqual(await attendanceOf(bar), { checkedIn: false, hint: 'Check in', enabled: true });

    await click(bar, '#attendance');
    await eventually(async () => (await attendanceOf(bar))?.checkedIn === true, 'the check-in');
    const checkedIn = await attendanceOf(bar);
    assert.match(checkedIn?.hint ?? '', /^Check out \(checked in since /);
    assert.equal(checkedIn?.enabled, true);
    // OdooBar's own change starts no read of its own.
    const afterCheckIn = await attendanceSettled(server);
    assert.deepEqual(server.attendanceRequests.slice(start), [STATE, TOGGLE, STATE]);

    await click(bar, '#attendance');
    await eventually(async () => (await attendanceOf(bar))?.checkedIn === false, 'the check-out');
    assert.deepEqual(await attendanceOf(bar), { checkedIn: false, hint: 'Check in', enabled: true });
    await attendanceSettled(server);
    assert.deepEqual(server.attendanceRequests.slice(afterCheckIn), [STATE, TOGGLE, STATE]);
    assert.deepEqual(await dialogs(main), []);
  });
});

test('the button is absent where attendance cannot work', macOnly, async () => {
  const options: [string, OdooServerOptions][] = [
    ['an instance without the attendance routes', {}],
    ['a user without an employee', { attendance: { employee: false } }],
    ['a company without the check-in in the top bar', { attendance: { systray: false } }],
  ];
  for (const [what, option] of options) {
    await withAttendance(option, async ({ server, port, bar }) => {
      await loadedPage(port, '/odoo/crm');
      await eventually(() => server.attendanceRequests.length > 0, 'a request about attendance');
      await attendanceSettled(server);
      assert.equal(await attendanceOf(bar), undefined, what);
      assert.ok(server.attendanceRequests.every((request) => request === STATE), what);
    });
  }
});

test('the button appears after the login without a further action', macOnly, async () => {
  await withAttendance({ login: true, attendance: {} }, async ({ server, port, bar }) => {
    const login = await loadedPage(port, crmLogin);
    await eventually(() => server.attendanceRequests.length > 0, 'a request about attendance');
    await attendanceSettled(server);
    assert.equal(await attendanceOf(bar), undefined);

    // Odoo answers only a request with the cookie of the login.
    await logIn(login);
    await loadedPage(port, '/odoo/crm');
    await eventually(async () => (await attendanceOf(bar))?.hint === 'Check in', 'the button after the login');
  });
});

test("Odoo's own check-in button in a view moves the icon", macOnly, async () => {
  await withAttendance({ attendance: {} }, async ({ server, port, bar }) => {
    const crm = await loadedPage(port, '/odoo/crm');
    await shownButton(server, bar);
    await evaluate(
      crm,
      `fetch('/hr_attendance/systray_check_in_out', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {} }),
      }).then((response) => response.ok)`,
    );
    await eventually(async () => (await attendanceOf(bar))?.checkedIn === true, 'the icon to follow');
  });
});

test('a click on an outdated icon sends no change and only updates the icon', macOnly, async () => {
  await withAttendance({ attendance: {} }, async ({ server, main, bar }) => {
    const start = await shownButton(server, bar);
    // A check-in on a phone, which OdooBar has not heard of.
    server.setAttendance(true);
    await click(bar, '#attendance');
    await eventually(async () => (await attendanceOf(bar))?.checkedIn === true, 'the icon to follow');
    // Time for a change, which must not come.
    await sleep(500);
    assert.ok(!server.attendanceRequests.slice(start).includes(TOGGLE));
    assert.deepEqual(await dialogs(main), []);
    assert.equal((await attendanceOf(bar))?.checkedIn, true);
  });
});

test('the focus of the window reads the state', macOnly, async () => {
  await withAttendance({ attendance: {} }, async ({ server, main, bar }) => {
    await shownButton(server, bar);
    server.setAttendance(true);
    await focusWindow(main);
    await eventually(async () => (await attendanceOf(bar))?.checkedIn === true, 'the icon to follow');
  });
});

test('a check-in that Odoo refuses is reported in a sheet, and the icon stays', macOnly, async () => {
  await withAttendance({ attendance: {} }, async ({ server, main, bar }) => {
    await shownButton(server, bar);
    server.failToggle('You cannot check in today.');
    await click(bar, '#attendance');
    await eventually(async () => (await dialogs(main)).length === 1, 'the sheet');
    const sheet = await lastDialog(main);
    assert.equal(sheet?.message, 'OdooBar could not check you in');
    assert.equal(sheet?.detail, 'You cannot check in today.');
    // No buttons, so macOS shows OK.
    assert.equal(sheet?.buttons, undefined);
    await eventually(async () => (await attendanceOf(bar))?.enabled === true, 'the end of the click');
    assert.deepEqual(await attendanceOf(bar), { checkedIn: false, hint: 'Check in', enabled: true });
  });
});

test('a click after the login expired is reported in a sheet and removes the button', macOnly, async () => {
  await withAttendance({ login: true, attendance: {} }, async ({ server, main, port, bar }) => {
    await logIn(await loadedPage(port, crmLogin));
    await loadedPage(port, '/odoo/crm');
    await shownButton(server, bar);
    server.expireSessions();
    await click(bar, '#attendance');
    await eventually(async () => (await dialogs(main)).length === 1, 'the sheet');
    assert.equal((await lastDialog(main))?.detail, 'Sign in to Odoo in the OdooBar window first.');
    await eventually(async () => (await attendanceOf(bar)) === undefined, 'the button to go');
  });
});
