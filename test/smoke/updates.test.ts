import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  macOnly,
  makeUserDataDir,
  projectRoot,
  removeUserDataDir,
  stop,
  storedConfig,
  writeConfig,
} from '../support/app-process';
import { devtoolsPort, evaluate, eventually, readBar, waitForBar } from '../support/devtools';
import {
  captureController,
  desktopCalls,
  fetchReleaseJson,
  launchInspected,
  recordDesktopCalls,
  showUpdate,
} from '../support/main-process';

let electronBinary = '';

// In plain Node.js, require('electron') returns the binary path and downloads
// the binary on first use. The hook keeps that download out of the test timeout.
before(() => {
  if (process.platform === 'darwin') electronBinary = require('electron');
});

const releasePage = 'https://github.com/B42Labs/odoobar/releases/tag/v9.9.9';

test('the app bar shows the update button, and a click opens the release page', macOnly, async () => {
  const userDataDir = makeUserDataDir();
  let app: ChildProcess | undefined;
  try {
    writeConfig(userDataDir, storedConfig);
    const inspected = await launchInspected(
      electronBinary,
      [projectRoot, '--remote-debugging-port=0', '--lang=en'],
      userDataDir,
    );
    app = inspected.app;
    const { main } = inspected;
    await captureController(main);
    await recordDesktopCalls(main);
    const bar = await waitForBar(await devtoolsPort(userDataDir, 30_000));
    // Without an update the button stays hidden.
    assert.equal((await readBar(bar)).update, undefined);

    await eventually(async () => (await evaluate(main, 'globalThis.controller !== undefined')) === true, 'the controller');
    await showUpdate(main, { version: '9.9.9', url: releasePage });
    await eventually(async () => (await readBar(bar)).update === 'Update to 9.9.9', 'the update button');

    // The timeout lets the evaluation answer before the click moves the keys.
    await evaluate(bar, `setTimeout(() => document.getElementById('update').click(), 0); true`);
    await eventually(async () => (await desktopCalls(main)).length > 0, 'the release page to open');
    assert.deepEqual(await desktopCalls(main), [['openExternal', releasePage]]);
  } finally {
    if (app) await stop(app);
    removeUserDataDir(userDataDir);
  }
});

test('fetchReleaseJson gives the JSON document of an answer, undefined without one, and rejects without an answer', macOnly, async () => {
  const agents: (string | undefined)[] = [];
  const accepts: (string | undefined)[] = [];
  const server = createServer((request, response) => {
    agents.push(request.headers['user-agent']);
    accepts.push(request.headers.accept);
    if (request.url === '/release') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"tag_name":"v9.9.9"}');
    } else if (request.url === '/missing') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"message":"Not Found"}');
    } else {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>Page</title>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const userDataDir = makeUserDataDir();
  let app: ChildProcess | undefined;
  try {
    writeConfig(userDataDir, storedConfig);
    const inspected = await launchInspected(electronBinary, [projectRoot], userDataDir);
    app = inspected.app;
    const { main } = inspected;
    assert.deepEqual(await fetchReleaseJson(main, `${base}/release`), { value: { tag_name: 'v9.9.9' } });
    assert.deepEqual(await fetchReleaseJson(main, `${base}/missing`), {});
    assert.deepEqual(await fetchReleaseJson(main, `${base}/page`), {});
    // The GitHub API refuses a request without a user agent.
    assert.equal(agents.length, 3);
    assert.ok(agents.every((agent) => agent !== undefined && agent !== ''), JSON.stringify(agents));
    // The media type that GitHub recommends for its REST API, not the plain JSON that fetchOdooJson asks for.
    assert.deepEqual(accepts, Array(3).fill('application/vnd.github+json'));

    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    const { value, error } = await fetchReleaseJson(main, `${base}/release`);
    assert.equal(value, undefined);
    assert.match(error ?? '', /ERR_CONNECTION_REFUSED/);
  } finally {
    if (app) await stop(app);
    if (server.listening) {
      server.closeAllConnections();
      server.close();
    }
    removeUserDataDir(userDataDir);
  }
});
