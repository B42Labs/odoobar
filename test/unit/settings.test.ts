import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppConfig, Config } from '../../src/main/config';
import { isAccelerator, type ShortcutState } from '../../src/main/global-shortcuts';
import { messagesFor } from '../../src/main/messages';
import {
  appId,
  placeOver,
  prepareDraft,
  recordKey,
  Settings,
  type SettingsDeps,
  type SettingsUi,
} from '../../src/main/settings';
import type { KeyInput } from '../../src/main/shortcuts';
import type { Bounds } from '../../src/main/window';

const en = messagesFor('en');
const B = 'https://odoo.example.com';

function entry(id: string, name: string, shortcut = ''): AppConfig {
  return { id, name, url: `/odoo/${id}`, icon: '', shortcut, menuBar: true };
}

const home = entry('home', 'Home');
const crm = entry('crm', 'CRM', 'Control+Alt+C');
const two: Config = { baseUrl: B, launchAtLogin: false, attendance: true, apps: [home, crm] };

/**
 * Settings on a screen and a rest of OdooBar that record every call as text.
 * `take` returns the calls since the last `take`. `world` holds what the fakes
 * answer: the configuration, the shortcut states, the place of the main
 * window (by default none, as for a hidden one), what a save does (by default
 * it keeps the configuration), the answers to both questions and to a
 * sign-out, and the JSON document of an address (by default none).
 */
function fakeSettings(config: Config = two) {
  let calls: string[] = [];
  const world = {
    config,
    states: [] as readonly ShortcutState[],
    bounds: undefined as Bounds | undefined,
    save: (next: Config) => {
      world.config = next;
    },
    discard: (): Promise<boolean> => Promise.resolve(true),
    confirmSignOut: (): Promise<boolean> => Promise.resolve(true),
    signOut: (): Promise<void> => Promise.resolve(),
    fetchJson: (_url: string): Promise<unknown> => Promise.resolve(undefined),
  };
  const ui: SettingsUi = {
    showWindow: (over) =>
      calls.push(over ? `showWindow over ${over.x},${over.y} ${over.width}x${over.height}` : 'showWindow'),
    closeWindow: () => calls.push('closeWindow'),
    recorded: (accelerator) => calls.push(`recorded ${accelerator}`),
    confirmSignOut: () => {
      calls.push('confirmSignOut');
      return world.confirmSignOut();
    },
    confirmDiscard: () => {
      calls.push('confirmDiscard');
      return world.discard();
    },
  };
  const deps: SettingsDeps = {
    getConfig: () => world.config,
    saveConfig: (next) => {
      calls.push('saveConfig');
      world.save(next);
    },
    shortcutStates: () => world.states,
    suspendShortcuts: () => calls.push('suspendShortcuts'),
    resumeShortcuts: () => calls.push('resumeShortcuts'),
    windowBounds: () => world.bounds,
    signOut: () => {
      calls.push('signOut');
      return world.signOut();
    },
    fetchJson: (url) => {
      calls.push(`fetchJson ${url}`);
      return world.fetchJson(url);
    },
  };
  const take = () => {
    const taken = calls;
    calls = [];
    return taken;
  };
  return { settings: new Settings(ui, deps, en), world, take };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every settled promise run its callbacks. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

type Modifier = 'meta' | 'control' | 'alt' | 'shift';

/** A key press as Electron reports it to 'before-input-event'. */
function key(code: string, modifiers: Modifier[] = [], more: Partial<KeyInput> = {}): KeyInput {
  return {
    type: 'keyDown',
    key: '',
    code,
    meta: modifiers.includes('meta'),
    control: modifiers.includes('control'),
    alt: modifiers.includes('alt'),
    shift: modifiers.includes('shift'),
    isAutoRepeat: false,
    ...more,
  };
}

test('state lists a notice for every shortcut that is not registered', () => {
  const { settings, world } = fakeSettings();
  assert.deepEqual(settings.state(), { config: two, notices: {}, texts: en.settings });

  world.states = [
    { id: 'home', shortcut: 'Control+Alt+H', status: 'registered' },
    { id: 'crm', shortcut: 'Contrl+C', status: 'invalid' },
    { id: 'twin', shortcut: 'Control+Alt+H', status: 'duplicate' },
    { id: 'refused', shortcut: 'Control+Alt+R', status: 'refused' },
  ];
  assert.deepEqual(settings.state().notices, {
    crm: 'This is not a valid shortcut.',
    twin: 'An app further up already has this shortcut, and it works only there.',
    refused: 'macOS refused this shortcut.',
  });
});

test('appId makes an id from the name that no other app has', () => {
  const none = new Set<string>();
  assert.equal(appId('CRM', none), 'crm');
  assert.equal(appId('CRM', new Set(['crm'])), 'crm-2');
  assert.equal(appId('CRM', new Set(['crm', 'crm-2'])), 'crm-3');
  assert.equal(appId('Aufträge', none), 'auftr-ge');
  assert.equal(appId('--My  Tasks!--', none), 'my-tasks');
  for (const name of ['日本', '  ', '', '--', 42, undefined, null]) {
    assert.equal(appId(name, none), 'app', JSON.stringify(name));
  }
  assert.equal(appId('日本', new Set(['app'])), 'app-2');
});

test('prepareDraft trims the texts of an app and keeps its id', () => {
  const draft = {
    baseUrl: B,
    apps: [{ id: 'home', name: ' Home ', url: ' /odoo ', icon: ' house ', shortcut: ' Control+Alt+H ', menuBar: true }],
  };
  assert.deepEqual(prepareDraft(draft), {
    baseUrl: B,
    apps: [{ id: 'home', name: 'Home', url: '/odoo', icon: 'house', shortcut: 'Control+Alt+H', menuBar: true }],
  });
  // The draft of the page stays as it was.
  assert.equal(draft.apps[0]?.name, ' Home ');
});

test('prepareDraft gives each new app an id that no other app has', () => {
  const ids = (apps: object[]) =>
    (prepareDraft({ baseUrl: B, apps }) as { apps: { id: unknown }[] }).apps.map((app) => app.id);
  assert.deepEqual(ids([{ id: '', name: 'CRM' }, { id: '', name: 'CRM' }]), ['crm', 'crm-2']);
  // A kept id counts, also when its app comes further down.
  assert.deepEqual(ids([{ id: '', name: 'CRM' }, { id: 'crm', name: 'Old CRM' }]), ['crm-2', 'crm']);
  assert.deepEqual(ids([{ id: '', name: '日本' }]), ['app']);
  assert.deepEqual(ids([{ name: 7 }]), ['app']);
  assert.deepEqual(ids([{ id: '', name: '日本' }, { name: 7 }]), ['app', 'app-2']);
  // An id of white space or of another type is no id.
  assert.deepEqual(ids([{ id: '  ', name: 'Tasks' }, { id: 5, name: 'Notes' }]), ['tasks', 'notes']);
});

test('prepareDraft leaves a value alone that is no draft', () => {
  for (const value of [undefined, null, 'x', 42, []]) {
    assert.equal(prepareDraft(value), value, JSON.stringify(value));
  }
  const withoutApps = { baseUrl: B };
  assert.equal(prepareDraft(withoutApps), withoutApps);
  const notAList = { baseUrl: B, apps: 'none' };
  assert.equal(prepareDraft(notAList), notAList);
  // An entry that is no object stays in place, so validation names it.
  assert.deepEqual(prepareDraft({ baseUrl: B, apps: ['crm', null] }), { baseUrl: B, apps: ['crm', null] });
});

test('save writes a valid draft and returns the saved state', () => {
  const { settings, world, take } = fakeSettings();
  const saved: Config = {
    baseUrl: B,
    launchAtLogin: true,
    attendance: true,
    apps: [home, { id: 'crm', name: 'CRM', url: '/odoo/crm', icon: '', shortcut: 'Contrl+D', menuBar: false }],
  };
  world.save = (next) => {
    assert.deepEqual(next, saved);
    world.config = next;
    // GlobalShortcuts heard about the save before it returns.
    world.states = [{ id: 'crm', shortcut: 'Contrl+D', status: 'invalid' }];
  };
  const result = settings.save({
    baseUrl: `  ${B}/  `,
    launchAtLogin: true,
    apps: [home, { id: '', name: ' CRM ', url: '/odoo/crm', icon: '', shortcut: 'Contrl+D', menuBar: false }],
  });
  assert.deepEqual(result, {
    ok: true,
    state: { config: saved, notices: { crm: 'This is not a valid shortcut.' }, texts: en.settings },
  });
  assert.deepEqual(take(), ['saveConfig']);
});

test('save names the field of a value that breaks a rule and writes nothing', () => {
  const { settings, take } = fakeSettings();
  assert.deepEqual(settings.save({ ...two, apps: [home, { ...crm, url: 'crm' }] }), {
    ok: false,
    path: 'apps[1].url',
    error: en.configErrors['app-url'],
  });
  assert.deepEqual(settings.save({ ...two, baseUrl: '' }), {
    ok: false,
    path: 'baseUrl',
    error: en.configErrors.empty,
  });
  assert.deepEqual(settings.save({ ...two, apps: [home, { ...crm, id: '', name: ' ' }] }), {
    ok: false,
    path: 'apps[1].name',
    error: en.configErrors.empty,
  });
  assert.deepEqual(take(), []);
  assert.deepEqual(settings.state().config, two);
});

test('save takes an empty app list and a draft without apps', () => {
  const { settings, world } = fakeSettings();
  world.states = [{ id: 'crm', shortcut: 'Contrl+C', status: 'invalid' }];
  world.save = (next) => {
    world.config = next;
    world.states = [];
  };
  assert.deepEqual(settings.save({ ...two, apps: [] }), {
    ok: true,
    state: { config: { ...two, apps: [] }, notices: {}, texts: en.settings },
  });
  assert.deepEqual(settings.save({ baseUrl: B }), {
    ok: true,
    state: { config: { baseUrl: B, launchAtLogin: false, attendance: true, apps: [] }, notices: {}, texts: en.settings },
  });
});

test('save refuses a draft that is no object', () => {
  const { settings, take } = fakeSettings();
  for (const draft of [undefined, null, 'x']) {
    assert.deepEqual(
      settings.save(draft),
      { ok: false, path: '', error: en.configErrors['expected-object'] },
      JSON.stringify(draft),
    );
  }
  assert.deepEqual(take(), []);
});

test('save reports a file system error and keeps the configuration', () => {
  const { settings, world } = fakeSettings();
  world.save = () => {
    throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  };
  assert.deepEqual(settings.save({ ...two, apps: [home] }), {
    ok: false,
    path: '',
    error: 'OdooBar could not save the configuration: EACCES: permission denied',
  });
  assert.deepEqual(settings.state().config, two);
});

test('save ends a recording before it writes', () => {
  const { settings, take } = fakeSettings();
  settings.startRecording();
  take();
  assert.equal(settings.save(two).ok, true);
  assert.deepEqual(take(), ['resumeShortcuts', 'recorded undefined', 'saveConfig']);
  // The recording is over, so a key goes to the page.
  assert.equal(settings.keyPressed(key('KeyD', ['control', 'alt'])), false);
});

test('recordKey turns a key press into an accelerator', () => {
  const shortcut = (input: KeyInput) => {
    const result = recordKey(input);
    return result.kind === 'shortcut' ? result.accelerator : result.kind;
  };
  assert.equal(shortcut(key('KeyD', ['control', 'alt'])), 'Control+Alt+D');
  assert.equal(shortcut(key('Space', ['shift', 'meta'])), 'Shift+Command+Space');
  assert.equal(shortcut(key('F5')), 'F5');
  assert.equal(shortcut(key('F5', ['shift'])), 'Shift+F5');
  assert.equal(shortcut(key('F24', ['meta', 'alt', 'shift', 'control'])), 'Control+Alt+Shift+Command+F24');
  assert.equal(shortcut(key('Enter', ['alt'])), 'Alt+Return');
  assert.equal(shortcut(key('ArrowUp', ['control'])), 'Control+Up');
  assert.equal(shortcut(key('Digit7', ['meta'])), 'Command+7');
  // The key labelled Z on a German keyboard sits where the US layout has Y.
  assert.equal(shortcut(key('KeyY', ['control', 'alt'], { key: 'z' })), 'Control+Alt+Y');
  // Electron's accelerator names of the keys besides letters, digits, and F keys.
  const named = {
    Space: 'Space',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Enter: 'Return',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };
  for (const [code, name] of Object.entries(named)) {
    const accelerator = shortcut(key(code, ['control']));
    assert.equal(accelerator, `Control+${name}`, code);
    // GlobalShortcuts takes what the recorder writes for a shortcut, not for an invalid text.
    assert.ok(isAccelerator(accelerator), code);
  }
});

test('recordKey waits for a key that makes no shortcut and cancels on Escape', () => {
  const waits = [
    key('KeyD', ['control', 'alt'], { type: 'keyUp' }),
    key('KeyD', ['control', 'alt'], { isAutoRepeat: true }),
    key('KeyD'),
    key('KeyD', ['shift']),
    key('ControlLeft', ['control']),
    key('Comma', ['control']),
    key('F25'),
    key('Escape', ['control']),
    key(''),
  ];
  for (const input of waits) {
    assert.deepEqual(recordKey(input), { kind: 'wait' }, JSON.stringify(input));
  }
  assert.deepEqual(recordKey(key('Escape')), { kind: 'cancel' });
});

test('keyPressed takes no key while nothing records', () => {
  const { settings, take } = fakeSettings();
  assert.equal(settings.keyPressed(key('KeyD', ['control', 'alt'])), false);
  assert.equal(settings.keyPressed(key('Escape')), false);
  assert.deepEqual(take(), []);
});

test('a recording takes keys until one makes a shortcut', () => {
  const { settings, take } = fakeSettings();
  settings.startRecording();
  assert.deepEqual(take(), ['suspendShortcuts']);
  assert.equal(settings.keyPressed(key('KeyD')), true);
  assert.equal(settings.keyPressed(key('ControlLeft', ['control'])), true);
  assert.deepEqual(take(), []);
  assert.equal(settings.keyPressed(key('KeyD', ['control', 'alt'])), true);
  assert.deepEqual(take(), ['resumeShortcuts', 'recorded Control+Alt+D']);
  assert.equal(settings.keyPressed(key('KeyE', ['control', 'alt'])), false);
  assert.deepEqual(take(), []);
});

test('Escape during a recording ends it without a shortcut', () => {
  const { settings, take } = fakeSettings();
  settings.startRecording();
  take();
  assert.equal(settings.keyPressed(key('Escape')), true);
  assert.deepEqual(take(), ['resumeShortcuts', 'recorded undefined']);
});

test('startRecording and cancelRecording suspend and resume once', () => {
  const { settings, take } = fakeSettings();
  settings.cancelRecording();
  assert.deepEqual(take(), []);
  settings.startRecording();
  settings.startRecording();
  assert.deepEqual(take(), ['suspendShortcuts']);
  settings.cancelRecording();
  assert.deepEqual(take(), ['resumeShortcuts', 'recorded undefined']);
  settings.cancelRecording();
  assert.deepEqual(take(), []);
});

test('closing the window ends a recording', () => {
  const { settings, take } = fakeSettings();
  settings.startRecording();
  take();
  settings.closed();
  assert.deepEqual(take(), ['resumeShortcuts', 'recorded undefined']);
  settings.closed();
  assert.deepEqual(take(), []);
});

test('open shows the window and requestClose closes a clean one at once', () => {
  const { settings, take } = fakeSettings();
  settings.open();
  assert.deepEqual(take(), ['showWindow']);
  settings.requestClose();
  assert.deepEqual(take(), ['closeWindow']);
  settings.setDirty(true);
  settings.setDirty(false);
  settings.requestClose();
  assert.deepEqual(take(), ['closeWindow']);
});

test('open shows the window over the main window while that one shows', () => {
  const { settings, world, take } = fakeSettings();
  world.bounds = { x: 1920, y: 25, width: 1200, height: 800 };
  settings.open();
  assert.deepEqual(take(), ['showWindow over 1920,25 1200x800']);
});

test('placeOver centers a window over the anchor', () => {
  const screen = { x: 1920, y: 25, width: 2560, height: 1415 };
  const size = { width: 760, height: 600 };
  assert.deepEqual(placeOver(size, { x: 2400, y: 300, width: 1200, height: 800 }, screen), { x: 2620, y: 400 });
  // An anchor smaller than the window, and a half point.
  assert.deepEqual(placeOver(size, { x: 3000, y: 500, width: 481, height: 320 }, screen), { x: 2861, y: 360 });
  // The whole area as the anchor centers the window on the screen.
  assert.deepEqual(placeOver(size, screen, screen), { x: 2820, y: 433 });
});

test('placeOver keeps the window on the screen of the anchor', () => {
  // A screen to the left of the primary one, which has negative places.
  const screen = { x: -1440, y: 25, width: 1440, height: 875 };
  const size = { width: 760, height: 600 };
  assert.deepEqual(placeOver(size, { x: -1440, y: 25, width: 480, height: 320 }, screen), { x: -1440, y: 25 });
  assert.deepEqual(placeOver(size, { x: -500, y: 500, width: 600, height: 400 }, screen), { x: -760, y: 300 });
  // An anchor that hangs over the edge of its screen.
  assert.deepEqual(placeOver(size, { x: -2000, y: -200, width: 1200, height: 800 }, screen), { x: -1440, y: 25 });
  // A window larger than the area starts at its top left corner.
  assert.deepEqual(placeOver({ width: 1600, height: 1000 }, screen, screen), { x: -1440, y: 25 });
});

test('requestClose asks once while dirty and closes only on discard', async () => {
  const { settings, world, take } = fakeSettings();
  settings.setDirty(true);
  const keep = deferred<boolean>();
  world.discard = () => keep.promise;
  settings.requestClose();
  settings.requestClose();
  assert.deepEqual(take(), ['confirmDiscard']);
  keep.resolve(false);
  await settle();
  assert.deepEqual(take(), []);

  const discard = deferred<boolean>();
  world.discard = () => discard.promise;
  settings.requestClose();
  assert.deepEqual(take(), ['confirmDiscard']);
  discard.resolve(true);
  await settle();
  assert.deepEqual(take(), ['closeWindow']);
});

test('requestClose keeps the window when the question fails', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const { settings, world, take } = fakeSettings();
  settings.setDirty(true);
  const failure = new Error('no dialog');
  world.discard = () => Promise.reject(failure);
  settings.requestClose();
  await settle();
  assert.deepEqual(take(), ['confirmDiscard']);
  assert.equal(error.mock.callCount(), 1);
  assert.deepEqual(error.mock.calls[0]?.arguments, ['OdooBar could not ask whether to discard the settings:', failure]);

  // The question can be asked again.
  world.discard = () => {
    throw failure;
  };
  settings.requestClose();
  await settle();
  assert.deepEqual(take(), ['confirmDiscard']);
  assert.equal(error.mock.callCount(), 2);
});

test('a save and a closed window make the settings clean again', () => {
  const { settings, take } = fakeSettings();
  settings.setDirty(true);
  assert.equal(settings.save(two).ok, true);
  take();
  settings.requestClose();
  assert.deepEqual(take(), ['closeWindow']);

  settings.setDirty(true);
  settings.closed();
  settings.requestClose();
  assert.deepEqual(take(), ['closeWindow']);
});

test('a failed save keeps the settings dirty', () => {
  const { settings, world, take } = fakeSettings();
  settings.setDirty(true);
  world.discard = () => new Promise(() => {});
  assert.equal(settings.save({ ...two, baseUrl: '' }).ok, false);
  settings.requestClose();
  assert.deepEqual(take(), ['confirmDiscard']);
});

test('signOut asks first and signs out only on confirmation', async () => {
  const { settings, world, take } = fakeSettings();
  world.confirmSignOut = () => Promise.resolve(false);
  assert.deepEqual(await settings.signOut(), { ok: true });
  assert.deepEqual(take(), ['confirmSignOut']);

  world.confirmSignOut = () => Promise.resolve(true);
  assert.deepEqual(await settings.signOut(), { ok: true });
  assert.deepEqual(take(), ['confirmSignOut', 'signOut']);
});

test('signOut reports a failed sign-out', async () => {
  const { settings, world } = fakeSettings();
  world.signOut = () => Promise.reject(new Error('disk'));
  assert.deepEqual(await settings.signOut(), { ok: false, error: 'OdooBar could not sign out: disk' });
});

test('signOut does not sign out when the question fails', async () => {
  const { settings, world, take } = fakeSettings();
  world.confirmSignOut = () => Promise.reject(new Error('no dialog'));
  assert.deepEqual(await settings.signOut(), { ok: false, error: 'OdooBar could not sign out: no dialog' });
  assert.deepEqual(take(), ['confirmSignOut']);
});

/** The menu document of an Odoo with the app CRM. */
const menus = {
  root: { id: 'root', children: [7] },
  '7': { id: 7, name: 'CRM', xmlid: 'crm.crm_menu_root', actionID: 12, actionPath: 'crm' },
};
const menusUrl = `${B}/web/webclient/load_menus`;

test('odooApps asks the saved instance for the apps of the account', async () => {
  const { settings, world, take } = fakeSettings();
  world.fetchJson = () => Promise.resolve(menus);
  assert.deepEqual(await settings.odooApps(), {
    ok: true,
    apps: [{ name: 'CRM', url: '/odoo/crm', icon: 'handshake' }],
  });
  assert.deepEqual(take(), [`fetchJson ${menusUrl}`]);
});

test('odooApps asks the address of an earlier Odoo when the first one has no menus', async () => {
  const { settings, world, take } = fakeSettings();
  world.fetchJson = (url) => Promise.resolve(url === `${menusUrl}/odoobar` ? menus : undefined);
  assert.equal((await settings.odooApps()).ok, true);
  assert.deepEqual(take(), [`fetchJson ${menusUrl}`, `fetchJson ${menusUrl}/odoobar`]);
});

test('odooApps asks for the login when no address has menus', async () => {
  const { settings, take } = fakeSettings();
  assert.deepEqual(await settings.odooApps(), { ok: false, error: en.settings.odooApps.signedOut });
  assert.deepEqual(take(), [`fetchJson ${menusUrl}`, `fetchJson ${menusUrl}/odoobar`]);
});

test('odooApps reports an instance that does not answer', async () => {
  const { settings, world } = fakeSettings();
  world.fetchJson = () => Promise.reject(new Error('net::ERR_CONNECTION_REFUSED'));
  assert.deepEqual(await settings.odooApps(), {
    ok: false,
    error: 'OdooBar could not load the apps: net::ERR_CONNECTION_REFUSED',
  });
});
