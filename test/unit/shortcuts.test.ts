import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutFor, type KeyInput } from '../../src/main/shortcuts';

/** A key pressed together with ⌘ and no other modifier, unless `changes` says otherwise. */
function press(key: string, code: string, changes: Partial<KeyInput> = {}): KeyInput {
  return {
    type: 'keyDown',
    key,
    code,
    meta: true,
    control: false,
    alt: false,
    shift: false,
    isAutoRepeat: false,
    ...changes,
  };
}

test('shortcutFor maps ⌘1 to ⌘9 to the first to ninth app', () => {
  assert.deepEqual(shortcutFor(press('3', 'Digit3')), { kind: 'select', index: 2 });
  for (let digit = 1; digit <= 9; digit++) {
    assert.deepEqual(shortcutFor(press(String(digit), `Digit${digit}`)), { kind: 'select', index: digit - 1 });
  }
});

test('shortcutFor reads the digits from the key position', () => {
  // On a French layout, the key of 1 gives & without Shift.
  assert.deepEqual(shortcutFor(press('&', 'Digit1')), { kind: 'select', index: 0 });
  assert.equal(shortcutFor(press('1', 'Numpad1')), undefined);
  assert.equal(shortcutFor(press('0', 'Digit0')), undefined);
});

test('shortcutFor maps ⌘R, ⌘, and ⌘W', () => {
  assert.deepEqual(shortcutFor(press('r', 'KeyR')), { kind: 'reload' });
  assert.deepEqual(shortcutFor(press('R', 'KeyR')), { kind: 'reload' });
  assert.deepEqual(shortcutFor(press(',', 'Comma')), { kind: 'settings' });
  assert.deepEqual(shortcutFor(press('w', 'KeyW')), { kind: 'hide' });
});

test('shortcutFor ignores a key without ⌘ or with another modifier', () => {
  assert.equal(shortcutFor(press('r', 'KeyR', { meta: false })), undefined);
  assert.equal(shortcutFor(press('r', 'KeyR', { shift: true })), undefined);
  assert.equal(shortcutFor(press('r', 'KeyR', { alt: true })), undefined);
  assert.equal(shortcutFor(press('r', 'KeyR', { control: true })), undefined);
  assert.equal(shortcutFor(press('2', 'Digit2', { meta: false })), undefined);
});

test('shortcutFor ignores a released key, a held key, and every other key', () => {
  assert.equal(shortcutFor(press('r', 'KeyR', { type: 'keyUp' })), undefined);
  assert.equal(shortcutFor(press('r', 'KeyR', { isAutoRepeat: true })), undefined);
  assert.equal(shortcutFor(press('q', 'KeyQ')), undefined);
  assert.equal(shortcutFor(press('', '')), undefined);
});
