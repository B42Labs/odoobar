import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInClock } from '../../src/main/attendance';
import type { AppConfig, Config } from '../../src/main/config';
import { messagesFor, type Messages } from '../../src/main/messages';
import {
  WindowController,
  type BarState,
  type Desktop,
  type Direction,
  type WindowUi,
} from '../../src/main/window';

const en = messagesFor('en');
const B = 'https://odoo.example.com';

function entry(id: string, name: string, url: string): AppConfig {
  return { id, name, url, icon: '', shortcut: '', menuBar: false };
}

const crm = entry('crm', 'CRM', '/odoo/crm');
const discuss = entry('discuss', 'Discuss', '/odoo/discuss');
const two: Config = { baseUrl: B, launchAtLogin: false, attendance: true, apps: [crm, discuss] };

/** Where the window of fakeWindow is, once it was shown. */
const PLACE = { x: 1920, y: 25, width: 1200, height: 800 };

/** The check-in of attendanceOf at 08:15 local time, and an hour after it, which is the same day in every time zone. */
const SINCE = new Date(2026, 9, 6, 8, 15).getTime();
const NOW = SINCE + 3_600_000;

/**
 * A WindowController on a screen and a system that record every call but
 * renderBar, canGo, isWindowFocused, windowBounds, fetchJson, postJson, and
 * now as text. `take` returns the calls since the last `take`, and `bar` the
 * last state that the app bar got. The view of an app can go nowhere until
 * `history` names its directions. The window takes the keys from showWindow
 * until hideWindow or `blur`, as a click into another program does.
 * clearProfile resolves at once unless `clearWith` replaces it. The instance
 * answers every address with the value of `menus.document`, and fails while
 * that is an Error. `odoo.posts` holds the address of every post, which
 * `odoo.answer` answers, by default with no document. The clock stands at
 * `odoo.now`.
 */
function fakeWindow(config: Config, messages: Messages = en) {
  let calls: string[] = [];
  let state: BarState | undefined;
  let focused = false;
  const steps = new Map<string, Direction[]>();
  let clear = (): Promise<void> => Promise.resolve();
  const menus: { document: unknown } = { document: undefined };
  const odoo = { posts: [] as string[], answer: (_url: string): unknown => undefined, now: NOW };
  const ui: WindowUi = {
    openView: (id, url) => calls.push(`openView ${id} ${url}`),
    closeView: (id) => calls.push(`closeView ${id}`),
    loadView: (id, url) => calls.push(`loadView ${id} ${url}`),
    reloadView: (id) => calls.push(`reloadView ${id}`),
    canGo: (id, direction) => steps.get(id)?.includes(direction) ?? false,
    go: (id, direction) => calls.push(`go ${id} ${direction}`),
    showView: (id) => calls.push(`showView ${id}`),
    renderBar: (next) => {
      state = next;
    },
    showWindow: () => {
      focused = true;
      calls.push('showWindow');
    },
    hideWindow: () => {
      focused = false;
      calls.push('hideWindow');
    },
    isWindowFocused: () => focused,
    windowBounds: () => PLACE,
    clearProfile: () => {
      calls.push('clearProfile');
      return clear();
    },
    showFailure: ({ message, detail }) => calls.push(`showFailure ${message} | ${detail}`),
  };
  const desktop: Desktop = {
    openExternal: (url) => calls.push(`openExternal ${url}`),
    openSettings: () => calls.push('openSettings'),
    fetchJson: async () => {
      if (menus.document instanceof Error) throw menus.document;
      return menus.document;
    },
    // The async function turns an error that `answer` throws into a rejection.
    postJson: async (url) => {
      odoo.posts.push(url);
      return odoo.answer(url);
    },
    now: () => odoo.now,
  };
  const controller = new WindowController(ui, desktop, messages, config);
  const take = () => {
    const taken = calls;
    calls = [];
    return taken;
  };
  const clearWith = (next: () => Promise<void>) => {
    clear = next;
  };
  const blur = () => {
    focused = false;
  };
  const history = (id: string, ...directions: Direction[]) => {
    steps.set(id, directions);
  };
  return { controller, take, bar: () => state, clearWith, blur, history, menus, odoo };
}

/** A fakeWindow whose window is shown, with the calls of show() taken. */
function shownWindow(config: Config, messages: Messages = en) {
  const fake = fakeWindow(config, messages);
  fake.controller.show();
  fake.take();
  return fake;
}

test('creates no view and no window before the window is shown', () => {
  const { controller, take, bar } = fakeWindow(two);
  assert.equal(controller.activeId, 'crm');
  assert.deepEqual(take(), []);
  assert.equal(bar(), undefined);
});

test('show brings up the window and loads only the first app', () => {
  const { controller, take, bar } = fakeWindow(two);
  controller.show();
  assert.deepEqual(take(), ['showWindow', `openView crm ${B}/odoo/crm`, 'showView crm']);
  assert.deepEqual(bar(), {
    apps: [
      { id: 'crm', name: 'CRM', close: undefined },
      { id: 'discuss', name: 'Discuss', close: undefined },
    ],
    activeId: 'crm',
    nav: { back: false, forward: false, reload: true },
    notice: undefined,
    update: undefined,
    attendance: undefined,
    texts: { back: 'Back', forward: 'Forward', reload: 'Reload', settings: 'Settings', retry: 'Try again' },
  });
});

test('show resolves a path against the base URL and keeps a full URL', () => {
  const other = entry('other', 'Other', 'https://other.example.com/x?y=1');
  const { controller, take } = fakeWindow({ ...two, baseUrl: `${B}/prefix`, apps: [other, crm] });
  controller.show();
  assert.deepEqual(take(), ['showWindow', 'openView other https://other.example.com/x?y=1', 'showView other']);
  controller.selectApp('crm');
  assert.deepEqual(take(), [`openView crm ${B}/prefix/odoo/crm`, 'showView crm']);
});

test('selectApp loads an app on first use and only shows it afterwards', () => {
  const { controller, take } = shownWindow(two);
  controller.selectApp('discuss');
  assert.deepEqual(take(), [`openView discuss ${B}/odoo/discuss`, 'showView discuss']);
  controller.selectApp('crm');
  assert.deepEqual(take(), ['showView crm']);
  controller.selectApp('discuss');
  assert.deepEqual(take(), ['showView discuss']);
});

test('selectApp ignores the active app and an unknown id', () => {
  const { controller, take } = shownWindow(two);
  for (const id of ['crm', 'nope', '']) {
    controller.selectApp(id);
    assert.deepEqual(take(), [], JSON.stringify(id));
  }
  assert.equal(controller.activeId, 'crm');
});

test('selectApp in a hidden window changes the active app without loading it', () => {
  const { controller, take, bar } = fakeWindow(two);
  controller.selectApp('discuss');
  assert.deepEqual(take(), []);
  assert.equal(bar()?.activeId, 'discuss');
  controller.show();
  assert.deepEqual(take(), ['showWindow', `openView discuss ${B}/odoo/discuss`, 'showView discuss']);
});

test('hide hides the window and keeps the views', () => {
  const { controller, take } = shownWindow(two);
  controller.hide();
  assert.deepEqual(take(), ['hideWindow']);
  controller.show();
  assert.deepEqual(take(), ['showWindow', 'showView crm']);
});

test('bounds gives the place of the window only while it shows', () => {
  const { controller } = fakeWindow(two);
  assert.equal(controller.bounds(), undefined);
  controller.show();
  assert.deepEqual(controller.bounds(), PLACE);
  controller.hide();
  assert.equal(controller.bounds(), undefined);
});

test('pressApp switches to another app and loads the start address of the active one', () => {
  const { controller, take } = shownWindow(two);
  controller.pressApp('discuss');
  assert.deepEqual(take(), [`openView discuss ${B}/odoo/discuss`, 'showView discuss']);
  controller.pressApp('discuss');
  assert.deepEqual(take(), [`loadView discuss ${B}/odoo/discuss`, 'showView discuss']);
  controller.pressApp('nope');
  assert.deepEqual(take(), []);
});

test('handleShortcut selects by position, reloads, opens the settings, and hides', () => {
  const { controller, take } = shownWindow(two);
  controller.handleShortcut({ kind: 'select', index: 1 });
  assert.deepEqual(take(), [`openView discuss ${B}/odoo/discuss`, 'showView discuss']);
  controller.handleShortcut({ kind: 'select', index: 2 });
  controller.handleShortcut({ kind: 'select', index: 1 });
  assert.deepEqual(take(), []);
  controller.handleShortcut({ kind: 'reload' });
  assert.deepEqual(take(), ['reloadView discuss']);
  controller.handleShortcut({ kind: 'settings' });
  assert.deepEqual(take(), ['openSettings']);
  controller.handleShortcut({ kind: 'hide' });
  assert.deepEqual(take(), ['hideWindow']);
});

test('reloadActive does nothing without an app or before the window was shown', () => {
  const empty = shownWindow({ ...two, apps: [] });
  empty.controller.reloadActive();
  assert.deepEqual(empty.take(), []);

  const hidden = fakeWindow(two);
  hidden.controller.reloadActive();
  assert.deepEqual(hidden.take(), []);
});

test('the bar offers back and forward once the view of the active app can go there', () => {
  const { controller, bar, history } = shownWindow(two);
  assert.deepEqual(bar()?.nav, { back: false, forward: false, reload: true });
  history('crm', 'back');
  controller.historyChanged('crm');
  assert.deepEqual(bar()?.nav, { back: true, forward: false, reload: true });

  controller.selectApp('discuss');
  assert.deepEqual(bar()?.nav, { back: false, forward: false, reload: true });
  // The history of a background app leaves the bar as it is.
  const drawn = bar();
  history('crm', 'back', 'forward');
  controller.historyChanged('crm');
  assert.equal(bar(), drawn);
  controller.selectApp('crm');
  assert.deepEqual(bar()?.nav, { back: true, forward: true, reload: true });
});

test('the bar offers neither back, forward, nor reload for an app without a view', () => {
  const none = { back: false, forward: false, reload: false };
  const hidden = fakeWindow(two);
  hidden.history('discuss', 'back', 'forward');
  hidden.controller.selectApp('discuss');
  assert.deepEqual(hidden.bar()?.nav, none);
  hidden.controller.go('back');
  assert.deepEqual(hidden.take(), []);

  const empty = shownWindow({ ...two, apps: [] });
  assert.deepEqual(empty.bar()?.nav, none);
  empty.controller.go('back');
  assert.deepEqual(empty.take(), []);
});

test('go takes the active app one step and does nothing without a page in that direction', () => {
  const { controller, take, history } = shownWindow(two);
  controller.go('back');
  controller.go('forward');
  assert.deepEqual(take(), []);
  history('crm', 'back');
  controller.go('forward');
  controller.go('back');
  assert.deepEqual(take(), ['go crm back']);
  history('crm', 'forward');
  controller.go('back');
  controller.go('forward');
  assert.deepEqual(take(), ['go crm forward']);
});

test('go replaces the notice of a page that did not load with the page it leads to', () => {
  const { controller, take, bar, history } = shownWindow(two);
  controller.loadFailed('crm', `${B}/odoo/crm/7`, 'ERR_NAME_NOT_RESOLVED');
  take();
  controller.go('back');
  assert.deepEqual(take(), []);
  assert.equal(bar()?.notice?.retry, true);
  history('crm', 'back');
  controller.historyChanged('crm');
  assert.equal(bar()?.nav.back, true);
  controller.go('back');
  assert.deepEqual(take(), ['go crm back', 'showView crm']);
  assert.equal(bar()?.notice, undefined);
});

test('toggleApp shows the window with the app and hides it when that app is in front', () => {
  const { controller, take } = fakeWindow(two);
  controller.toggleApp('discuss');
  assert.deepEqual(take(), ['showWindow', `openView discuss ${B}/odoo/discuss`, 'showView discuss']);
  assert.equal(controller.activeId, 'discuss');
  controller.toggleApp('discuss');
  assert.deepEqual(take(), ['hideWindow']);
  controller.toggleApp('discuss');
  assert.deepEqual(take(), ['showWindow', 'showView discuss']);
});

test('toggleApp switches to another app in a window that is in front', () => {
  const { controller, take } = shownWindow(two);
  controller.toggleApp('discuss');
  assert.deepEqual(take(), ['showWindow', `openView discuss ${B}/odoo/discuss`, 'showView discuss']);
  assert.equal(controller.activeId, 'discuss');
});

test('toggleApp brings a window forward that shows the app behind another program', () => {
  const { controller, take, blur } = shownWindow(two);
  blur();
  controller.toggleApp('crm');
  assert.deepEqual(take(), ['showWindow', 'showView crm']);
});

test('toggleApp ignores an unknown id and an empty app list', () => {
  const { controller, take } = shownWindow(two);
  controller.toggleApp('nope');
  assert.deepEqual(take(), []);
  assert.equal(controller.activeId, 'crm');

  const empty = shownWindow({ ...two, apps: [] });
  empty.controller.toggleApp('crm');
  assert.deepEqual(empty.take(), []);
});

test('reloadApp reloads an app in the background, and canReload tells whether it has a view', () => {
  const { controller, take } = shownWindow(two);
  assert.equal(controller.canReload('crm'), true);
  for (const id of ['discuss', 'nope']) {
    assert.equal(controller.canReload(id), false, id);
    controller.reloadApp(id);
    assert.deepEqual(take(), [], id);
  }
  controller.selectApp('discuss');
  take();
  controller.reloadApp('crm');
  assert.deepEqual(take(), ['reloadView crm']);
  assert.equal(controller.activeId, 'discuss');
  controller.hide();
  take();
  controller.reloadApp('crm');
  assert.deepEqual(take(), ['reloadView crm']);
});

test('reloadApp loads the failed address of a background app again', () => {
  const { controller, take, bar } = shownWindow(two);
  controller.selectApp('discuss');
  controller.loadFailed('crm', `${B}/odoo/crm/7`, 'ERR_CONNECTION_REFUSED');
  take();
  assert.equal(controller.canReload('crm'), true);
  controller.reloadApp('crm');
  assert.deepEqual(take(), [`loadView crm ${B}/odoo/crm/7`, 'showView discuss']);
  controller.selectApp('crm');
  assert.equal(bar()?.notice, undefined);
});

test('an empty app list shows a notice and no view', () => {
  const { controller, take, bar } = fakeWindow({ ...two, apps: [] });
  assert.equal(controller.activeId, undefined);
  controller.show();
  assert.deepEqual(take(), ['showWindow', 'showView undefined']);
  assert.deepEqual(bar()?.apps, []);
  assert.deepEqual(bar()?.notice, { text: 'No apps are configured.', retry: false });
  controller.handleShortcut({ kind: 'select', index: 0 });
  assert.deepEqual(take(), []);
});

test('loadFailed replaces the view with a notice until a reload', () => {
  const { controller, take, bar } = shownWindow(two);
  controller.loadFailed('crm', `${B}/odoo/crm/7`, 'ERR_NAME_NOT_RESOLVED');
  assert.deepEqual(take(), ['showView undefined']);
  assert.deepEqual(bar()?.notice, {
    text: 'CRM could not be loaded.\n\nhttps://odoo.example.com/odoo/crm/7\nERR_NAME_NOT_RESOLVED',
    retry: true,
  });
  controller.reloadActive();
  assert.deepEqual(take(), [`loadView crm ${B}/odoo/crm/7`, 'showView crm']);
  assert.equal(bar()?.notice, undefined);
});

test('loadFailed of a background app shows its notice only once that app is active', () => {
  const { controller, take, bar } = shownWindow(two);
  controller.selectApp('discuss');
  take();
  controller.loadFailed('crm', `${B}/odoo/crm`, 'ERR_CONNECTION_REFUSED');
  assert.deepEqual(take(), ['showView discuss']);
  assert.equal(bar()?.notice, undefined);
  controller.selectApp('crm');
  assert.deepEqual(take(), ['showView undefined']);
  assert.equal(bar()?.notice?.retry, true);
  controller.pressApp('crm');
  assert.deepEqual(take(), [`loadView crm ${B}/odoo/crm`, 'showView crm']);
  assert.equal(bar()?.notice, undefined);
});

test('loadFailed ignores an app without a view', () => {
  const { controller, take, bar } = shownWindow(two);
  for (const id of ['discuss', 'nope']) {
    controller.loadFailed(id, `${B}/odoo/${id}`, 'ERR_CONNECTION_REFUSED');
    assert.deepEqual(take(), [], id);
    assert.equal(bar()?.notice, undefined, id);
  }
});

test('the notice is German for German messages', () => {
  const { controller, bar } = shownWindow(two, messagesFor('de'));
  controller.loadFailed('crm', `${B}/odoo/crm`, 'ERR_CONNECTION_REFUSED');
  assert.equal(bar()?.notice?.text, `CRM konnte nicht geladen werden.\n\n${B}/odoo/crm\nERR_CONNECTION_REFUSED`);
  assert.deepEqual(bar()?.texts, {
    back: 'Zurück',
    forward: 'Vorwärts',
    reload: 'Neu laden',
    settings: 'Einstellungen',
    retry: 'Erneut versuchen',
  });
});

const release = { version: '0.2.0', url: 'https://github.com/B42Labs/odoobar/releases/tag/v0.2.0' };

test('the bar offers an update only after setUpdate, also in a hidden window', () => {
  const { controller, take, bar } = fakeWindow(two);
  controller.setConfig(two);
  assert.notEqual(bar(), undefined);
  assert.equal(bar()?.update, undefined);

  controller.setUpdate(release);
  const offer = {
    label: 'Update to 0.2.0',
    hint: 'OdooBar 0.2.0 is available. Opens the download page in the browser.',
  };
  assert.deepEqual(take(), []);
  assert.deepEqual(bar()?.update, offer);

  // A saved configuration keeps the button.
  controller.setConfig({ ...two, apps: [discuss] });
  assert.deepEqual(bar()?.update, offer);
});

test('openUpdate opens the release page in the browser and does nothing without an update', () => {
  const { controller, take } = shownWindow(two);
  controller.openUpdate();
  assert.deepEqual(take(), []);
  controller.setUpdate(release);
  take();
  controller.openUpdate();
  assert.deepEqual(take(), ['openExternal https://github.com/B42Labs/odoobar/releases/tag/v0.2.0']);
});

test('the update button is German for German messages', () => {
  const { controller, bar } = shownWindow(two, messagesFor('de'));
  controller.setUpdate(release);
  assert.deepEqual(bar()?.update, {
    label: 'Update auf 0.2.0',
    hint: 'OdooBar 0.2.0 ist verfügbar. Öffnet die Download-Seite im Browser.',
  });
});

test('viewClosed opens the active app again at its start address', () => {
  const { controller, take } = shownWindow(two);
  controller.viewClosed('crm');
  assert.deepEqual(take(), [`openView crm ${B}/odoo/crm`, 'showView crm']);
  controller.viewClosed('discuss');
  assert.deepEqual(take(), []);
});

test('openLink loads a link inside the instance in the view that asked', () => {
  const { controller, take } = shownWindow(two);
  controller.openLink('crm', `${B}/odoo/action-123`);
  assert.deepEqual(take(), [`loadView crm ${B}/odoo/action-123`]);
});

test('openLink sends a link outside the instance to the browser and drops other schemes', () => {
  const { controller, take } = shownWindow(two);
  for (const url of ['https://www.odoo.com/documentation', 'mailto:someone@example.com']) {
    controller.openLink('crm', url);
    assert.deepEqual(take(), [`openExternal ${url}`]);
  }
  for (const url of ['file:///etc/hosts', '']) {
    controller.openLink('crm', url);
    assert.deepEqual(take(), [], JSON.stringify(url));
  }
});

test('grantsPermission grants a permission to the origin of the instance alone, whatever the path', () => {
  const { controller } = fakeWindow({ ...two, baseUrl: `${B}/erp` });
  for (const url of [`${B}/erp/odoo/discuss`, `${B}/web/login`, B]) {
    assert.equal(controller.grantsPermission(url), true, url);
  }
  const others = [
    'https://login.example.com/authorize',
    'http://odoo.example.com',
    'https://odoo.example.com:8443',
    'https://chat.odoo.example.com',
    'file:///renderer/app-bar.html',
    'null',
    '',
  ];
  for (const url of others) {
    assert.equal(controller.grantsPermission(url), false, JSON.stringify(url));
  }
});

test('grantsPermission follows a new base URL', () => {
  const { controller } = fakeWindow(two);
  controller.setConfig({ ...two, baseUrl: 'https://erp.example.com' });
  assert.equal(controller.grantsPermission(`${B}/odoo`), false);
  assert.equal(controller.grantsPermission('https://erp.example.com/odoo'), true);
});

test('setConfig keeps the views of unchanged apps and closes the others', () => {
  const { controller, take, bar } = shownWindow(two);
  controller.selectApp('discuss');
  take();
  const renamed = entry('crm', 'Sales', '/odoo/crm');
  const todo = entry('todo', 'To-do', '/odoo/todo');
  controller.setConfig({ ...two, apps: [discuss, renamed, todo] });
  assert.deepEqual(take(), ['showView discuss']);
  assert.deepEqual(bar()?.apps, [
    { id: 'discuss', name: 'Discuss', close: undefined },
    { id: 'crm', name: 'Sales', close: undefined },
    { id: 'todo', name: 'To-do', close: undefined },
  ]);

  const moved = entry('crm', 'Sales', '/odoo/crm?view=list');
  controller.setConfig({ ...two, apps: [discuss, moved, todo] });
  assert.deepEqual(take(), ['closeView crm', 'showView discuss']);
  controller.selectApp('crm');
  assert.deepEqual(take(), [`openView crm ${B}/odoo/crm?view=list`, 'showView crm']);
});

test('setConfig keeps the notice of an unchanged app and drops it when the address changes', () => {
  const { controller, take, bar } = shownWindow(two);
  controller.loadFailed('crm', `${B}/odoo/crm`, 'ERR_CONNECTION_REFUSED');
  take();
  controller.setConfig({ ...two, apps: [entry('crm', 'Sales', '/odoo/crm'), discuss] });
  assert.deepEqual(take(), ['showView undefined']);
  assert.match(bar()?.notice?.text ?? '', /^Sales could not be loaded/);

  controller.setConfig({ ...two, apps: [entry('crm', 'Sales', '/odoo/crm?view=list'), discuss] });
  assert.deepEqual(take(), ['closeView crm', `openView crm ${B}/odoo/crm?view=list`, 'showView crm']);
  assert.equal(bar()?.notice, undefined);
});

test('setConfig moves to the first app when the active one is gone', () => {
  const { controller, take, bar } = shownWindow(two);
  controller.setConfig({ ...two, apps: [discuss] });
  assert.deepEqual(take(), ['closeView crm', `openView discuss ${B}/odoo/discuss`, 'showView discuss']);
  assert.equal(controller.activeId, 'discuss');
  controller.setConfig({ ...two, apps: [] });
  assert.deepEqual(take(), ['closeView discuss', 'showView undefined']);
  assert.deepEqual(bar()?.notice, { text: 'No apps are configured.', retry: false });
});

test('setConfig closes every view when the base URL changes and judges links by the new one', () => {
  const { controller, take } = shownWindow(two);
  controller.setConfig({ ...two, baseUrl: 'https://erp.example.com' });
  assert.deepEqual(take(), ['closeView crm', 'openView crm https://erp.example.com/odoo/crm', 'showView crm']);
  controller.openLink('crm', `${B}/odoo/crm`);
  assert.deepEqual(take(), [`openExternal ${B}/odoo/crm`]);
  controller.openLink('crm', 'https://erp.example.com/odoo/crm/7');
  assert.deepEqual(take(), ['loadView crm https://erp.example.com/odoo/crm/7']);
});

test('setConfig in a hidden window draws the bar and loads nothing', () => {
  const { controller, take, bar } = fakeWindow(two);
  controller.setConfig({ ...two, apps: [discuss] });
  assert.deepEqual(take(), []);
  assert.deepEqual(bar()?.apps, [{ id: 'discuss', name: 'Discuss', close: undefined }]);
});

/** What a sign-out calls while the window shows CRM as its only view. */
const crmSignOut = ['closeView crm', 'clearProfile', 'showView undefined', `openView crm ${B}/odoo/crm`, 'showView crm'];

test('signOut closes every view, clears the profile, and opens the active app again', async () => {
  const { controller, take } = shownWindow(two);
  controller.selectApp('discuss');
  take();
  const done = controller.signOut();
  assert.deepEqual(take(), ['closeView crm', 'closeView discuss', 'clearProfile', 'showView undefined']);
  await done;
  assert.deepEqual(take(), [`openView discuss ${B}/odoo/discuss`, 'showView discuss']);
  controller.selectApp('crm');
  assert.deepEqual(take(), [`openView crm ${B}/odoo/crm`, 'showView crm']);
});

test('signOut opens no view until the profile is cleared', async () => {
  const { controller, take, bar, clearWith } = shownWindow(two);
  let finish = () => {};
  clearWith(() => new Promise((resolve) => (finish = resolve)));
  const done = controller.signOut();
  take();
  controller.selectApp('discuss');
  controller.pressApp('discuss');
  controller.reloadActive();
  controller.setConfig({ ...two, apps: [discuss, crm] });
  assert.deepEqual(take(), ['showView undefined', 'showView undefined', 'showView undefined']);
  assert.equal(bar()?.activeId, 'discuss');
  assert.equal(bar()?.notice, undefined);
  finish();
  await done;
  assert.deepEqual(take(), [`openView discuss ${B}/odoo/discuss`, 'showView discuss']);
});

test('signOut during a sign-out joins it, and a later one clears again', async () => {
  const { controller, take } = shownWindow(two);
  const first = controller.signOut();
  assert.equal(controller.signOut(), first);
  await first;
  assert.deepEqual(take(), crmSignOut);
  await controller.signOut();
  assert.deepEqual(take(), crmSignOut);
});

test('signOut in a hidden window closes the views and opens none', async () => {
  const { controller, take } = shownWindow(two);
  controller.hide();
  take();
  await controller.signOut();
  assert.deepEqual(take(), ['closeView crm', 'clearProfile']);
  controller.show();
  assert.deepEqual(take(), ['showWindow', `openView crm ${B}/odoo/crm`, 'showView crm']);
});

test('signOut clears the profile without a view and without an app', async () => {
  const hidden = fakeWindow(two);
  await hidden.controller.signOut();
  assert.deepEqual(hidden.take(), ['clearProfile']);

  const empty = shownWindow({ ...two, apps: [] });
  await empty.controller.signOut();
  assert.deepEqual(empty.take(), ['clearProfile', 'showView undefined', 'showView undefined']);
  assert.deepEqual(empty.bar()?.notice, { text: 'No apps are configured.', retry: false });
});

test('signOut drops the notice of a page that did not load', async () => {
  const { controller, take, bar } = shownWindow(two);
  controller.loadFailed('crm', `${B}/odoo/crm`, 'ERR_CONNECTION_REFUSED');
  take();
  await controller.signOut();
  assert.deepEqual(take(), crmSignOut);
  assert.equal(bar()?.notice, undefined);
});

test('signOut rejects with the error of clearProfile and opens the active app again', async () => {
  const failure = new Error('clearing failed');
  const rejecting = shownWindow(two);
  rejecting.clearWith(() => Promise.reject(failure));
  await assert.rejects(rejecting.controller.signOut(), failure);
  assert.deepEqual(rejecting.take(), crmSignOut);

  const throwing = shownWindow(two);
  throwing.clearWith(() => {
    throw failure;
  });
  await assert.rejects(throwing.controller.signOut(), failure);
  throwing.take();
  throwing.clearWith(() => Promise.resolve());
  await throwing.controller.signOut();
  assert.deepEqual(throwing.take(), crmSignOut);
});

/** The menu document of an Odoo whose account has CRM, Discuss, a fleet app without a path, and a calendar. */
const account = {
  root: { id: 'root', children: [235, 83, 900, 12] },
  '235': { id: 235, name: 'CRM', xmlid: 'crm.crm_menu_root', actionID: 394, actionPath: 'crm' },
  '83': { id: 83, name: 'Discuss', xmlid: 'mail.menu_root_discuss', actionID: 137, actionPath: 'discuss' },
  '900': { id: 900, name: 'Fleet of ours', xmlid: 'ours.menu_root', actionID: 1500, actionPath: false },
  '12': { id: 12, name: 'Calendar', xmlid: 'calendar.mail_menu_calendar', actionID: 220, actionPath: 'calendar' },
};

const FLEET = `${B}/odoo/action-1500`;
const CALENDAR = `${B}/odoo/calendar`;

/** A shownWindow that has asked the instance for the apps of the account. */
async function knowingWindow(config: Config = two, messages: Messages = en) {
  const fake = shownWindow(config, messages);
  fake.menus.document = account;
  await fake.controller.pageLoaded();
  return fake;
}

test('followLink moves to the app of the bar that a link opens and keeps the page of both', () => {
  const { controller, take, bar } = shownWindow(two);
  assert.equal(controller.followLink('crm', `${B}/odoo/crm/7`, `${B}/odoo/discuss`), true);
  assert.deepEqual(take(), [`openView discuss ${B}/odoo/discuss`, 'showView discuss']);
  assert.equal(bar()?.activeId, 'discuss');
  // Discuss has a page by now, and the link back shows the page that CRM had.
  assert.equal(controller.followLink('discuss', `${B}/odoo/discuss`, `${B}/odoo/crm/`), true);
  assert.deepEqual(take(), ['showView crm']);
  assert.equal(bar()?.apps.length, 2);
});

test('followLink leaves a link to the page that opens no other app', async () => {
  const { controller, take } = await knowingWindow();
  const page = `${B}/odoo/crm`;
  for (const url of [
    // The app of the view itself.
    `${B}/odoo/crm`,
    // No start address of an app.
    `${B}/odoo/discuss/5`,
    `${B}/odoo/discuss?view_type=list`,
    `${B}/odoo/calendar#week`,
    `${B}/odoo/action-7`,
    'https://www.example.com/odoo/discuss',
    'mailto:someone@example.com',
    'javascript:void(0)',
    '',
  ])
    assert.equal(controller.followLink('crm', page, url), false, url);
  // A page outside the instance, a view in the background, and an app without a view.
  assert.equal(controller.followLink('crm', 'https://login.example.com/sso', `${B}/odoo/discuss`), false);
  assert.equal(controller.followLink('discuss', page, `${B}/odoo/crm`), false);
  assert.equal(controller.followLink('nothing', page, `${B}/odoo/discuss`), false);
  assert.deepEqual(take(), []);
  assert.equal(controller.activeId, 'crm');
});

test('followLink adds an app of the account that the bar lacks, and moves to it from then on', async () => {
  const { controller, take, bar } = await knowingWindow();
  assert.equal(controller.followLink('crm', `${B}/odoo`, FLEET), true);
  assert.deepEqual(take(), [`openView opened-1 ${FLEET}`, 'showView opened-1']);
  assert.deepEqual(bar()?.apps, [
    { id: 'crm', name: 'CRM', close: undefined },
    { id: 'discuss', name: 'Discuss', close: undefined },
    { id: 'opened-1', name: 'Fleet of ours', close: 'Close Fleet of ours' },
  ]);
  assert.equal(bar()?.activeId, 'opened-1');
  assert.equal(bar()?.nav.reload, true);

  // Its own link stays on its page, and its page opens other apps like any other.
  assert.equal(controller.followLink('opened-1', FLEET, FLEET), false);
  assert.equal(controller.followLink('opened-1', FLEET, CALENDAR), true);
  assert.deepEqual(take(), [`openView opened-2 ${CALENDAR}`, 'showView opened-2']);
  assert.equal(controller.followLink('opened-2', CALENDAR, `${B}/odoo/crm`), true);
  assert.equal(controller.followLink('crm', `${B}/odoo/crm`, FLEET), true);
  assert.deepEqual(take(), ['showView crm', 'showView opened-1']);
  assert.deepEqual(bar()?.apps.map((app) => app.id), ['crm', 'discuss', 'opened-1', 'opened-2']);
});

test('followLink knows no app of the account before the instance has named them', async () => {
  const { controller, take, menus } = shownWindow(two);
  assert.equal(controller.followLink('crm', `${B}/odoo`, FLEET), false);
  // Without a login, the instance answers with no menu document.
  await controller.pageLoaded();
  assert.equal(controller.followLink('crm', `${B}/odoo`, FLEET), false);
  menus.document = account;
  await controller.pageLoaded();
  assert.equal(controller.followLink('crm', `${B}/odoo`, FLEET), true);
  assert.deepEqual(take(), [`openView opened-1 ${FLEET}`, 'showView opened-1']);
});

test('pageLoaded keeps the apps of the account while the instance does not answer and takes a new answer', async () => {
  const { controller, take, bar, menus } = await knowingWindow();
  menus.document = new Error('offline');
  await controller.pageLoaded();
  assert.equal(controller.followLink('crm', `${B}/odoo`, FLEET), true);
  controller.closeApp('opened-1');
  controller.selectApp('crm');
  take();

  // The account lost the fleet app and got one more.
  menus.document = { root: { children: [5] }, '5': { id: 5, name: 'Sign', xmlid: 'sign.menu', actionID: 9, actionPath: 'sign' } };
  await controller.pageLoaded();
  assert.equal(controller.followLink('crm', `${B}/odoo`, FLEET), false);
  assert.equal(controller.followLink('crm', `${B}/odoo`, `${B}/odoo/sign`), true);
  assert.deepEqual(bar()?.apps.at(-1), { id: 'opened-2', name: 'Sign', close: 'Close Sign' });
});

test('followLink finds an app of an Odoo before 18 by its menu, however the link is written', async () => {
  const old = entry('crm', 'CRM', '/web#action=107&menu_id=7');
  const { controller, take, bar, menus } = shownWindow({ ...two, apps: [discuss, old] });
  menus.document = {
    root: { children: [7, 8] },
    '7': { id: 7, name: 'CRM', xmlid: 'crm.crm_menu_root', actionID: 107 },
    '8': { id: 8, name: 'Sales', xmlid: 'sale.sale_menu_root', actionID: 108 },
  };
  await controller.pageLoaded();
  // The home page of Odoo 16 writes the link of an app this way.
  assert.equal(controller.followLink('discuss', `${B}/web`, `${B}/web#menu_id=7&action_id=107`), true);
  assert.deepEqual(take(), [`openView crm ${B}/web#action=107&menu_id=7`, 'showView crm']);
  assert.equal(controller.followLink('crm', `${B}/web`, `${B}/web#menu_id=8&action=108`), true);
  assert.deepEqual(take(), [`openView opened-1 ${B}/web#action=108&menu_id=8`, 'showView opened-1']);
  assert.equal(bar()?.apps.at(-1)?.name, 'Sales');
  assert.equal(controller.followLink('opened-1', `${B}/web`, `${B}/web#menu_id=9&action=109`), false);
});

test('followLink resolves the apps of the account against a base URL with a path', async () => {
  const { controller, take } = await knowingWindow({ ...two, baseUrl: `${B}/prefix` });
  assert.equal(controller.followLink('crm', `${B}/prefix/odoo`, FLEET), false);
  assert.equal(controller.followLink('crm', `${B}/odoo`, `${B}/prefix/odoo/action-1500`), false);
  assert.equal(controller.followLink('crm', `${B}/prefix/odoo`, `${B}/prefix/odoo/action-1500`), true);
  assert.deepEqual(take(), [`openView opened-1 ${B}/prefix/odoo/action-1500`, 'showView opened-1']);
});

test('followLink picks an id that no app of the configuration has', async () => {
  const taken = entry('opened-1', 'Taken', '/odoo/taken');
  const { controller, bar } = await knowingWindow({ ...two, apps: [crm, taken] });
  assert.equal(controller.followLink('crm', `${B}/odoo`, FLEET), true);
  assert.deepEqual(bar()?.apps.map((app) => app.id), ['crm', 'opened-1', 'opened-2']);
});

test('openLink moves to the app that a link to a new tab opens, from the active view only', async () => {
  const { controller, take } = await knowingWindow();
  controller.openLink('crm', `${B}/odoo/discuss`);
  assert.deepEqual(take(), [`openView discuss ${B}/odoo/discuss`, 'showView discuss']);
  controller.openLink('discuss', FLEET);
  assert.deepEqual(take(), [`openView opened-1 ${FLEET}`, 'showView opened-1']);
  // No view in the background takes the user away from the app they see.
  controller.openLink('crm', `${B}/odoo/discuss`);
  assert.deepEqual(take(), [`loadView crm ${B}/odoo/discuss`]);
  controller.openLink('opened-1', FLEET);
  assert.deepEqual(take(), [`loadView opened-1 ${FLEET}`]);
});

test('an app that a link opened behaves like every app of the bar', async () => {
  const { controller, take, bar } = await knowingWindow();
  controller.followLink('crm', `${B}/odoo`, FLEET);
  take();
  controller.loadFailed('opened-1', FLEET, 'ERR_CONNECTION_REFUSED');
  assert.deepEqual(take(), ['showView undefined']);
  assert.match(bar()?.notice?.text ?? '', /^Fleet of ours could not be loaded/);
  controller.pressApp('opened-1');
  assert.deepEqual(take(), [`loadView opened-1 ${FLEET}`, 'showView opened-1']);
  controller.pressApp('crm');
  assert.deepEqual(take(), ['showView crm']);
  // The third place of the bar.
  controller.handleShortcut({ kind: 'select', index: 2 });
  assert.deepEqual(take(), ['showView opened-1']);
  controller.viewClosed('opened-1');
  assert.deepEqual(take(), [`openView opened-1 ${FLEET}`, 'showView opened-1']);
  controller.toggleApp('opened-1');
  assert.deepEqual(take(), ['hideWindow']);
});

test('closeApp takes an opened app off the bar with its view and moves to the app next to it', async () => {
  const { controller, take, bar } = await knowingWindow();
  controller.followLink('crm', `${B}/odoo`, FLEET);
  controller.followLink('opened-1', FLEET, CALENDAR);
  controller.selectApp('opened-1');
  take();

  // The active app makes way for the one behind it.
  controller.closeApp('opened-1');
  assert.deepEqual(take(), ['closeView opened-1', 'showView opened-2']);
  assert.deepEqual(bar()?.apps.map((app) => app.id), ['crm', 'discuss', 'opened-2']);

  // An app in the background leaves, and the active one stays.
  controller.followLink('opened-2', CALENDAR, FLEET);
  controller.selectApp('crm');
  take();
  controller.closeApp('opened-3');
  assert.deepEqual(take(), ['closeView opened-3', 'showView crm']);
  assert.equal(controller.activeId, 'crm');

  // The last app of the bar makes way for the one before it.
  controller.selectApp('opened-2');
  take();
  controller.closeApp('opened-2');
  assert.deepEqual(take(), ['closeView opened-2', `openView discuss ${B}/odoo/discuss`, 'showView discuss']);
  assert.deepEqual(bar()?.apps.map((app) => app.id), ['crm', 'discuss']);

  // A closed app opens again under a new id, at its start address.
  controller.followLink('discuss', `${B}/odoo`, FLEET);
  assert.deepEqual(take(), [`openView opened-4 ${FLEET}`, 'showView opened-4']);
});

test('closeApp drops the notice of the app and ignores an app of the configuration and an unknown id', async () => {
  const { controller, take, bar } = await knowingWindow();
  controller.closeApp('crm');
  controller.closeApp('nothing');
  assert.deepEqual(take(), []);
  assert.equal(bar()?.apps.length, 2);

  controller.followLink('crm', `${B}/odoo`, FLEET);
  controller.loadFailed('opened-1', FLEET, 'ERR_CONNECTION_REFUSED');
  take();
  controller.closeApp('opened-1');
  assert.deepEqual(take(), ['closeView opened-1', `openView discuss ${B}/odoo/discuss`, 'showView discuss']);
  assert.equal(bar()?.notice, undefined);
});

test('closeApp of the only app leaves an empty bar', async () => {
  const { controller, take, bar } = await knowingWindow({ ...two, apps: [crm] });
  controller.followLink('crm', `${B}/odoo`, FLEET);
  controller.setConfig({ ...two, apps: [] });
  assert.equal(controller.activeId, 'opened-1');
  take();
  controller.closeApp('opened-1');
  assert.deepEqual(take(), ['closeView opened-1', 'showView undefined']);
  assert.deepEqual(bar()?.notice, { text: 'No apps are configured.', retry: false });
});

test('the close button is German for German messages', async () => {
  const { controller, bar } = await knowingWindow(two, messagesFor('de'));
  controller.followLink('crm', `${B}/odoo`, FLEET);
  assert.equal(bar()?.apps.at(-1)?.close, 'Fleet of ours schließen');
});

test('setConfig keeps an opened app with its view until the configuration lists the app itself', async () => {
  const { controller, take, bar } = await knowingWindow();
  controller.followLink('crm', `${B}/odoo`, FLEET);
  controller.followLink('opened-1', FLEET, CALENDAR);
  take();
  controller.setConfig({ ...two, apps: [discuss, crm] });
  assert.deepEqual(take(), ['showView opened-2']);
  assert.deepEqual(bar()?.apps.map((app) => app.id), ['discuss', 'crm', 'opened-1', 'opened-2']);

  // The calendar is an app of the configuration now, and it takes the place of the active one.
  const calendar = entry('calendar', 'Kalender', '/odoo/calendar');
  controller.setConfig({ ...two, apps: [discuss, calendar, crm] });
  assert.deepEqual(take(), ['closeView opened-2', `openView calendar ${CALENDAR}`, 'showView calendar']);
  assert.deepEqual(bar()?.apps.map((app) => app.id), ['discuss', 'calendar', 'crm', 'opened-1']);
  assert.equal(controller.followLink('calendar', CALENDAR, FLEET), true);
  assert.deepEqual(take(), ['showView opened-1']);

  // An app of the configuration that takes the id of an opened app replaces it.
  controller.selectApp('crm');
  take();
  controller.setConfig({ ...two, apps: [crm, entry('opened-1', 'Other', '/odoo/other')] });
  assert.deepEqual(take(), ['closeView opened-1', 'closeView calendar', 'showView crm']);
  assert.deepEqual(bar()?.apps, [
    { id: 'crm', name: 'CRM', close: undefined },
    { id: 'opened-1', name: 'Other', close: undefined },
  ]);
});

test('setConfig drops every opened app and what the old instance named when the base URL changes', async () => {
  const { controller, take, bar } = await knowingWindow();
  controller.followLink('crm', `${B}/odoo`, FLEET);
  take();
  const erp = 'https://erp.example.com';
  controller.setConfig({ ...two, baseUrl: erp });
  assert.deepEqual(take(), ['closeView crm', 'closeView opened-1', `openView crm ${erp}/odoo/crm`, 'showView crm']);
  assert.equal(bar()?.apps.length, 2);
  assert.equal(controller.followLink('crm', `${erp}/odoo`, `${erp}/odoo/action-1500`), false);
  assert.equal(controller.followLink('crm', `${erp}/odoo`, FLEET), false);
});

test('signOut drops every opened app and the apps of the account, also from an answer on its way', async () => {
  const { controller, take, bar, menus } = await knowingWindow();
  controller.followLink('crm', `${B}/odoo`, FLEET);
  take();
  // The answer that this page asked for arrives after the sign-out.
  const asked = controller.pageLoaded();
  const done = controller.signOut();
  assert.deepEqual(take(), ['closeView crm', 'closeView opened-1', 'clearProfile', 'showView undefined']);
  assert.equal(controller.activeId, 'crm');
  assert.equal(bar()?.apps.length, 2);
  await Promise.all([asked, done]);
  assert.deepEqual(take(), [`openView crm ${B}/odoo/crm`, 'showView crm']);
  assert.equal(controller.followLink('crm', `${B}/odoo`, FLEET), false);

  menus.document = account;
  await controller.pageLoaded();
  assert.equal(controller.followLink('crm', `${B}/odoo`, FLEET), true);
});

const STATE = `${B}/hr_attendance/attendance_user_data`;
const TOGGLE = `${B}/hr_attendance/systray_check_in_out`;

/** SINCE as Odoo writes it: UTC, as `YYYY-MM-DD HH:MM:SS`. */
const SINCE_ODOO = new Date(SINCE).toISOString().slice(0, 19).replace('T', ' ');

/** The answer of the state route for an employee with a check-in at `lastCheckIn`, SINCE by default. */
function attendanceOf(checkedIn: boolean, lastCheckIn: string | false = SINCE_ODOO) {
  return {
    jsonrpc: '2.0',
    id: null,
    result: {
      id: 7,
      hours_today: 1.5,
      last_check_in: lastCheckIn,
      attendance_state: checkedIn ? 'checked_in' : 'checked_out',
      display_systray: true,
    },
  };
}

/** The answer of either route without a login. */
const expired = { jsonrpc: '2.0', id: null, error: { code: 100, message: 'Odoo Session Expired', data: {} } };

/** The answer of either route when Odoo raises an error with this text for the user. */
function refused(message: string) {
  return { jsonrpc: '2.0', id: null, error: { code: 200, message: 'Odoo Server Error', data: { message } } };
}

/** Answers one post after the other with these values. A promise answers once it settles, and an Error rejects. */
function inTurn(...answers: unknown[]) {
  return () => {
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lets every settled promise run its callbacks. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A shownWindow whose button shows the state that the instance answered, with the posts so far dropped. */
async function attendingWindow(checkedIn: boolean, config: Config = two, messages: Messages = en) {
  const fake = shownWindow(config, messages);
  fake.odoo.answer = () => attendanceOf(checkedIn);
  await fake.controller.refreshAttendance();
  fake.odoo.posts.length = 0;
  return fake;
}

const checkIn = { checkedIn: false, hint: 'Check in', busy: false };
const checkOut = { checkedIn: true, hint: `Check out (checked in since ${checkInClock(SINCE, NOW, 'en')})`, busy: false };

test('the bar has no attendance button before Odoo answered, and show asks Odoo for the state', async () => {
  const { controller, bar, odoo } = fakeWindow(two);
  controller.show();
  assert.equal(bar()?.attendance, undefined);
  await settle();
  assert.deepEqual(odoo.posts, [STATE]);
  // The instance answered with no document, as one without the routes does.
  assert.equal(bar()?.attendance, undefined);
});

test('refreshAttendance shows the button for a checked-out employee', async () => {
  const { controller, bar, odoo } = fakeWindow(two);
  odoo.answer = () => attendanceOf(false);
  await controller.refreshAttendance();
  assert.deepEqual(bar()?.attendance, checkIn);
  assert.deepEqual(odoo.posts, [STATE]);
});

test('the hint names the time of the check-in, or none when Odoo names none, and is German for German messages', async () => {
  const { controller, bar, odoo } = fakeWindow(two);
  odoo.answer = () => attendanceOf(true);
  await controller.refreshAttendance();
  assert.deepEqual(bar()?.attendance, checkOut);
  assert.match(bar()?.attendance?.hint ?? '', /^Check out \(checked in since 08:15\sAM\)$/u);

  odoo.answer = () => attendanceOf(true, false);
  await controller.refreshAttendance();
  assert.deepEqual(bar()?.attendance, { checkedIn: true, hint: 'Check out', busy: false });

  // A check-in on the day before names its day.
  odoo.now = SINCE + 24 * 3_600_000;
  odoo.answer = () => attendanceOf(true);
  await controller.refreshAttendance();
  assert.equal(bar()?.attendance?.hint, `Check out (checked in since ${checkInClock(SINCE, odoo.now, 'en')})`);
  assert.match(bar()?.attendance?.hint ?? '', /Oct/);

  const german = await attendingWindow(false, two, messagesFor('de'));
  assert.deepEqual(german.bar()?.attendance, { checkedIn: false, hint: 'Einchecken', busy: false });
  german.odoo.answer = () => attendanceOf(true);
  await german.controller.refreshAttendance();
  assert.equal(german.bar()?.attendance?.hint, `Auschecken (eingecheckt seit ${checkInClock(SINCE, NOW, 'de')})`);
});

test('the button is absent for every state that is not usable', async () => {
  const notUsable: [string, unknown][] = [
    ['unavailable', undefined],
    ['signed-out', expired],
    ['no-employee', { jsonrpc: '2.0', id: null, result: {} }],
    ['systray-off', { ...attendanceOf(false), result: { ...attendanceOf(false).result, display_systray: false } }],
  ];
  for (const [kind, answer] of notUsable) {
    const { controller, bar, odoo } = await attendingWindow(false);
    assert.deepEqual(bar()?.attendance, checkIn, kind);
    odoo.answer = () => answer;
    await controller.refreshAttendance();
    assert.equal(bar()?.attendance, undefined, kind);
  }
});

test('refreshAttendance keeps the button when Odoo does not answer, and logs why', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const { controller, bar, odoo } = await attendingWindow(true);
  const failure = new Error('net::ERR_INTERNET_DISCONNECTED');
  odoo.answer = inTurn(failure, refused('Odoo is down.'));
  await controller.refreshAttendance();
  assert.deepEqual(bar()?.attendance, checkOut);
  await controller.refreshAttendance();
  assert.deepEqual(bar()?.attendance, checkOut);
  assert.equal(log.mock.callCount(), 2);
  assert.deepEqual(log.mock.calls[0]?.arguments, [`OdooBar could not read the attendance state of ${B}:`, failure]);
});

test('of two reads in flight only the answer of the later one reaches the bar', async () => {
  const { controller, bar, odoo } = fakeWindow(two);
  const earlier = deferred<unknown>();
  const later = deferred<unknown>();
  odoo.answer = inTurn(earlier.promise, later.promise);
  const first = controller.refreshAttendance();
  const second = controller.refreshAttendance();
  later.resolve(attendanceOf(true));
  await second;
  earlier.resolve(attendanceOf(false));
  await first;
  assert.deepEqual(bar()?.attendance, checkOut);
});

test('with the switch off OdooBar asks nothing about attendance', async () => {
  const { controller, bar, odoo } = fakeWindow({ ...two, attendance: false });
  odoo.answer = () => attendanceOf(false);
  controller.show();
  await controller.refreshAttendance();
  await controller.pressAttendance();
  await settle();
  assert.deepEqual(odoo.posts, []);
  assert.equal(bar()?.attendance, undefined);
});

test('a click reads the state, checks in, and reads again', async () => {
  const { controller, take, bar, odoo } = await attendingWindow(false);
  const first = deferred<unknown>();
  odoo.answer = inTurn(first.promise, { jsonrpc: '2.0', id: null, result: {} }, attendanceOf(true));
  const click = controller.pressAttendance();
  assert.deepEqual(bar()?.attendance, { ...checkIn, busy: true });
  first.resolve(attendanceOf(false));
  await click;
  assert.deepEqual(odoo.posts, [STATE, TOGGLE, STATE]);
  assert.deepEqual(bar()?.attendance, checkOut);
  assert.deepEqual(take(), []);
});

test('a click on an outdated icon only updates the icon', async () => {
  const { controller, take, bar, odoo } = await attendingWindow(false);
  // A check-in on a phone since the last read.
  odoo.answer = inTurn(attendanceOf(true));
  await controller.pressAttendance();
  assert.deepEqual(odoo.posts, [STATE]);
  assert.deepEqual(bar()?.attendance, checkOut);
  assert.deepEqual(take(), []);
});

test('a click after the login expired removes the button and says so', async () => {
  const { controller, take, bar, odoo } = await attendingWindow(false);
  odoo.answer = inTurn(expired);
  await controller.pressAttendance();
  assert.deepEqual(odoo.posts, [STATE]);
  assert.deepEqual(take(), ['showFailure OdooBar could not check you in | Sign in to Odoo in the OdooBar window first.']);
  assert.equal(bar()?.attendance, undefined);
});

test('a click that cannot reach Odoo keeps the icon and names the reason', async () => {
  const { controller, take, bar, odoo } = await attendingWindow(false);
  odoo.answer = inTurn(new Error('net::ERR_INTERNET_DISCONNECTED'));
  await controller.pressAttendance();
  assert.deepEqual(odoo.posts, [STATE]);
  assert.deepEqual(take(), ['showFailure OdooBar could not check you in | net::ERR_INTERNET_DISCONNECTED']);
  assert.deepEqual(bar()?.attendance, checkIn);
});

test('a change that Odoo refuses is reported with the text of Odoo, and the button shows the state after it', async () => {
  const { controller, take, bar, odoo } = await attendingWindow(true);
  odoo.answer = inTurn(attendanceOf(true), refused('You cannot check out now.'), attendanceOf(true, false));
  await controller.pressAttendance();
  assert.deepEqual(odoo.posts, [STATE, TOGGLE, STATE]);
  assert.deepEqual(take(), ['showFailure OdooBar could not check you out | You cannot check out now.']);
  assert.deepEqual(bar()?.attendance, { checkedIn: true, hint: 'Check out', busy: false });
});

test('a change without an answer or after the login expired is reported', async () => {
  const { controller, take, bar, odoo } = await attendingWindow(false);
  odoo.answer = inTurn(attendanceOf(false), undefined, attendanceOf(false));
  await controller.pressAttendance();
  assert.deepEqual(odoo.posts.splice(0), [STATE, TOGGLE, STATE]);
  assert.deepEqual(take(), ['showFailure OdooBar could not check you in | Odoo did not answer the request.']);
  assert.deepEqual(bar()?.attendance, checkIn);

  odoo.answer = inTurn(attendanceOf(false), expired, expired);
  await controller.pressAttendance();
  assert.deepEqual(odoo.posts, [STATE, TOGGLE, STATE]);
  assert.deepEqual(take(), ['showFailure OdooBar could not check you in | Sign in to Odoo in the OdooBar window first.']);
  assert.equal(bar()?.attendance, undefined);
});

test('a change that Odoo made although its answer timed out or got lost is no failure', async () => {
  const { controller, take, bar, odoo } = await attendingWindow(false);
  odoo.answer = inTurn(attendanceOf(false), new Error('The operation was aborted due to timeout'), attendanceOf(true));
  await controller.pressAttendance();
  assert.deepEqual(odoo.posts.splice(0), [STATE, TOGGLE, STATE]);
  assert.deepEqual(take(), []);
  assert.deepEqual(bar()?.attendance, checkOut);

  // A proxy that answered with its own error page after Odoo checked out.
  odoo.answer = inTurn(attendanceOf(true), undefined, attendanceOf(false));
  await controller.pressAttendance();
  assert.deepEqual(odoo.posts, [STATE, TOGGLE, STATE]);
  assert.deepEqual(take(), []);
  assert.deepEqual(bar()?.attendance, checkIn);
});

test('a click whose last read fails keeps the icon it had, logs why, and the next click asks first', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const { controller, take, bar, odoo } = await attendingWindow(false);
  const failure = new Error('net::ERR_TIMED_OUT');
  odoo.answer = inTurn(attendanceOf(false), { jsonrpc: '2.0', id: null, result: {} }, failure);
  await controller.pressAttendance();
  assert.deepEqual(odoo.posts.splice(0), [STATE, TOGGLE, STATE]);
  assert.deepEqual(take(), []);
  assert.deepEqual(bar()?.attendance, checkIn);
  assert.deepEqual(log.mock.calls.map((call) => call.arguments), [
    [`OdooBar could not read the attendance state of ${B} after a click:`, failure],
  ]);

  // The check-in worked, so the next click finds it and changes nothing.
  odoo.answer = inTurn(attendanceOf(true));
  await controller.pressAttendance();
  assert.deepEqual(odoo.posts, [STATE]);
  assert.deepEqual(bar()?.attendance, checkOut);
});

test('a second click and a read during a click ask nothing', async () => {
  const { controller, bar, odoo } = await attendingWindow(false);
  const first = deferred<unknown>();
  odoo.answer = inTurn(first.promise, { jsonrpc: '2.0', id: null, result: {} }, attendanceOf(true));
  const click = controller.pressAttendance();
  await controller.pressAttendance();
  await controller.refreshAttendance();
  assert.deepEqual(odoo.posts, [STATE]);
  first.resolve(attendanceOf(false));
  await click;
  assert.deepEqual(odoo.posts, [STATE, TOGGLE, STATE]);
  assert.deepEqual(bar()?.attendance, checkOut);
});

test('a click without a button asks nothing', async () => {
  // Before an answer.
  const hidden = fakeWindow(two);
  hidden.odoo.answer = () => attendanceOf(false);
  await hidden.controller.pressAttendance();
  assert.deepEqual(hidden.odoo.posts, []);

  // With the switch off since the last answer.
  const off = await attendingWindow(false);
  off.controller.setConfig({ ...two, attendance: false });
  await off.controller.pressAttendance();
  assert.deepEqual(off.odoo.posts, []);

  // After an answer that is not usable.
  const employeeless = shownWindow(two);
  employeeless.odoo.answer = () => ({ jsonrpc: '2.0', id: null, result: {} });
  await employeeless.controller.refreshAttendance();
  employeeless.odoo.posts.length = 0;
  await employeeless.controller.pressAttendance();
  assert.deepEqual(employeeless.odoo.posts, []);
  assert.deepEqual(employeeless.take(), []);
});

test('signOut removes the button at once and ends a click on its way without a change and without a word', async () => {
  const { controller, take, bar, odoo } = await attendingWindow(false);
  const first = deferred<unknown>();
  odoo.answer = inTurn(first.promise, { jsonrpc: '2.0', id: null, result: {} }, attendanceOf(true));
  const click = controller.pressAttendance();
  const done = controller.signOut();
  assert.equal(bar()?.attendance, undefined);
  first.resolve(attendanceOf(false));
  await Promise.all([click, done]);
  assert.deepEqual(odoo.posts, [STATE]);
  assert.equal(bar()?.attendance, undefined);
  assert.ok(!take().some((call) => call.startsWith('showFailure')));

  // The login page that loads next reads again, and a click works as before.
  odoo.answer = () => attendanceOf(false);
  await controller.refreshAttendance();
  assert.deepEqual(bar()?.attendance, checkIn);
});

test("Odoo's own check-in button in a view reads the state, and the same route on another site asks nothing", async () => {
  const { controller, bar, odoo } = await attendingWindow(false);
  odoo.answer = () => attendanceOf(true);
  await controller.attendanceSwitched('https://attacker.example/hr_attendance/systray_check_in_out');
  assert.deepEqual(odoo.posts, []);
  assert.deepEqual(bar()?.attendance, checkIn);

  await controller.attendanceSwitched(TOGGLE);
  assert.deepEqual(odoo.posts, [STATE]);
  assert.deepEqual(bar()?.attendance, checkOut);
});

test("Odoo's own check-in button follows an instance below a path prefix, whose button posts to the root", async () => {
  const { controller, bar, odoo } = await attendingWindow(false, { ...two, baseUrl: `${B}/erp` });
  odoo.answer = () => attendanceOf(true);
  await controller.attendanceSwitched(TOGGLE);
  assert.deepEqual(odoo.posts, [`${B}/erp/hr_attendance/attendance_user_data`]);
  assert.deepEqual(bar()?.attendance, checkOut);
});

test('a saved configuration switches the button off without a request, on with a read, and follows a new instance', async () => {
  const { controller, bar, odoo } = await attendingWindow(false);
  controller.setConfig({ ...two, attendance: false });
  assert.equal(bar()?.attendance, undefined);
  await settle();
  assert.deepEqual(odoo.posts, []);

  controller.setConfig(two);
  await settle();
  assert.deepEqual(odoo.posts.splice(0), [STATE]);
  assert.deepEqual(bar()?.attendance, checkIn);

  const erp = 'https://erp.example.com';
  controller.setConfig({ ...two, baseUrl: erp });
  assert.equal(bar()?.attendance, undefined);
  await settle();
  assert.deepEqual(odoo.posts.splice(0), [`${erp}/hr_attendance/attendance_user_data`]);
  assert.deepEqual(bar()?.attendance, checkIn);

  // A save that changes neither the instance nor the switch asks nothing.
  controller.setConfig({ ...two, baseUrl: erp, apps: [discuss] });
  await settle();
  assert.deepEqual(odoo.posts, []);
  assert.deepEqual(bar()?.attendance, checkIn);
});

test('a new instance ends a click on its way without a word', async () => {
  const { controller, take, bar, odoo } = await attendingWindow(true);
  const first = deferred<unknown>();
  odoo.answer = inTurn(first.promise);
  const click = controller.pressAttendance();
  odoo.answer = () => attendanceOf(false);
  controller.setConfig({ ...two, baseUrl: 'https://erp.example.com' });
  await settle();
  first.resolve(attendanceOf(true));
  await click;
  assert.deepEqual(odoo.posts, [STATE, 'https://erp.example.com/hr_attendance/attendance_user_data']);
  assert.deepEqual(bar()?.attendance, checkIn);
  assert.ok(!take().some((call) => call.startsWith('showFailure')));
});
