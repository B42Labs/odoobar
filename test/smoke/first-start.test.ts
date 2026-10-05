import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import {
  expectRunningAgentApp,
  isRunning,
  launch,
  macOnly,
  makeUserDataDir,
  projectRoot,
  removeUserDataDir,
  seededConfig,
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
  navigate,
  waitForPrompt,
  type Page,
} from '../support/devtools';

let electronBinary = '';

// In plain Node.js, require('electron') returns the binary path and downloads
// the binary on first use. The hook keeps that download out of the test timeout.
before(() => {
  if (process.platform === 'darwin') electronBinary = require('electron');
});

function textOf(page: Page, id: string): Promise<unknown> {
  return evaluate(page, `document.getElementById(${JSON.stringify(id)}).textContent`);
}

/** Types `value` and submits the form. It returns before the main process answers. */
function submit(page: Page, value: string): Promise<unknown> {
  return evaluate(
    page,
    `document.getElementById('base-url').value = ${JSON.stringify(value)}; document.getElementById('form').requestSubmit(); true`,
  );
}

test('first start asks for the Odoo URL and stores the seeded configuration', macOnly, async () => {
  const userDataDir = makeUserDataDir();
  const file = join(userDataDir, 'config.json');
  const app = launch(electronBinary, [projectRoot, '--remote-debugging-port=0', '--lang=en'], userDataDir);
  try {
    const { port, page } = await waitForPrompt(userDataDir);
    assert.equal(await textOf(page, 'title'), 'Welcome to OdooBar');
    assert.equal(await evaluate(page, 'document.activeElement.id'), 'base-url');

    await submit(page, 'ftp://odoo.example.com');
    const error = 'The address must start with http:// or https://.';
    await eventually(async () => (await textOf(page, 'error')) === error, 'the error message');
    assert.ok(!existsSync(file));

    await submit(page, ' odoo.example.com/ ');
    await eventually(() => existsSync(file), 'config.json');
    assert.equal(readFileSync(file, 'utf8'), seededConfig('Timesheets'));

    await eventually(
      async () => !(await listPages(port)).some((open) => open.url.endsWith('/renderer/first-start.html')),
      'the prompt to close',
    );
    await sleep(1_000);
    assert.ok(isRunning(app));
    app.kill('SIGTERM');
    assert.equal(await waitForExit(app, 10_000), 0);
  } finally {
    await stop(app);
    removeUserDataDir(userDataDir);
  }
});

test('first start uses German for a German locale', macOnly, async () => {
  const userDataDir = makeUserDataDir();
  const file = join(userDataDir, 'config.json');
  const app = launch(electronBinary, [projectRoot, '--remote-debugging-port=0', '--lang=de'], userDataDir);
  try {
    const { page } = await waitForPrompt(userDataDir);
    assert.equal(await textOf(page, 'title'), 'Willkommen bei OdooBar');
    assert.equal(await textOf(page, 'save'), 'Speichern');

    await submit(page, 'https://odoo.example.com');
    await eventually(() => existsSync(file), 'config.json');
    assert.equal(readFileSync(file, 'utf8'), seededConfig('Zeiterfassung'));
  } finally {
    await stop(app);
    removeUserDataDir(userDataDir);
  }
});

/**
 * Writes a page that the preload script would serve as the prompt, and that
 * submits its own address once it has loaded. Returns its URL.
 */
function writeOtherPage(userDataDir: string): string {
  const other = join(userDataDir, 'other.html');
  writeFileSync(
    other,
    `<form id="form"><input id="base-url" value="https://evil.example"></form>
<script>addEventListener('load', () => document.getElementById('form').requestSubmit());</script>`,
  );
  return pathToFileURL(other).href;
}

test('the first-start prompt does not navigate to another page', macOnly, async () => {
  const userDataDir = makeUserDataDir();
  const file = join(userDataDir, 'config.json');
  const other = writeOtherPage(userDataDir);
  const app = launch(electronBinary, [projectRoot, '--remote-debugging-port=0'], userDataDir);
  try {
    const { page } = await waitForPrompt(userDataDir);
    // A link or file dropped onto the window navigates the same way.
    await evaluate(page, `location.href = ${JSON.stringify(other)}; true`);
    await sleep(1_000);
    assert.match(String(await evaluate(page, 'location.href')), /\/renderer\/first-start\.html$/);
    assert.ok(!existsSync(file));
  } finally {
    await stop(app);
    removeUserDataDir(userDataDir);
  }
});

test('another page in the first-start window cannot store a configuration', macOnly, async () => {
  const userDataDir = makeUserDataDir();
  const file = join(userDataDir, 'config.json');
  const other = writeOtherPage(userDataDir);
  const app = launch(electronBinary, [projectRoot, '--remote-debugging-port=0'], userDataDir);
  try {
    const { page } = await waitForPrompt(userDataDir);
    // A page that the main process loads gets past will-navigate.
    await navigate(page, other);
    await sleep(1_000);
    assert.ok(!existsSync(file));
    assert.equal(await evaluate(page, 'location.href'), other);
  } finally {
    await stop(app);
    removeUserDataDir(userDataDir);
  }
});

test('starting OdooBar again brings the first-start prompt back to the front', macOnly, async () => {
  const userDataDir = makeUserDataDir();
  const otherDir = makeUserDataDir();
  const app = launch(electronBinary, [projectRoot, '--remote-debugging-port=0'], userDataDir);
  let other: ChildProcess | undefined;
  let again: ChildProcess | undefined;
  try {
    const { page } = await waitForPrompt(userDataDir);
    // An OdooBar with its own data shows its prompt in front of the first one.
    other = launch(electronBinary, [projectRoot, '--remote-debugging-port=0'], otherDir);
    await waitForPrompt(otherDir);
    await eventually(async () => (await evaluate(page, 'document.hasFocus()')) === false, 'the prompt to lose focus');

    again = launch(electronBinary, [projectRoot], userDataDir);
    assert.equal(await waitForExit(again, 15_000), 0);
    await eventually(async () => (await evaluate(page, 'document.hasFocus()')) === true, 'the prompt to get focus');
  } finally {
    if (again) await stop(again);
    if (other) await stop(other);
    await stop(app);
    removeUserDataDir(userDataDir);
    removeUserDataDir(otherDir);
  }
});

test('closing the first-start prompt quits without a configuration', macOnly, async () => {
  const userDataDir = makeUserDataDir();
  const app = launch(electronBinary, [projectRoot, '--remote-debugging-port=0'], userDataDir);
  try {
    const { page } = await waitForPrompt(userDataDir);
    // The timeout lets the evaluation answer before the window closes.
    await evaluate(page, `setTimeout(() => document.getElementById('quit').click(), 0); true`);
    assert.equal(await waitForExit(app, 10_000), 0);
    assert.ok(!existsSync(join(userDataDir, 'config.json')));
  } finally {
    await stop(app);
    removeUserDataDir(userDataDir);
  }
});

test('a stored configuration starts without a prompt and stays unchanged', macOnly, async () => {
  const userDataDir = makeUserDataDir();
  const file = writeConfig(userDataDir, storedConfig);
  const app = launch(electronBinary, [projectRoot, '--remote-debugging-port=0'], userDataDir);
  try {
    await expectRunningAgentApp(app);
    assert.deepEqual(await listPages(await devtoolsPort(userDataDir, 30_000)), []);
    assert.equal(readFileSync(file, 'utf8'), storedConfig);
  } finally {
    await stop(app);
    removeUserDataDir(userDataDir);
  }
});

test('an invalid configuration file stays untouched while the dialog is open', macOnly, async () => {
  const userDataDir = makeUserDataDir();
  const invalid = '{ "baseUrl": 5 }';
  const file = writeConfig(userDataDir, invalid);
  const app = launch(electronBinary, [projectRoot, '--remote-debugging-port=0'], userDataDir);
  try {
    await expectRunningAgentApp(app);
    assert.deepEqual(await listPages(await devtoolsPort(userDataDir, 30_000)), []);
    assert.equal(readFileSync(file, 'utf8'), invalid);
    assert.deepEqual(
      readdirSync(userDataDir).filter((name) => name.startsWith('config')),
      ['config.json'],
    );

    // The open dialog blocks the main process, which then ignores SIGTERM.
    app.kill('SIGKILL');
    await waitForExit(app, 5_000);
  } finally {
    await stop(app);
    removeUserDataDir(userDataDir);
  }
});
