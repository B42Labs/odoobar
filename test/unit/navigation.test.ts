import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInsideInstance, linkTarget } from '../../src/main/navigation';

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
