import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, type AppConfig, type Config } from '../../src/main/config';
import { isIconName, MenuBar, menuBarItems, type MenuBarItem, type MenuBarUi } from '../../src/main/menu-bar';

const B = 'https://odoo.example.com';

function entry(id: string, name: string, icon: string, menuBar: boolean): AppConfig {
  return { id, name, url: `/odoo/${id}`, icon, shortcut: '', menuBar };
}

const crm = entry('crm', 'CRM', 'handshake', true);
const discuss = entry('discuss', 'Discuss', 'message-circle', false);
const calendar = entry('calendar', 'Calendar', '', true);
const three: Config = { baseUrl: B, launchAtLogin: false, attendance: true, apps: [crm, discuss, calendar] };

/** A menu bar that records the items of every showItems call. `take` returns the calls since the last `take`. */
function fakeMenuBar() {
  let calls: MenuBarItem[][] = [];
  const ui: MenuBarUi = { showItems: (items) => calls.push([...items]) };
  const take = () => {
    const taken = calls;
    calls = [];
    return taken;
  };
  return { ui, take };
}

test('menuBarItems lists the apps with the menu bar flag in the order of the configuration', () => {
  assert.deepEqual(menuBarItems(three), [
    { id: 'crm', name: 'CRM', icon: 'handshake' },
    { id: 'calendar', name: 'Calendar', icon: '' },
  ]);
  assert.deepEqual(menuBarItems({ ...three, apps: [discuss] }), []);
  assert.deepEqual(menuBarItems({ ...three, apps: [] }), []);
});

test('menuBarItems gives an app without the menuBar key no icon and one without the icon key an empty icon name', () => {
  const file = (app: object) =>
    JSON.stringify({ baseUrl: B, apps: [{ id: 'crm', name: 'CRM', url: '/odoo/crm', ...app }] });
  assert.deepEqual(menuBarItems(parseConfig(file({}))), []);
  assert.deepEqual(menuBarItems(parseConfig(file({ menuBar: true }))), [{ id: 'crm', name: 'CRM', icon: '' }]);
  assert.deepEqual(menuBarItems(parseConfig(JSON.stringify({ baseUrl: B }))), []);
});

test('a MenuBar shows the icons of its configuration at once', () => {
  const { ui, take } = fakeMenuBar();
  new MenuBar(ui, three);
  assert.deepEqual(take(), [
    [
      { id: 'crm', name: 'CRM', icon: 'handshake' },
      { id: 'calendar', name: 'Calendar', icon: '' },
    ],
  ]);
});

test('a MenuBar shows nothing for an empty app list and for apps without the flag', () => {
  for (const apps of [[], [discuss]]) {
    const { ui, take } = fakeMenuBar();
    new MenuBar(ui, { ...three, apps });
    assert.deepEqual(take(), [], JSON.stringify(apps));
  }
});

test('setConfig replaces the icons when an app, a name, an icon, or the order changes', () => {
  const { ui, take } = fakeMenuBar();
  const menuBar = new MenuBar(ui, three);
  take();
  const flagged = { ...discuss, menuBar: true };
  const renamed = { ...calendar, name: 'Kalender' };
  const drawn = { ...renamed, icon: 'calendar' };
  const saves: Config[] = [
    { ...three, apps: [crm, flagged, calendar] },
    { ...three, apps: [crm, flagged, renamed] },
    { ...three, apps: [crm, flagged, drawn] },
    { ...three, apps: [drawn, flagged, crm] },
    { ...three, apps: [flagged, crm] },
  ];
  for (const [index, config] of saves.entries()) {
    menuBar.setConfig(config);
    assert.deepEqual(take(), [menuBarItems(config)], `save ${index + 1}`);
  }
});

test('setConfig leaves the icons alone when nothing of theirs changes', () => {
  const { ui, take } = fakeMenuBar();
  const menuBar = new MenuBar(ui, three);
  take();
  menuBar.setConfig({ ...three, baseUrl: 'https://erp.example.com', launchAtLogin: true });
  assert.deepEqual(take(), []);
  const moved = { ...crm, url: 'https://crm.example.com/odoo', shortcut: 'Control+Alt+C' };
  const unflagged = { ...discuss, name: 'Chat', icon: 'messages-square' };
  menuBar.setConfig({ ...three, apps: [moved, unflagged, calendar] });
  assert.deepEqual(take(), []);
});

test('setConfig removes every icon when no app keeps the flag', () => {
  const { ui, take } = fakeMenuBar();
  const menuBar = new MenuBar(ui, three);
  take();
  menuBar.setConfig({ ...three, apps: [{ ...crm, menuBar: false }, discuss, { ...calendar, menuBar: false }] });
  assert.deepEqual(take(), [[]]);
  menuBar.setConfig({ ...three, apps: [] });
  assert.deepEqual(take(), []);
});

test('isIconName accepts the form of a Lucide name and nothing else', () => {
  for (const name of ['house', 'message-circle', 'clock-4', 'a-arrow-down', 'app-window']) {
    assert.equal(isIconName(name), true, name);
  }
  const others = [
    '',
    'House',
    'message circle',
    '../icons/house',
    'house.png',
    'house@2x',
    '-house',
    'house-',
    'a--b',
    'häuser',
  ];
  for (const name of others) {
    assert.equal(isIconName(name), false, JSON.stringify(name));
  }
});
