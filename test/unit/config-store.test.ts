import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, type Config } from '../../src/main/config';
import { ConfigStore } from '../../src/main/config-store';
import { makeUserDataDir, removeUserDataDir, storedConfig, writeConfig } from '../support/app-process';

const config: Config = {
  baseUrl: 'https://odoo.example.com',
  launchAtLogin: true,
  attendance: true,
  apps: [{ id: 'crm', name: 'CRM', url: '/odoo/crm', icon: 'handshake', shortcut: '', menuBar: true }],
};

const notLoaded = { message: 'configuration is not loaded' };

test('load reports a missing file', () => {
  const dir = makeUserDataDir();
  try {
    const store = new ConfigStore(join(dir, 'config.json'));
    assert.deepEqual(store.load(), { status: 'missing' });
    assert.throws(() => store.get(), notLoaded);
  } finally {
    removeUserDataDir(dir);
  }
});

test('load returns the stored configuration and get returns it again', () => {
  const dir = makeUserDataDir();
  try {
    const store = new ConfigStore(writeConfig(dir, storedConfig));
    const expected = { baseUrl: 'https://odoo.example.com', launchAtLogin: false, attendance: true, apps: [] };
    assert.deepEqual(store.load(), { status: 'loaded', config: expected });
    assert.deepEqual(store.get(), expected);
  } finally {
    removeUserDataDir(dir);
  }
});

test('load reports an invalid file and leaves it unchanged', () => {
  const dir = makeUserDataDir();
  try {
    for (const [text, code] of [
      ['', 'invalid-json'],
      ['{ "baseUrl": 5 }', 'expected-string'],
    ] as const) {
      const file = writeConfig(dir, text);
      const store = new ConfigStore(file);
      const result = store.load();
      assert.ok(result.status === 'invalid', `status is ${result.status} for ${JSON.stringify(text)}`);
      assert.ok(result.error instanceof ConfigError);
      assert.equal(result.error.code, code);
      assert.equal(readFileSync(file, 'utf8'), text);
      assert.throws(() => store.get(), notLoaded);
    }
  } finally {
    removeUserDataDir(dir);
  }
});

test('load reports a file that cannot be read', () => {
  const dir = makeUserDataDir();
  try {
    const result = new ConfigStore(dir).load();
    assert.ok(result.status === 'unreadable', `status is ${result.status}`);
    assert.match(result.reason, /^EISDIR/);
  } finally {
    removeUserDataDir(dir);
  }
});

test('save writes the file, creates its directory, and leaves no temporary file', () => {
  const dir = makeUserDataDir();
  try {
    const nested = join(dir, 'nested');
    const store = new ConfigStore(join(nested, 'config.json'));
    store.save(config);
    assert.deepEqual(readdirSync(nested), ['config.json']);
    assert.deepEqual(store.get(), config);
    assert.deepEqual(new ConfigStore(join(nested, 'config.json')).load(), { status: 'loaded', config });
  } finally {
    removeUserDataDir(dir);
  }
});

test('save notifies listeners until they unsubscribe', () => {
  const dir = makeUserDataDir();
  try {
    const store = new ConfigStore(join(dir, 'config.json'));
    const seen: Config[] = [];
    const unsubscribe = store.onChange((next) => seen.push(next));
    store.save(config);
    store.save({ ...config, launchAtLogin: false });
    unsubscribe();
    store.save(config);
    assert.deepEqual(seen, [config, { ...config, launchAtLogin: false }]);
  } finally {
    removeUserDataDir(dir);
  }
});

test('save rejects an invalid configuration and keeps file and listeners untouched', () => {
  const dir = makeUserDataDir();
  try {
    const file = join(dir, 'config.json');
    const store = new ConfigStore(file);
    store.save(config);
    const text = readFileSync(file, 'utf8');
    const seen: Config[] = [];
    store.onChange((next) => seen.push(next));

    assert.throws(() => store.save({ ...config, baseUrl: 'ftp://odoo.example.com' }), ConfigError);
    assert.equal(readFileSync(file, 'utf8'), text);
    assert.deepEqual(seen, []);
    assert.deepEqual(store.get(), config);
  } finally {
    removeUserDataDir(dir);
  }
});

test('save passes a directory error on and stays unloaded', () => {
  const dir = makeUserDataDir();
  try {
    writeFileSync(join(dir, 'blocker'), '');
    const store = new ConfigStore(join(dir, 'blocker', 'config.json'));
    const seen: Config[] = [];
    store.onChange((next) => seen.push(next));

    assert.throws(() => store.save(config), { code: 'EEXIST' });
    assert.deepEqual(seen, []);
    assert.throws(() => store.get(), notLoaded);
  } finally {
    removeUserDataDir(dir);
  }
});

test('save passes a write error on and keeps the previous file and configuration', () => {
  const dir = makeUserDataDir();
  try {
    const file = join(dir, 'config.json');
    const store = new ConfigStore(file);
    store.save(config);
    const text = readFileSync(file, 'utf8');
    // A directory in place of the temporary file makes the write fail.
    mkdirSync(`${file}.tmp`);
    const seen: Config[] = [];
    store.onChange((next) => seen.push(next));

    assert.throws(() => store.save({ ...config, launchAtLogin: false }), { code: 'EISDIR' });
    assert.equal(readFileSync(file, 'utf8'), text);
    assert.deepEqual(store.get(), config);
    assert.deepEqual(seen, []);
  } finally {
    removeUserDataDir(dir);
  }
});

test('moveAside renames the file to a backup with a timestamp', () => {
  const dir = makeUserDataDir();
  try {
    const file = writeConfig(dir, '{');
    const backup = new ConfigStore(file).moveAside(new Date(2026, 9, 5, 14, 5, 9));
    assert.equal(backup, join(dir, 'config.invalid-20261005-140509.json'));
    assert.equal(readFileSync(backup, 'utf8'), '{');
    assert.ok(!existsSync(file));
  } finally {
    removeUserDataDir(dir);
  }
});

test('moveAside throws ENOENT when there is no file', () => {
  const dir = makeUserDataDir();
  try {
    assert.throws(() => new ConfigStore(join(dir, 'config.json')).moveAside(), { code: 'ENOENT' });
  } finally {
    removeUserDataDir(dir);
  }
});
