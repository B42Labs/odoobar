import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncLoginItem, type LoginItemApp } from '../../src/main/login-item';

/** Stands in for macOS and records what syncLoginItem asks of it. */
function fakeApp({
  openAtLogin = false,
  isPackaged = true,
  userDataDir = false,
}: { openAtLogin?: boolean; isPackaged?: boolean; userDataDir?: boolean } = {}) {
  const calls: string[] = [];
  const app: LoginItemApp = {
    isPackaged,
    commandLine: { hasSwitch: (name) => userDataDir && name === 'user-data-dir' },
    getLoginItemSettings() {
      calls.push('get');
      return { openAtLogin };
    },
    setLoginItemSettings(settings) {
      calls.push(`set:${settings.openAtLogin}`);
    },
  };
  return { app, calls };
}

test('registers the login item when the flag is set', () => {
  const { app, calls } = fakeApp({ openAtLogin: false });
  syncLoginItem(app, true);
  assert.deepEqual(calls, ['get', 'set:true']);
});

test('removes the login item when the flag is cleared', () => {
  const { app, calls } = fakeApp({ openAtLogin: true });
  syncLoginItem(app, false);
  assert.deepEqual(calls, ['get', 'set:false']);
});

test('leaves a matching login item alone', () => {
  for (const state of [true, false]) {
    const { app, calls } = fakeApp({ openAtLogin: state });
    syncLoginItem(app, state);
    assert.deepEqual(calls, ['get'], `launchAtLogin ${state}`);
  }
});

test('never touches the login item of the development app', () => {
  const { app, calls } = fakeApp({ isPackaged: false });
  syncLoginItem(app, true);
  assert.deepEqual(calls, []);
});

test('never touches the login item under --user-data-dir', () => {
  const { app, calls } = fakeApp({ userDataDir: true });
  syncLoginItem(app, true);
  assert.deepEqual(calls, []);
});
