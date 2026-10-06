import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInstalledRun, type InstalledApp } from '../../src/main/installed-run';

/** Stands in for Electron's app. By default it is the installed app, started without --user-data-dir. */
function fakeApp({ isPackaged = true, userDataDir = false } = {}): InstalledApp {
  return { isPackaged, commandLine: { hasSwitch: (name) => userDataDir && name === 'user-data-dir' } };
}

test('isInstalledRun is true only for the installed app outside a test run', () => {
  assert.equal(isInstalledRun(fakeApp()), true);
  assert.equal(isInstalledRun(fakeApp({ isPackaged: false })), false);
  assert.equal(isInstalledRun(fakeApp({ userDataDir: true })), false);
});
