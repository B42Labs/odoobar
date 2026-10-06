import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aboutDialog, appMenu, REPOSITORY_URL, type MenuEntry } from '../../src/main/app-menu';
import { messagesFor } from '../../src/main/messages';

const en = messagesFor('en');
const de = messagesFor('de');

/** A menu whose actions record their calls. */
function menuWith({ settings = true } = {}) {
  const calls: string[] = [];
  const menu = appMenu(en, {
    about: () => calls.push('about'),
    ...(settings ? { settings: () => calls.push('settings') } : {}),
  });
  return { menu, calls };
}

/** The labels of a menu, with `-` for a separator. */
function labels(entries: readonly MenuEntry[] | undefined): string[] {
  return (entries ?? []).map((entry) => (entry.type === 'separator' ? '-' : (entry.label ?? '')));
}

/** Every entry of a menu, the ones in submenus included. */
function flat(entries: readonly MenuEntry[]): MenuEntry[] {
  return entries.flatMap((entry) => [entry, ...flat(entry.submenu ?? [])]);
}

function entryOf(menu: readonly MenuEntry[], label: string): MenuEntry {
  const entry = flat(menu).find((candidate) => candidate.label === label);
  assert.ok(entry, `no entry ${label}`);
  return entry;
}

test('the menu starts with OdooBar and has Edit, View, and Window', () => {
  const { menu } = menuWith();
  assert.deepEqual(labels(menu), ['OdooBar', 'Edit', 'View', 'Window']);
  assert.deepEqual(labels(menu[0]?.submenu), [
    'About OdooBar',
    '-',
    'Settings…',
    '-',
    'Hide OdooBar',
    'Hide Others',
    'Show All',
    '-',
    'Quit OdooBar',
  ]);
  assert.equal(menu[3]?.role, 'window');
});

test('the menu is German for German messages', () => {
  const menu = appMenu(de, { about: () => {} });
  assert.deepEqual(labels(menu), ['OdooBar', 'Bearbeiten', 'Darstellung', 'Fenster']);
  assert.deepEqual(labels(menu[0]?.submenu), [
    'Über OdooBar',
    '-',
    'Einstellungen …',
    '-',
    'OdooBar ausblenden',
    'Andere ausblenden',
    'Alle einblenden',
    '-',
    'OdooBar beenden',
  ]);
});

test('About and Settings call their actions, and Settings has ⌘,', () => {
  const { menu, calls } = menuWith();
  entryOf(menu, 'About OdooBar').click?.();
  const settings = entryOf(menu, 'Settings…');
  assert.equal(settings.accelerator, 'Command+,');
  assert.equal(settings.enabled, true);
  settings.click?.();
  assert.deepEqual(calls, ['about', 'settings']);
});

test('Settings is disabled while there is no way to the settings', () => {
  const { menu, calls } = menuWith({ settings: false });
  const settings = entryOf(menu, 'Settings…');
  assert.equal(settings.enabled, false);
  settings.click?.();
  assert.deepEqual(calls, []);
});

test('every other entry has a role, a label, and no key of its own', () => {
  const { menu } = menuWith();
  const own = new Set(['About OdooBar', 'Settings…']);
  for (const entry of flat(menu).filter(({ type, submenu }) => type !== 'separator' && !submenu)) {
    if (own.has(entry.label ?? '')) continue;
    assert.ok(entry.role, `${entry.label} has no role`);
    assert.ok(entry.label, `${entry.role} has no label`);
    assert.equal(entry.accelerator, undefined, `${entry.label} has a key of its own`);
    assert.equal(entry.click, undefined, `${entry.label} has a click of its own`);
  }
});

test('the menu keeps the keys of Edit, zoom, and Window, and reloads no page', () => {
  const { menu } = menuWith();
  const roles = flat(menu).flatMap(({ role }) => (role ? [role as string] : []));
  const kept = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'zoomIn', 'zoomOut', 'resetZoom'];
  for (const role of [...kept, 'hide', 'quit', 'minimize', 'close']) {
    assert.ok(roles.includes(role), `no entry with the role ${role}`);
  }
  // ⌘R belongs to the window, and a reload of the settings would drop unsaved edits.
  assert.ok(!roles.includes('reload') && !roles.includes('forceReload'));
});

test('the About dialog names the version and the repository', () => {
  assert.deepEqual(aboutDialog(en, '1.2.3'), {
    message: 'OdooBar',
    detail: `Version 1.2.3\n\n${REPOSITORY_URL}`,
    buttons: ['OK', 'Open on GitHub'],
  });
  assert.deepEqual(aboutDialog(de, '1.2.3').buttons, ['OK', 'Auf GitHub öffnen']);
  assert.equal(REPOSITORY_URL, 'https://github.com/B42Labs/odoobar');
});
