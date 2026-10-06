import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appKey, isInsideInstance, linkTarget } from '../../src/main/navigation';

const base = 'https://odoo.example.com';

test('isInsideInstance accepts the base URL and everything below it', () => {
  for (const url of [
    base,
    `${base}/`,
    `${base}/odoo/crm`,
    `${base}/web#action=123&menu_id=45`,
    `${base}/web/login?redirect=%2Fodoo`,
    'https://ODOO.example.com:443/odoo',
  ]) {
    assert.equal(isInsideInstance(base, url), true, url);
  }
});

test('isInsideInstance rejects another scheme, host, or port', () => {
  for (const url of [
    'http://odoo.example.com/odoo',
    'https://www.example.com/odoo',
    'https://odoo.example.com.evil.example/odoo',
    'https://odoo.example.com:8443/odoo',
    'https://user@evil.example/odoo.example.com',
  ]) {
    assert.equal(isInsideInstance(base, url), false, url);
  }
});

test('isInsideInstance honors a path prefix in the base URL', () => {
  const prefixed = 'https://example.com/odoo-prod';
  assert.equal(isInsideInstance(prefixed, prefixed), true);
  assert.equal(isInsideInstance(prefixed, `${prefixed}/odoo/crm`), true);
  assert.equal(isInsideInstance(prefixed, 'https://example.com/odoo-production'), false);
  assert.equal(isInsideInstance(prefixed, 'https://example.com/'), false);
});

test('isInsideInstance rejects text that is no URL', () => {
  assert.equal(isInsideInstance(base, ''), false);
  assert.equal(isInsideInstance(base, '/odoo/crm'), false);
  assert.equal(isInsideInstance('', `${base}/odoo/crm`), false);
});

test('linkTarget keeps a link inside the instance in the view', () => {
  assert.equal(linkTarget(base, `${base}/odoo/action-123`), 'view');
});

test('linkTarget sends web, mail, and phone links outside the instance to the browser', () => {
  for (const url of [
    'https://www.odoo.com/documentation',
    'http://odoo.example.com/odoo',
    'mailto:someone@example.com',
    'tel:+49301234567',
  ]) {
    assert.equal(linkTarget(base, url), 'browser', url);
  }
});

test('linkTarget drops every other scheme and text that is no URL', () => {
  for (const url of [
    '',
    'about:blank',
    'file:///etc/hosts',
    'javascript:alert(1)',
    'data:text/html,x',
    'zoommtg://x',
    '/odoo',
  ]) {
    assert.equal(linkTarget(base, url), 'drop', JSON.stringify(url));
  }
});

test('appKey is the same for a start address and a link to it', () => {
  assert.equal(appKey(`${base}/odoo/crm`), appKey('https://ODOO.example.com:443/odoo/crm/'));
  assert.equal(appKey(`${base}/odoo/crm?view_type=list`), appKey(`${base}/odoo/crm/?view_type=list#`));
  assert.equal(appKey(`${base}/odoo#home`), appKey(`${base}/odoo/#home`));
});

test('appKey tells the pages of an app, other apps, and other instances apart', () => {
  const keys = [
    `${base}/odoo`,
    `${base}/odoo/crm`,
    `${base}/odoo/crm/7`,
    `${base}/odoo/crm?view_type=list`,
    `${base}/odoo/crm#chatter`,
    `${base}/odoo/action-394`,
    'http://odoo.example.com/odoo/crm',
    'https://erp.example.com/odoo/crm',
  ].map(appKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.includes(undefined), false);
});

test('appKey takes the menu alone for an address of an Odoo before 18', () => {
  const key = appKey(`${base}/web#action=107&menu_id=7`);
  assert.equal(key, appKey(`${base}/web#menu_id=7&action_id=107`));
  assert.equal(key, appKey(`${base}/web#menu_id=7&action=107&cids=1`));
  assert.notEqual(key, appKey(`${base}/web#action=107&menu_id=8`));
  assert.notEqual(key, appKey(`${base}/web#action=107`));
  assert.notEqual(key, appKey(`${base}/web?debug=1#action=107&menu_id=7`));
  // An empty menu names no app.
  assert.notEqual(appKey(`${base}/web#menu_id=&action=1`), appKey(`${base}/web#menu_id=&action=2`));
});

test('appKey gives undefined for an address that is no web page', () => {
  for (const url of ['', 'not a url', '/odoo/crm', 'mailto:someone@example.com', 'file:///etc/hosts', 'javascript:void(0)'])
    assert.equal(appKey(url), undefined, url);
});
