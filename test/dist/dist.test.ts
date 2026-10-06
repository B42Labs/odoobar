import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  expectRunningAgentApp,
  iconCount,
  launch,
  makeUserDataDir,
  menuBarOwner,
  menuBarOwnerName,
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
  readBar,
  waitForBar,
  waitForPrompt,
  waitForSettings,
} from '../support/devtools';
import { appMenuLabels, closeWindow, iconImages, launchInspected } from '../support/main-process';

const { version } = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { version: string };
const appPath = join(projectRoot, 'dist/mac-arm64/OdooBar.app');
const executable = join(appPath, 'Contents/MacOS/OdooBar');
const infoPlist = join(appPath, 'Contents/Info.plist');
const dmg = join(projectRoot, `dist/OdooBar-${version}-arm64.dmg`);

before(() => {
  assert.ok(existsSync(appPath), `${appPath} is missing, run "npm run dist" first`);
});

test('dmg is intact and contains the app', () => {
  assert.ok(existsSync(dmg), `${dmg} is missing`);
  const verify = spawnSync('hdiutil', ['verify', dmg], { encoding: 'utf8' });
  assert.equal(verify.status, 0, verify.stderr);

  const mountPoint = mkdtempSync(join(tmpdir(), 'odoobar-dmg-'));
  try {
    execFileSync('hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mountPoint]);
    try {
      assert.ok(existsSync(join(mountPoint, 'OdooBar.app/Contents/MacOS/OdooBar')), `${dmg} lacks OdooBar.app`);
    } finally {
      // Spotlight or Gatekeeper can keep a freshly attached volume busy.
      if (spawnSync('hdiutil', ['detach', mountPoint]).status !== 0) {
        execFileSync('hdiutil', ['detach', '-force', mountPoint]);
      }
    }
  } finally {
    rmdirSync(mountPoint);
  }
});

test('Info.plist carries the bundle settings', () => {
  const read = (key: string) =>
    execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', infoPlist], { encoding: 'utf8' }).trim();
  assert.equal(read('CFBundleIdentifier'), 'com.b42labs.odoobar');
  assert.equal(read('CFBundleName'), 'OdooBar');
  assert.equal(read('CFBundleShortVersionString'), version);
  assert.equal(read('LSUIElement'), 'true');
  assert.equal(read('LSMinimumSystemVersion'), '13.0');
  assert.match(read('NSHumanReadableCopyright'), /^Copyright © \d{4} B42 Labs$/);
});

test('executable is arm64 only', () => {
  assert.equal(execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' }).trim(), 'arm64');
});

test('ad-hoc signature is valid', () => {
  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], { encoding: 'utf8' });
  assert.equal(verify.status, 0, verify.stderr);

  // codesign -dv writes the signature details to stderr.
  const details = spawnSync('codesign', ['-dv', appPath], { encoding: 'utf8' }).stderr.split('\n');
  assert.ok(details.includes('Signature=adhoc'), details.join('\n'));
  assert.ok(details.includes('Identifier=com.b42labs.odoobar'), details.join('\n'));
});

test('built app has a Dock icon only while its window is open', { timeout: 60_000 }, async () => {
  const userDataDir = makeUserDataDir();
  writeConfig(userDataDir, storedConfig);
  let app: ChildProcess | undefined;
  try {
    const inspected = await launchInspected(executable, [], userDataDir);
    app = inspected.app;
    // LSUIElement starts the app without the icon, and the window brings it.
    await waitForApplicationType(app, 'Foreground', 30_000);
    await closeWindow(inspected.main);
    await expectRunningAgentApp(app);
    app.kill('SIGTERM');
    assert.equal(await waitForExit(app, 10_000), 0);
  } finally {
    if (app) await stop(app);
    removeUserDataDir(userDataDir);
  }
});

test('built app names its menu after the bundle', { timeout: 60_000 }, async () => {
  const userDataDir = makeUserDataDir();
  writeConfig(userDataDir, storedConfig);
  let app: ChildProcess | undefined;
  try {
    const inspected = await launchInspected(executable, ['--lang=en'], userDataDir);
    app = inspected.app;
    const { pid } = app;
    await waitForApplicationType(app, 'Foreground', 30_000);
    await eventually(() => menuBarOwner() === pid, 'the menu bar to show the menu of OdooBar');
    // macOS takes the title of the first menu from this name.
    assert.equal(menuBarOwnerName(), 'OdooBar');
    assert.deepEqual(await appMenuLabels(inspected.main), ['OdooBar', 'Edit', 'View', 'Window']);
    assert.equal(await evaluate(inspected.main, `process.mainModule.require('electron').app.getVersion()`), version);
  } finally {
    if (app) await stop(app);
    removeUserDataDir(userDataDir);
  }
});

test('built app shows the first-start prompt when no configuration exists', { timeout: 60_000 }, async () => {
  const userDataDir = makeUserDataDir();
  const app = launch(executable, ['--remote-debugging-port=0'], userDataDir);
  try {
    await waitForPrompt(userDataDir);
  } finally {
    await stop(app);
    removeUserDataDir(userDataDir);
  }
});

test('built app opens its window, and a second start ends on the first', { timeout: 60_000 }, async () => {
  const userDataDir = makeUserDataDir();
  writeConfig(userDataDir, storedConfig);
  const app = launch(executable, ['--remote-debugging-port=0', '--lang=en'], userDataDir);
  let again: ChildProcess | undefined;
  try {
    const port = await devtoolsPort(userDataDir, 30_000);
    assert.equal((await readBar(await waitForBar(port))).notice, 'No apps are configured.');
    again = launch(executable, [], userDataDir);
    assert.equal(await waitForExit(again, 15_000), 0);
  } finally {
    if (again) await stop(again);
    await stop(app);
    removeUserDataDir(userDataDir);
  }
});

test('built app loads its menu bar icons from the bundle', { timeout: 60_000 }, async () => {
  const userDataDir = makeUserDataDir();
  let app: ChildProcess | undefined;
  try {
    writeConfig(userDataDir, storedConfig);
    const inspected = await launchInspected(executable, [], userDataDir);
    app = inspected.app;
    const appPath = await evaluate(inspected.main, `process.mainModule.require('electron').app.getAppPath()`);
    assert.match(String(appPath), /\/app\.asar$/);
    const [house, empty] = await iconImages(inspected.main, ['house', '']);
    assert.ok(house && empty);
    assert.deepEqual(house.size, { width: 18, height: 18 });
    assert.deepEqual(house.scaleFactors, [1, 2]);
    // A house that the bundle failed to deliver would be the fallback icon, as for an empty name.
    assert.notEqual(house.png, empty.png);
  } finally {
    if (app) await stop(app);
    removeUserDataDir(userDataDir);
  }
});

test('built app opens the settings window with every icon', { timeout: 60_000 }, async () => {
  const userDataDir = makeUserDataDir();
  writeConfig(userDataDir, storedConfig);
  const app = launch(executable, ['--remote-debugging-port=0', '--lang=en'], userDataDir);
  try {
    const port = await devtoolsPort(userDataDir, 30_000);
    const bar = await waitForBar(port);
    // The timeouts let the evaluations answer before the clicks change the screen.
    await evaluate(bar, `setTimeout(() => document.getElementById('settings').click(), 0); true`);
    const settings = await waitForSettings(port);
    assert.equal(await evaluate(settings, `document.querySelectorAll('#icon-grid button').length`), iconCount());
    // A new app has no icon, so its row shows the fallback icon, which the page loads from app.asar.
    await evaluate(settings, `setTimeout(() => document.getElementById('add').click(), 0); true`);
    await eventually(
      async () => (await evaluate(settings, `document.getElementById('app-picker').open`)) === true,
      'the choice of apps',
    );
    await evaluate(settings, `setTimeout(() => document.getElementById('blank-app').click(), 0); true`);
    const width = `(() => {
      const image = document.querySelector('#apps .app button.icon img');
      return image !== null && image.complete ? image.naturalWidth : 0;
    })()`;
    await eventually(async () => (await evaluate(settings, width)) === 18, 'an icon image to load from the bundle');
  } finally {
    await stop(app);
    removeUserDataDir(userDataDir);
  }
});
