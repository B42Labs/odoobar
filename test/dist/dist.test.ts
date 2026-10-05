import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  expectRunningAgentApp,
  launch,
  makeUserDataDir,
  projectRoot,
  removeUserDataDir,
  stop,
  storedConfig,
  waitForExit,
  writeConfig,
} from '../support/app-process';
import { devtoolsPort, readBar, waitForBar, waitForPrompt } from '../support/devtools';

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

test('built app runs without a Dock icon', { timeout: 60_000 }, async () => {
  const userDataDir = makeUserDataDir();
  writeConfig(userDataDir, storedConfig);
  const app = launch(executable, [], userDataDir);
  try {
    await expectRunningAgentApp(app);
    app.kill('SIGTERM');
    assert.equal(await waitForExit(app, 10_000), 0);
  } finally {
    await stop(app);
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

test('built app opens its window when it is started again', { timeout: 60_000 }, async () => {
  const userDataDir = makeUserDataDir();
  writeConfig(userDataDir, storedConfig);
  const app = launch(executable, ['--remote-debugging-port=0', '--lang=en'], userDataDir);
  let again: ChildProcess | undefined;
  try {
    // The app holds the single-instance lock by the time it writes the port.
    const port = await devtoolsPort(userDataDir, 30_000);
    again = launch(executable, [], userDataDir);
    assert.equal(await waitForExit(again, 15_000), 0);
    assert.equal((await readBar(await waitForBar(port))).notice, 'No apps are configured.');
  } finally {
    if (again) await stop(again);
    await stop(app);
    removeUserDataDir(userDataDir);
  }
});
