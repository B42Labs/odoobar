import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, type AppConfig, type Config } from '../../src/main/config';
import {
  GlobalShortcuts,
  isAccelerator,
  type GlobalShortcutsUi,
  type ShortcutStatus,
} from '../../src/main/global-shortcuts';

const B = 'https://odoo.example.com';

function entry(id: string, shortcut: string): AppConfig {
  return { id, name: id, url: `/odoo/${id}`, icon: '', shortcut, menuBar: false };
}

const crm = entry('crm', 'Control+Alt+C');
const discuss = entry('discuss', '');
const calendar = entry('calendar', 'Control+Alt+K');
const three: Config = { baseUrl: B, launchAtLogin: false, apps: [crm, discuss, calendar] };

/**
 * A system that records every call and answers each register with `answer`.
 * It keeps the callback of every shortcut it registered in `held`, and `press`
 * calls it the way macOS reports a press. `take` returns the calls since the
 * last `take`, and `pressed` lists the ids that the presses handed on.
 */
function fakeSystem(answer: (accelerator: string) => ShortcutStatus = () => 'registered') {
  let calls: string[] = [];
  const held = new Map<string, () => void>();
  const pressed: string[] = [];
  const ui: GlobalShortcutsUi = {
    register(accelerator, press) {
      calls.push(`register ${accelerator}`);
      const status = answer(accelerator);
      if (status === 'registered') held.set(accelerator, press);
      return status;
    },
    unregisterAll() {
      calls.push('unregisterAll');
      held.clear();
    },
  };
  const start = (config: Config) => new GlobalShortcuts(ui, (id) => pressed.push(id), config);
  const take = () => {
    const taken = calls;
    calls = [];
    return taken;
  };
  const press = (accelerator: string) => {
    const callback = held.get(accelerator);
    if (!callback) throw new Error(`no shortcut ${accelerator} is held`);
    callback();
  };
  return { start, take, press, pressed, held };
}

test('isAccelerator accepts any number of modifiers followed by one key', () => {
  const accelerators = [
    'Control+Alt+D',
    'F13',
    'D',
    'Cmd+Ctrl+Option+Shift+F17',
    'CommandOrControl+K',
    'CmdOrCtrl+Super+Meta+Command+K',
    'control+alt+d',
    'Control + Alt + D',
    ' Control+Alt+D ',
    'Control+Alt+Plus',
    'Control+Alt+Space',
    // Electron decides whether the last part names a key.
    'Control+Alt+nosuchkey',
    'Control-Alt-D',
    'Control Alt D',
  ];
  for (const text of accelerators) {
    assert.equal(isAccelerator(text), true, text);
  }
});

test('isAccelerator refuses a text that Electron would read as another shortcut', () => {
  const others = [
    '',
    ' ',
    '+',
    'Control',
    'Control+Alt',
    'Control+',
    '+D',
    'Control++D',
    'Control+Alt++',
    'Contrl+D',
    'Foo+D',
    // macOS registers the shortcut without AltGr, so it would take the plain key D.
    'AltGr+D',
    'Control+Alt+D+E',
    'D+Control',
    '⌘+D',
  ];
  for (const text of others) {
    assert.equal(isAccelerator(text), false, JSON.stringify(text));
  }
});

test('GlobalShortcuts registers the shortcut of every app that has one, in the order of the configuration', () => {
  const { start, take } = fakeSystem();
  const shortcuts = start(three);
  assert.deepEqual(take(), ['unregisterAll', 'register Control+Alt+C', 'register Control+Alt+K']);
  // Discuss has no shortcut and so no state.
  assert.deepEqual(shortcuts.states(), [
    { id: 'crm', shortcut: 'Control+Alt+C', status: 'registered' },
    { id: 'calendar', shortcut: 'Control+Alt+K', status: 'registered' },
  ]);
});

test('a press toggles the app of the shortcut', () => {
  const { start, press, pressed } = fakeSystem();
  start(three);
  press('Control+Alt+K');
  press('Control+Alt+C');
  press('Control+Alt+K');
  assert.deepEqual(pressed, ['calendar', 'crm', 'calendar']);
});

test('an app list that is empty or without a shortcut registers nothing', () => {
  for (const apps of [[], [discuss]]) {
    const { start, take } = fakeSystem();
    const shortcuts = start({ ...three, apps });
    assert.deepEqual(take(), ['unregisterAll'], JSON.stringify(apps));
    assert.deepEqual(shortcuts.states(), [], JSON.stringify(apps));
  }
});

test('an app without the shortcut key has no shortcut', () => {
  const file = (app: object) =>
    JSON.stringify({ baseUrl: B, apps: [{ id: 'crm', name: 'CRM', url: '/odoo/crm', ...app }] });
  assert.deepEqual(fakeSystem().start(parseConfig(file({}))).states(), []);
  assert.deepEqual(fakeSystem().start(parseConfig(JSON.stringify({ baseUrl: B }))).states(), []);
  assert.deepEqual(fakeSystem().start(parseConfig(file({ shortcut: 'Control+Alt+C' }))).states(), [
    { id: 'crm', shortcut: 'Control+Alt+C', status: 'registered' },
  ]);
});

test('a shortcut that is no accelerator is invalid and never reaches the system', () => {
  const { start, take } = fakeSystem();
  const apps = [entry('crm', 'Contrl+Alt+C'), entry('discuss', ' '), calendar];
  const shortcuts = start({ ...three, apps });
  assert.deepEqual(take(), ['unregisterAll', 'register Control+Alt+K']);
  assert.deepEqual(shortcuts.states().map((state) => state.status), ['invalid', 'invalid', 'registered']);
});

test('the answer of the system is the status of a shortcut, and the other shortcuts stay registered', () => {
  const answers: Record<string, ShortcutStatus> = {
    'Control+Alt+nosuchkey': 'invalid',
    'Ctrl+Alt+C': 'duplicate',
    'Control+Alt+T': 'refused',
  };
  const { start, press, pressed, held } = fakeSystem((accelerator) => answers[accelerator] ?? 'registered');
  const apps = [
    crm,
    entry('unknown-key', 'Control+Alt+nosuchkey'),
    entry('twin', 'Ctrl+Alt+C'),
    entry('refused', 'Control+Alt+T'),
    calendar,
  ];
  const shortcuts = start({ ...three, apps });
  assert.deepEqual(
    shortcuts.states().map(({ id, status }) => [id, status]),
    [
      ['crm', 'registered'],
      ['unknown-key', 'invalid'],
      ['twin', 'duplicate'],
      ['refused', 'refused'],
      ['calendar', 'registered'],
    ],
  );
  assert.deepEqual([...held.keys()], ['Control+Alt+C', 'Control+Alt+K']);
  press('Control+Alt+C');
  assert.deepEqual(pressed, ['crm']);
});

test('setConfig releases every shortcut and registers those of the new configuration', () => {
  const { start, take, press, pressed, held } = fakeSystem();
  const shortcuts = start(three);
  take();
  shortcuts.setConfig({
    ...three,
    apps: [{ ...crm, shortcut: '' }, { ...discuss, shortcut: 'Control+Alt+C' }, calendar],
  });
  assert.deepEqual(take(), ['unregisterAll', 'register Control+Alt+C', 'register Control+Alt+K']);
  press('Control+Alt+C');
  assert.deepEqual(pressed, ['discuss']);

  shortcuts.setConfig({ ...three, apps: [] });
  assert.deepEqual(take(), ['unregisterAll']);
  assert.deepEqual(shortcuts.states(), []);
  assert.equal(held.size, 0);
});

test('setConfig registers again when nothing changed, so a refused shortcut gets another try', () => {
  let refused = true;
  const { start, take } = fakeSystem((accelerator) =>
    refused && accelerator === 'Control+Alt+K' ? 'refused' : 'registered',
  );
  const shortcuts = start(three);
  assert.equal(shortcuts.states()[1]?.status, 'refused');
  take();

  refused = false;
  shortcuts.setConfig(three);
  assert.deepEqual(take(), ['unregisterAll', 'register Control+Alt+C', 'register Control+Alt+K']);
  assert.equal(shortcuts.states()[1]?.status, 'registered');
});

test('suspend releases every shortcut and keeps the states until setConfig takes them again', () => {
  const { start, take, press, pressed, held } = fakeSystem();
  const shortcuts = start(three);
  const before = shortcuts.states();
  take();

  shortcuts.suspend();
  assert.deepEqual(take(), ['unregisterAll']);
  assert.equal(held.size, 0);
  assert.throws(() => press('Control+Alt+C'), /no shortcut Control\+Alt\+C is held/);
  assert.deepEqual(shortcuts.states(), before);

  shortcuts.setConfig(three);
  assert.deepEqual(take(), ['unregisterAll', 'register Control+Alt+C', 'register Control+Alt+K']);
  press('Control+Alt+C');
  assert.deepEqual(pressed, ['crm']);
});
