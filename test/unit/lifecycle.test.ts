import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, type LifecycleApp } from '../../src/main/lifecycle';

function fakeApp({ lock, dock }: { lock: boolean; dock: boolean }) {
  const calls: string[] = [];
  let stored: (() => void) | undefined;
  const app: LifecycleApp = {
    requestSingleInstanceLock() {
      calls.push('lock');
      return lock;
    },
    quit() {
      calls.push('quit');
    },
    on(event, listener) {
      calls.push(`on:${event}`);
      stored = listener;
    },
    ...(dock ? { dock: { hide() { calls.push('dock.hide'); } } } : {}),
  };
  return { app, calls, registeredListener: () => stored };
}

test('first instance hides the Dock icon and keeps running without windows', () => {
  const { app, calls, registeredListener } = fakeApp({ lock: true, dock: true });

  assert.equal(startApp(app), true);
  assert.deepEqual(calls, ['lock', 'dock.hide', 'on:window-all-closed']);

  const onAllClosed = registeredListener();
  assert.ok(onAllClosed);
  onAllClosed();
  assert.ok(!calls.includes('quit'));
});

test('second instance quits without touching the Dock or the listeners', () => {
  const { app, calls } = fakeApp({ lock: false, dock: true });

  assert.equal(startApp(app), false);
  assert.deepEqual(calls, ['lock', 'quit']);
});

test('runs where app.dock is undefined', () => {
  const { app, calls } = fakeApp({ lock: true, dock: false });

  assert.equal(startApp(app), true);
  assert.deepEqual(calls, ['lock', 'on:window-all-closed']);
});
