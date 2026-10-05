import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigStore } from '../../src/main/config-store';
import { messagesFor } from '../../src/main/messages';
import {
  initialConfig,
  loadOrCreateConfig,
  submitBaseUrl,
  type StartupUi,
  type SubmitResult,
} from '../../src/main/startup';
import {
  makeUserDataDir,
  removeUserDataDir,
  seededConfig,
  storedConfig,
  writeConfig,
} from '../support/app-process';

const en = messagesFor('en');

/**
 * Stands in for the screen. askBaseUrl submits `inputs` one by one and
 * resolves true at the first accepted one, or false, as a closed prompt does,
 * when the list ends.
 */
function fakeUi({ inputs = [], reset = false }: { inputs?: string[]; reset?: boolean } = {}) {
  const calls: { method: keyof StartupUi; args: string[] }[] = [];
  const results: SubmitResult[] = [];
  const ui: StartupUi = {
    async askBaseUrl(submit) {
      calls.push({ method: 'askBaseUrl', args: [] });
      for (const input of inputs) {
        const result = submit(input);
        results.push(result);
        if (result.ok) return true;
      }
      return false;
    },
    async confirmReset(detail) {
      calls.push({ method: 'confirmReset', args: [detail] });
      return reset;
    },
    async showFatal(message, detail) {
      calls.push({ method: 'showFatal', args: [message, detail] });
    },
  };
  return { ui, calls, results, methods: () => calls.map((call) => call.method) };
}

const invalidApp = JSON.stringify({
  baseUrl: 'https://odoo.example.com',
  apps: [{ id: 'crm', name: 'CRM', url: 'odoo/crm' }],
});

test('returns a stored configuration without showing anything', async () => {
  const dir = makeUserDataDir();
  try {
    const file = writeConfig(dir, storedConfig);
    const { ui, calls } = fakeUi();
    assert.deepEqual(await loadOrCreateConfig(new ConfigStore(file), ui, en), {
      baseUrl: 'https://odoo.example.com',
      launchAtLogin: false,
      apps: [],
    });
    assert.deepEqual(calls, []);
    assert.equal(readFileSync(file, 'utf8'), storedConfig);
  } finally {
    removeUserDataDir(dir);
  }
});

test('asks for the URL on first start and stores the seeded configuration', async () => {
  const dir = makeUserDataDir();
  try {
    const file = join(dir, 'config.json');
    const store = new ConfigStore(file);
    const { ui, results } = fakeUi({ inputs: ['ftp://odoo.example.com', ' odoo.example.com/ '] });
    const config = await loadOrCreateConfig(store, ui, en);
    assert.deepEqual(results, [
      { ok: false, error: 'The address must start with http:// or https://.' },
      { ok: true },
    ]);
    assert.equal(readFileSync(file, 'utf8'), seededConfig('Timesheets'));
    assert.deepEqual(config, initialConfig('https://odoo.example.com', en));
    assert.deepEqual(config, store.get());
  } finally {
    removeUserDataDir(dir);
  }
});

test('seeds the German app names for a German locale', () => {
  const config = initialConfig('https://odoo.example.com', messagesFor('de'));
  assert.deepEqual(
    config.apps.map((app) => app.name),
    ['Home', 'Zeiterfassung'],
  );
});

test('returns undefined and writes nothing when the user closes the prompt', async () => {
  const dir = makeUserDataDir();
  try {
    const { ui, results } = fakeUi({ inputs: [''] });
    assert.equal(await loadOrCreateConfig(new ConfigStore(join(dir, 'config.json')), ui, en), undefined);
    assert.deepEqual(results, [{ ok: false, error: 'This value must not be empty.' }]);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    removeUserDataDir(dir);
  }
});

test('reports a failed save in the prompt', () => {
  const dir = makeUserDataDir();
  try {
    writeFileSync(join(dir, 'blocker'), '');
    const store = new ConfigStore(join(dir, 'blocker', 'config.json'));
    const result = submitBaseUrl(store, 'https://odoo.example.com', en);
    assert.ok(!result.ok);
    assert.match(result.error, /^OdooBar could not save the configuration: E/);
  } finally {
    removeUserDataDir(dir);
  }
});

test('keeps an invalid file when the user declines the reset', async () => {
  const dir = makeUserDataDir();
  try {
    const file = writeConfig(dir, invalidApp);
    const { ui, calls, methods } = fakeUi({ reset: false });
    assert.equal(await loadOrCreateConfig(new ConfigStore(file), ui, en), undefined);
    assert.deepEqual(methods(), ['confirmReset']);
    assert.ok(calls[0]?.args[0]?.startsWith(`${file}\n\napps[0].url: A path that starts with / or a full`));
    assert.equal(readFileSync(file, 'utf8'), invalidApp);
    assert.deepEqual(readdirSync(dir), ['config.json']);
  } finally {
    removeUserDataDir(dir);
  }
});

test('names a file-level problem without a path', async () => {
  const dir = makeUserDataDir();
  try {
    const file = writeConfig(dir, '');
    const { ui, calls } = fakeUi();
    assert.equal(await loadOrCreateConfig(new ConfigStore(file), ui, en), undefined);
    assert.ok(calls[0]?.args[0]?.startsWith(`${file}\n\nThe file is not valid JSON.\n\n`));
  } finally {
    removeUserDataDir(dir);
  }
});

test('renames an invalid file and asks for the URL after a reset', async () => {
  const dir = makeUserDataDir();
  try {
    const file = writeConfig(dir, invalidApp);
    const { ui, methods } = fakeUi({ reset: true, inputs: ['https://odoo.example.com'] });
    const config = await loadOrCreateConfig(new ConfigStore(file), ui, en);
    assert.deepEqual(methods(), ['confirmReset', 'askBaseUrl']);
    assert.deepEqual(config, initialConfig('https://odoo.example.com', en));

    const backups = readdirSync(dir).filter((name) => /^config\.invalid-\d{8}-\d{6}\.json$/.test(name));
    assert.equal(backups.length, 1);
    const [backup = ''] = backups;
    assert.equal(readFileSync(join(dir, backup), 'utf8'), invalidApp);
    assert.equal(readFileSync(file, 'utf8'), seededConfig('Timesheets'));
  } finally {
    removeUserDataDir(dir);
  }
});

test('keeps the backup and writes no file when the prompt closes after a reset', async () => {
  const dir = makeUserDataDir();
  try {
    const file = writeConfig(dir, invalidApp);
    const { ui, methods } = fakeUi({ reset: true });
    assert.equal(await loadOrCreateConfig(new ConfigStore(file), ui, en), undefined);
    assert.deepEqual(methods(), ['confirmReset', 'askBaseUrl']);

    const names = readdirSync(dir);
    assert.equal(names.length, 1);
    const [backup = ''] = names;
    assert.match(backup, /^config\.invalid-\d{8}-\d{6}\.json$/);
    assert.equal(readFileSync(join(dir, backup), 'utf8'), invalidApp);
  } finally {
    removeUserDataDir(dir);
  }
});

test('shows a fatal message for a file that cannot be read', async () => {
  const dir = makeUserDataDir();
  try {
    const { ui, calls, methods } = fakeUi();
    assert.equal(await loadOrCreateConfig(new ConfigStore(dir), ui, en), undefined);
    assert.deepEqual(methods(), ['showFatal']);
    assert.equal(calls[0]?.args[0], 'OdooBar cannot read its configuration');
    assert.ok(calls[0]?.args[1]?.startsWith(`${dir}\n\nEISDIR`));
  } finally {
    removeUserDataDir(dir);
  }
});

/** A store whose rename fails, as it does when the directory is read-only. */
class StuckStore extends ConfigStore {
  override moveAside(): string {
    throw new Error('EACCES: permission denied');
  }
}

test('shows a fatal message when the invalid file cannot be renamed', async () => {
  const dir = makeUserDataDir();
  try {
    const file = writeConfig(dir, invalidApp);
    const { ui, calls, methods } = fakeUi({ reset: true, inputs: ['https://odoo.example.com'] });
    assert.equal(await loadOrCreateConfig(new StuckStore(file), ui, en), undefined);
    assert.deepEqual(methods(), ['confirmReset', 'showFatal']);
    assert.deepEqual(calls[1]?.args, [
      'OdooBar could not rename the configuration file',
      `${file}\n\nEACCES: permission denied`,
    ]);
    assert.equal(readFileSync(file, 'utf8'), invalidApp);
  } finally {
    removeUserDataDir(dir);
  }
});
