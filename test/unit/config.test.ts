import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ConfigError,
  normalizeBaseUrl,
  parseConfig,
  resolveAppUrl,
  serializeConfig,
  type ConfigErrorCode,
} from '../../src/main/config';
import { projectRoot } from '../support/app-process';

function expectError(run: () => unknown, code: ConfigErrorCode, path: string): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ConfigError, `expected a ConfigError, got ${String(error)}`);
    assert.equal(error.code, code);
    assert.equal(error.path, path);
    assert.equal(error.name, 'ConfigError');
    assert.equal(error.message, path === '' ? code : `${path}: ${code}`);
    return true;
  });
}

test('parseConfig accepts the example in the README', () => {
  const readme = readFileSync(join(projectRoot, 'README.md'), 'utf8');
  const block = /```json\n([\s\S]*?)\n```/.exec(readme)?.[1];
  assert.ok(block !== undefined, 'README.md has no json block');

  const config = parseConfig(block);
  assert.equal(config.baseUrl, 'https://odoo.example.com');
  assert.equal(config.launchAtLogin, true);
  assert.deepEqual(
    config.apps.map((app) => app.id),
    ['discuss', 'crm', 'calendar'],
  );
  assert.deepEqual(config.apps[2], {
    id: 'calendar',
    name: 'Kalender',
    url: '/odoo/calendar',
    icon: 'calendar',
    shortcut: '',
    menuBar: false,
  });
  assert.equal(serializeConfig(config), block + '\n');
});

test('parseConfig fills in the optional fields', () => {
  const bare = parseConfig('{"baseUrl":"https://odoo.example.com"}');
  assert.equal(bare.launchAtLogin, false);
  // A file of a version without the attendance button turns it on.
  assert.equal(bare.attendance, true);
  assert.deepEqual(bare.apps, []);

  const withApp = parseConfig(
    '{"baseUrl":"https://odoo.example.com","apps":[{"id":"crm","name":"CRM","url":"/odoo/crm"}]}',
  );
  assert.deepEqual(withApp.apps, [
    { id: 'crm', name: 'CRM', url: '/odoo/crm', icon: '', shortcut: '', menuBar: false },
  ]);
});

test('parseConfig normalizes baseUrl and drops unknown fields', () => {
  assert.deepEqual(parseConfig('{"baseUrl":"odoo.example.com/","theme":"dark","apps":[]}'), {
    baseUrl: 'https://odoo.example.com',
    launchAtLogin: false,
    attendance: true,
    apps: [],
  });
});

test('parseConfig keeps an attendance button that is off', () => {
  assert.equal(parseConfig('{"baseUrl":"https://odoo.example.com","attendance":false}').attendance, false);
  assert.equal(parseConfig('{"baseUrl":"https://odoo.example.com","attendance":true}').attendance, true);
});

const validApp = { id: 'crm', name: 'CRM', url: '/odoo/crm', icon: 'handshake', shortcut: '', menuBar: true };

function withApps(apps: unknown[]): string {
  return JSON.stringify({ baseUrl: 'https://odoo.example.com', apps });
}

function validAppWithout(key: keyof typeof validApp): Record<string, unknown> {
  return Object.fromEntries(Object.entries(validApp).filter(([name]) => name !== key));
}

test('parseConfig keeps a full app URL as it is', () => {
  const url = 'https://other.example.com/x?y=1#z';
  assert.equal(parseConfig(withApps([{ ...validApp, url }])).apps[0]?.url, url);
});

const invalidFiles: { name: string; input: string; code: ConfigErrorCode; path: string }[] = [
  { name: 'an empty file', input: '', code: 'invalid-json', path: '' },
  { name: 'broken JSON', input: '{', code: 'invalid-json', path: '' },
  { name: 'a list', input: '[]', code: 'expected-object', path: '' },
  { name: 'null', input: 'null', code: 'expected-object', path: '' },
  { name: 'a missing baseUrl', input: '{}', code: 'expected-string', path: 'baseUrl' },
  { name: 'a numeric baseUrl', input: '{"baseUrl":5}', code: 'expected-string', path: 'baseUrl' },
  { name: 'an empty baseUrl', input: '{"baseUrl":""}', code: 'empty', path: 'baseUrl' },
  { name: 'an ftp baseUrl', input: '{"baseUrl":"ftp://odoo.example.com"}', code: 'url-scheme', path: 'baseUrl' },
  {
    name: 'a text launchAtLogin',
    input: '{"baseUrl":"https://odoo.example.com","launchAtLogin":"yes"}',
    code: 'expected-boolean',
    path: 'launchAtLogin',
  },
  {
    name: 'a text attendance',
    input: '{"baseUrl":"https://odoo.example.com","attendance":"yes"}',
    code: 'expected-boolean',
    path: 'attendance',
  },
  {
    name: 'a null attendance',
    input: '{"baseUrl":"https://odoo.example.com","attendance":null}',
    code: 'expected-boolean',
    path: 'attendance',
  },
  {
    name: 'apps as an object',
    input: '{"baseUrl":"https://odoo.example.com","apps":{}}',
    code: 'expected-array',
    path: 'apps',
  },
  {
    name: 'apps as null',
    input: '{"baseUrl":"https://odoo.example.com","apps":null}',
    code: 'expected-array',
    path: 'apps',
  },
  { name: 'an app that is a number', input: withApps([5]), code: 'expected-object', path: 'apps[0]' },
  { name: 'an app without id', input: withApps([validAppWithout('id')]), code: 'expected-string', path: 'apps[0].id' },
  { name: 'an app with an empty id', input: withApps([{ ...validApp, id: ' ' }]), code: 'empty', path: 'apps[0].id' },
  {
    name: 'an app without name',
    input: withApps([validAppWithout('name')]),
    code: 'expected-string',
    path: 'apps[0].name',
  },
  {
    name: 'an app with an empty name',
    input: withApps([{ ...validApp, name: '' }]),
    code: 'empty',
    path: 'apps[0].name',
  },
  {
    name: 'an app without url',
    input: withApps([validAppWithout('url')]),
    code: 'expected-string',
    path: 'apps[0].url',
  },
  {
    name: 'an app url without a leading slash',
    input: withApps([{ ...validApp, url: 'odoo/crm' }]),
    code: 'app-url',
    path: 'apps[0].url',
  },
  { name: 'an empty app url', input: withApps([{ ...validApp, url: '' }]), code: 'app-url', path: 'apps[0].url' },
  {
    name: 'an ftp app url',
    input: withApps([{ ...validApp, url: 'ftp://x.test/crm' }]),
    code: 'app-url',
    path: 'apps[0].url',
  },
  {
    name: 'an app url with a scheme but no host',
    input: withApps([{ ...validApp, url: 'https://' }]),
    code: 'app-url',
    path: 'apps[0].url',
  },
  {
    name: 'a numeric icon',
    input: withApps([{ ...validApp, icon: 5 }]),
    code: 'expected-string',
    path: 'apps[0].icon',
  },
  {
    name: 'a null shortcut',
    input: withApps([{ ...validApp, shortcut: null }]),
    code: 'expected-string',
    path: 'apps[0].shortcut',
  },
  {
    name: 'a text menuBar',
    input: withApps([{ ...validApp, menuBar: 'true' }]),
    code: 'expected-boolean',
    path: 'apps[0].menuBar',
  },
  {
    name: 'a duplicate id',
    input: withApps([validApp, { ...validApp, name: 'Other' }]),
    code: 'duplicate-id',
    path: 'apps[1].id',
  },
];

for (const { name, input, code, path } of invalidFiles) {
  test(`parseConfig rejects ${name}`, () => {
    expectError(() => parseConfig(input), code, path);
  });
}

test('normalizeBaseUrl trims, adds https, and strips trailing slashes', () => {
  assert.equal(normalizeBaseUrl('https://odoo.example.com'), 'https://odoo.example.com');
  assert.equal(normalizeBaseUrl('  https://odoo.example.com/ '), 'https://odoo.example.com');
  assert.equal(normalizeBaseUrl('odoo.example.com'), 'https://odoo.example.com');
  assert.equal(normalizeBaseUrl('http://localhost:8069'), 'http://localhost:8069');
  assert.equal(normalizeBaseUrl('localhost:8069'), 'https://localhost:8069');
  assert.equal(normalizeBaseUrl('HTTPS://Odoo.Example.com:443/prefix//'), 'https://odoo.example.com/prefix');
});

const invalidBaseUrls: { input: string; code: ConfigErrorCode }[] = [
  { input: '', code: 'empty' },
  { input: '   ', code: 'empty' },
  { input: 'https://', code: 'url-invalid' },
  { input: 'my odoo', code: 'url-invalid' },
  { input: 'ftp://odoo.example.com', code: 'url-scheme' },
  { input: 'https://user:secret@odoo.example.com', code: 'url-credentials' },
  { input: 'https://odoo.example.com/web?db=main', code: 'url-query' },
  { input: 'https://odoo.example.com/web#action=1', code: 'url-query' },
];

for (const { input, code } of invalidBaseUrls) {
  test(`normalizeBaseUrl rejects ${JSON.stringify(input)} as ${code}`, () => {
    expectError(() => normalizeBaseUrl(input), code, 'baseUrl');
  });
}

test('resolveAppUrl appends a path to the base URL and keeps a full URL', () => {
  const base = 'https://odoo.example.com';
  assert.equal(resolveAppUrl(base, '/odoo/crm'), 'https://odoo.example.com/odoo/crm');
  assert.equal(
    resolveAppUrl(base, '/web#action=123&menu_id=45'),
    'https://odoo.example.com/web#action=123&menu_id=45',
  );
  assert.equal(resolveAppUrl(base, 'https://other.example.com/x?y=1'), 'https://other.example.com/x?y=1');
});

test('serializeConfig writes the fields in README order with a final newline', () => {
  const reversed = {
    apps: [{ menuBar: true, shortcut: 'Control+Alt+C', icon: 'handshake', url: '/odoo/crm', name: 'CRM', id: 'crm' }],
    attendance: false,
    launchAtLogin: true,
    baseUrl: 'https://odoo.example.com',
  };
  assert.equal(
    serializeConfig(reversed),
    [
      '{',
      '  "baseUrl": "https://odoo.example.com",',
      '  "launchAtLogin": true,',
      '  "attendance": false,',
      '  "apps": [',
      '    {',
      '      "id": "crm",',
      '      "name": "CRM",',
      '      "url": "/odoo/crm",',
      '      "icon": "handshake",',
      '      "shortcut": "Control+Alt+C",',
      '      "menuBar": true',
      '    }',
      '  ]',
      '}',
      '',
    ].join('\n'),
  );
  assert.ok(serializeConfig({ ...reversed, apps: [] }).endsWith('  "apps": []\n}\n'));
});
