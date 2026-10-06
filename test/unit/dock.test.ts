import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dock, type DockUi } from '../../src/main/dock';

/** A Dock that records every call of its ui. */
function fakeDock() {
  const calls: string[] = [];
  const ui: DockUi = { show: () => calls.push('show'), hide: () => calls.push('hide') };
  return { dock: new Dock(ui), calls };
}

test('a Dock leaves the icon alone until a window opens', () => {
  const { dock, calls } = fakeDock();
  dock.closed('window');
  assert.deepEqual(calls, []);
});

test('the icon comes with the first window and goes with the last', () => {
  const { dock, calls } = fakeDock();
  dock.opened('window');
  assert.deepEqual(calls, ['show']);
  dock.opened('settings');
  dock.closed('window');
  assert.deepEqual(calls, ['show']);
  dock.closed('settings');
  assert.deepEqual(calls, ['show', 'hide']);
  dock.opened('settings');
  assert.deepEqual(calls, ['show', 'hide', 'show']);
});

test('a window that shows or hides twice counts once', () => {
  const { dock, calls } = fakeDock();
  dock.opened('window');
  dock.opened('window');
  dock.opened('settings');
  dock.closed('window');
  dock.closed('window');
  assert.deepEqual(calls, ['show']);
  dock.closed('settings');
  dock.closed('settings');
  assert.deepEqual(calls, ['show', 'hide']);
});
