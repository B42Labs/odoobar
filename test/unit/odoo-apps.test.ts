import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateConfig } from '../../src/main/config';
import { appIcons, loadOdooApps, menuUrls, odooApps } from '../../src/main/odoo-apps';
import { projectRoot } from '../support/app-process';

/** A menu as Odoo 18 and later send it. `more` replaces fields or adds some. */
function menu(id: number, name: string, xmlid: string, more: object = {}) {
  return {
    id,
    name,
    children: [],
    appID: id,
    xmlid,
    actionID: id + 100,
    actionModel: 'ir.actions.act_window',
    actionPath: false,
    webIcon: 'base,static/description/icon.png',
    webIconData: 'data:image/png;base64,iVBORw0KGgo=',
    webIconDataMimetype: 'image/png',
    ...more,
  };
}

/** The menu document of Odoo for these apps: every menu by its id, and `root` with the ids in order. */
function document(...apps: { id: unknown }[]) {
  const root = { id: 'root', name: 'root', children: apps.map((app) => app.id), appID: false, xmlid: '' };
  return { root, ...Object.fromEntries(apps.map((app) => [String(app.id), app])) };
}

test('odooApps lists the apps in the order of root, with the path of their action', () => {
  const menus = document(
    menu(83, 'Discuss', 'mail.menu_root_discuss', { actionPath: 'discuss' }),
    menu(550, 'Point of Sale', 'point_of_sale.menu_point_root', { actionPath: 'point-of-sale' }),
    menu(261, 'Documents', 'documents.menu_root'),
  );
  assert.deepEqual(odooApps(menus), [
    { name: 'Discuss', url: '/odoo/discuss', icon: 'message-circle' },
    { name: 'Point of Sale', url: '/odoo/point-of-sale', icon: 'store' },
    { name: 'Documents', url: '/odoo/action-361', icon: 'folder' },
  ]);
});

test('odooApps ignores a menu that is no child of root', () => {
  const menus = { ...document(menu(7, 'CRM', 'crm.crm_menu_root')), '8': menu(8, 'Pipeline', 'crm.menu_crm_opportunities') };
  assert.deepEqual(odooApps(menus)?.map((app) => app.name), ['CRM']);
});

test('odooApps opens an app of an Odoo before 18 by the numbers of its action and menu', () => {
  const { actionPath: _none, ...old } = menu(7, 'CRM', 'crm.crm_menu_root');
  assert.deepEqual(odooApps(document(old)), [{ name: 'CRM', url: '/web#action=107&menu_id=7', icon: 'handshake' }]);
});

test('odooApps tells the two apps of the module base apart', () => {
  const menus = document(
    menu(1, 'Apps', 'base.menu_management'),
    menu(9, 'Settings', 'base.menu_administration'),
    menu(10, 'Other', 'base.menu_other'),
  );
  assert.deepEqual(odooApps(menus)?.map((app) => app.icon), ['layout-grid', 'settings', '']);
});

test('odooApps gives an app that it does not know no icon', () => {
  const icon = (xmlid: unknown) => odooApps(document(menu(7, 'Custom', '', { xmlid })))?.[0]?.icon;
  assert.equal(icon('my_module.menu_root'), '');
  assert.equal(icon(''), '');
  assert.equal(icon(false), '');
  // A name of Object.prototype is no module.
  assert.equal(icon('constructor.menu'), '');
  assert.equal(icon('toString'), '');
});

test('odooApps never puts a text of the server into an address unchecked', () => {
  const url = (more: object) => odooApps(document(menu(7, 'CRM', 'crm.crm_menu_root', more)))?.[0]?.url;
  for (const actionPath of ['../web/session/logout', 'crm?debug=1', 'crm#x', 'Crm', '1crm', 'a b', '', 7, null]) {
    assert.equal(url({ actionPath }), '/odoo/action-107', String(actionPath));
  }
  const { actionPath: _none, ...old } = menu(7, 'CRM', 'crm.crm_menu_root');
  assert.deepEqual(odooApps(document({ ...old, id: 7 }, { ...old, id: '8&x=1' }))?.map((app) => app.url), [
    '/web#action=107&menu_id=7',
    '/web#action=107',
  ]);
});

test('odooApps leaves out a menu without a name or an action', () => {
  const menus = document(
    menu(1, '', 'a.a'),
    menu(2, '   ', 'a.b'),
    menu(3, 'No action', 'a.c', { actionID: false }),
    menu(4, 'Text action', 'a.d', { actionID: '12' }),
    menu(5, 'Negative', 'a.e', { actionID: -1 }),
    menu(6, 'Fraction', 'a.f', { actionID: 1.5 }),
    menu(7, 'No name', 'a.g', { name: 12 }),
    menu(8, '  Kept ', 'a.h'),
  );
  assert.deepEqual(odooApps(menus), [{ name: 'Kept', url: '/odoo/action-108', icon: '' }]);
});

test('odooApps skips a child of root that the document does not hold', () => {
  const menus = document(menu(7, 'CRM', 'crm.crm_menu_root'));
  const withMore = { ...menus, root: { ...menus.root, children: [99, 'toString', null, 7] }, '99': 'no menu' };
  assert.deepEqual(odooApps(withMore)?.map((app) => app.name), ['CRM']);
});

test('odooApps gives undefined for a value that is no menu document', () => {
  for (const value of [undefined, null, 'text', 12, [], {}, { root: null }, { root: {} }, { root: { children: {} } }]) {
    assert.equal(odooApps(value), undefined, JSON.stringify(value));
  }
  assert.deepEqual(odooApps({ root: { children: [] } }), []);
});

test('every app of odooApps is a valid app of the configuration', () => {
  const { actionPath: _none, ...old } = menu(8, 'Old', 'sale.sale_menu_root');
  const apps = odooApps(document(menu(7, 'CRM', 'crm.crm_menu_root', { actionPath: 'crm' }), menu(9, 'Other', 'x.y'), old));
  assert.equal(apps?.length, 3);
  const draft = { baseUrl: 'https://odoo.example.com', apps: apps?.map((app, index) => ({ id: `app-${index}`, ...app })) };
  assert.deepEqual(
    validateConfig(draft).apps.map(({ name, url, icon }) => ({ name, url, icon })),
    apps,
  );
});

test('Lucide has every icon that odooApps names', () => {
  assert.ok(appIcons.length > 0);
  for (const icon of appIcons) {
    assert.ok(existsSync(join(projectRoot, 'node_modules/lucide-static/icons', `${icon}.svg`)), icon);
  }
});

test('loadOdooApps asks the address of Odoo 19 first and stops at the first menu document', async () => {
  const B = 'https://odoo.example.com';
  const menus = document(menu(7, 'CRM', 'crm.crm_menu_root', { actionPath: 'crm' }));
  const [current, earlier] = menuUrls(B);
  assert.deepEqual([current, earlier], [`${B}/web/webclient/load_menus`, `${B}/web/webclient/load_menus/odoobar`]);

  const asked: string[] = [];
  const answer = (documents: Record<string, unknown>) => (url: string) => {
    asked.push(url);
    return Promise.resolve(documents[url]);
  };
  assert.deepEqual(await loadOdooApps(B, answer({ [current ?? '']: menus })), [
    { name: 'CRM', url: '/odoo/crm', icon: 'handshake' },
  ]);
  assert.deepEqual(asked.splice(0), [current]);

  assert.equal((await loadOdooApps(B, answer({ [earlier ?? '']: menus })))?.length, 1);
  assert.deepEqual(asked.splice(0), [current, earlier]);

  // A login page is no menu document.
  assert.equal(await loadOdooApps(B, answer({ [current ?? '']: '<html>' })), undefined);
  assert.deepEqual(asked.splice(0), [current, earlier]);

  await assert.rejects(loadOdooApps(B, () => Promise.reject(new Error('offline'))), /offline/);
});
