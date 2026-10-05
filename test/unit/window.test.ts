import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppConfig, Config } from '../../src/main/config';
import { messagesFor, type Messages } from '../../src/main/messages';
import { WindowController, type BarState, type Desktop, type WindowUi } from '../../src/main/window';

const en = messagesFor('en');
const B = 'https://odoo.example.com';

function entry(id: string, name: string, url: string): AppConfig {
  return { id, name, url, icon: '', shortcut: '', menuBar: false };
}

const crm = entry('crm', 'CRM', '/odoo/crm');
const discuss = entry('discuss', 'Discuss', '/odoo/discuss');
const two: Config = { baseUrl: B, launchAtLogin: false, apps: [crm, discuss] };

/**
 * A WindowController on a screen and a system that record every call but
 * renderBar as text. `take` returns the calls since the last `take`, and
 * `bar` the last state that the app bar got. clearProfile resolves at once
 * unless `clearWith` replaces it.
 */
function fakeWindow(config: Config, messages: Messages = en) {
  let calls: string[] = [];
  let state: BarState | undefined;
  let clear = (): Promise<void> => Promise.resolve();
  const ui: WindowUi = {
    openView: (id, url) => calls.push(`openView ${id} ${url}`),
    closeView: (id) => calls.push(`closeView ${id}`),
    loadView: (id, url) => calls.push(`loadView ${id} ${url}`),
    reloadView: (id) => calls.push(`reloadView ${id}`),
    showView: (id) => calls.push(`showView ${id}`),
    renderBar: (next) => {
      state = next;
    },
    showWindow: () => calls.push('showWindow'),
    hideWindow: () => calls.push('hideWindow'),
    clearProfile: () => {
      calls.push('clearProfile');
      return clear();
    },
  };
  const desktop: Desktop = {
    openExternal: (url) => calls.push(`openExternal ${url}`),
    revealConfig: () => calls.push('revealConfig'),
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
  return { controller, take, bar: () => state, clearWith };
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
      { id: 'crm', name: 'CRM' },
      { id: 'discuss', name: 'Discuss' },
    ],
    activeId: 'crm',
    notice: undefined,
    texts: { settings: 'Settings', retry: 'Try again' },
  });
});

test('show resolves a path against the base URL and keeps a full URL', () => {
  const other = entry('other', 'Other', 'https://other.example.com/x?y=1');
  const { controller, take } = fakeWindow({ baseUrl: `${B}/prefix`, launchAtLogin: false, apps: [other, crm] });
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
  assert.deepEqual(take(), ['revealConfig']);
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
  assert.deepEqual(bar()?.texts, { settings: 'Einstellungen', retry: 'Erneut versuchen' });
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
    { id: 'discuss', name: 'Discuss' },
    { id: 'crm', name: 'Sales' },
    { id: 'todo', name: 'To-do' },
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
  assert.deepEqual(bar()?.apps, [{ id: 'discuss', name: 'Discuss' }]);
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
