import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import {
  CHECK_INTERVAL_MS,
  isNewer,
  LATEST_RELEASE_URL,
  parseVersion,
  updateFrom,
  Updates,
  watchForUpdates,
  type Update,
  type UpdatesDeps,
} from '../../src/main/updates';

const release020: Update = { version: '0.2.0', url: 'https://github.com/B42Labs/odoobar/releases/tag/v0.2.0' };

/**
 * The network side of the update check, whose requests give what `answer`
 * gives. `asked` holds every address it asked for, and `found` every update
 * it reported.
 */
function fakeDeps(answer: () => Promise<unknown>) {
  const asked: string[] = [];
  const found: Update[] = [];
  const deps: UpdatesDeps = {
    fetchJson: (url) => {
      asked.push(url);
      return answer();
    },
    found: (update) => found.push(update),
  };
  return { deps, asked, found };
}

/** Updates for the installed version 0.1.0 on fakeDeps. */
function fakeUpdates(answer: () => Promise<unknown>) {
  const { deps, asked, found } = fakeDeps(answer);
  return { updates: new Updates(deps, '0.1.0'), asked, found };
}

/** Stands in for Electron's app at version 0.1.0. By default it is the installed app, started without --user-data-dir. */
function fakeApp({ isPackaged = true, userDataDir = false } = {}) {
  return {
    isPackaged,
    commandLine: { hasSwitch: (name: string) => userDataDir && name === 'user-data-dir' },
    getVersion: () => '0.1.0',
  };
}

test('parseVersion reads a version and a tag, and nothing else', () => {
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('0.10.0'), [0, 10, 0]);
  for (const text of ['', 'v', '1.2', '1.2.3.4', '1.2.3-rc.1', 'V1.2.3', '01.2.3', ' 1.2.3', undefined, null, 123]) {
    assert.equal(parseVersion(text), undefined, JSON.stringify(text));
  }
});

test('isNewer compares the numbers of two versions', () => {
  assert.equal(isNewer([0, 10, 0], [0, 9, 0]), true);
  assert.equal(isNewer([1, 0, 0], [0, 99, 99]), true);
  assert.equal(isNewer([0, 1, 1], [0, 1, 0]), true);
  assert.equal(isNewer([0, 10, 0], [0, 10, 0]), false);
  assert.equal(isNewer([0, 9, 0], [0, 10, 0]), false);
});

test('updateFrom announces a newer release with the address of its page', () => {
  assert.deepEqual(updateFrom({ tag_name: 'v0.2.0', html_url: 'https://example.com/' }, '0.1.0'), release020);
});

test('updateFrom announces nothing for the same or an older release', () => {
  for (const tag of ['v0.1.0', 'v0.0.9']) {
    assert.equal(updateFrom({ tag_name: tag }, '0.1.0'), undefined, tag);
  }
});

test('updateFrom announces nothing for a document without a version tag', () => {
  const releases: unknown[] = [
    undefined,
    null,
    {},
    [],
    'v9.9.9',
    { tag_name: 5 },
    { tag_name: '' },
    { tag_name: 'nightly' },
    { tag_name: 'v0.2.0-rc.1' },
  ];
  for (const release of releases) {
    assert.equal(updateFrom(release, '0.1.0'), undefined, JSON.stringify(release));
  }
  // A version that is no release, as a build from a branch might have, makes no release newer.
  assert.equal(updateFrom({ tag_name: 'v9.9.9' }, 'dev'), undefined);
});

test('check reports a newer release once per version', async () => {
  let release: unknown = { tag_name: 'v0.2.0' };
  const { updates, asked, found } = fakeUpdates(async () => release);
  await updates.check();
  await updates.check();
  assert.deepEqual(asked, [LATEST_RELEASE_URL, LATEST_RELEASE_URL]);
  assert.deepEqual(found, [release020]);

  release = { tag_name: 'v0.3.0' };
  await updates.check();
  assert.deepEqual(found, [
    release020,
    { version: '0.3.0', url: 'https://github.com/B42Labs/odoobar/releases/tag/v0.3.0' },
  ]);
});

test('check reports nothing when the address has no release document', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  for (const answer of [undefined, {}]) {
    const { updates, found } = fakeUpdates(async () => answer);
    await updates.check();
    assert.deepEqual(found, [], JSON.stringify(answer));
  }
  assert.equal(log.mock.callCount(), 0);
});

test('check logs an error of the request and reports nothing', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const error = new Error('net::ERR_INTERNET_DISCONNECTED');
  let answer = (): Promise<unknown> => Promise.reject(error);
  const { updates, found } = fakeUpdates(() => answer());
  await updates.check();
  assert.deepEqual(found, []);
  assert.equal(log.mock.callCount(), 1);
  assert.deepEqual(log.mock.calls[0]?.arguments, ['OdooBar could not check for updates:', error]);

  // The next check tries again.
  answer = async () => ({ tag_name: 'v0.2.0' });
  await updates.check();
  assert.deepEqual(found, [release020]);
});

test('check logs an error of found and reports the release again on the next check', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const error = new Error('Object has been destroyed');
  const found: Update[] = [];
  let fail = true;
  const updates = new Updates(
    {
      fetchJson: async () => ({ tag_name: 'v0.2.0' }),
      found: (update) => {
        if (fail) throw error;
        found.push(update);
      },
    },
    '0.1.0',
  );
  await updates.check();
  assert.deepEqual(log.mock.calls[0]?.arguments, ['OdooBar could not check for updates:', error]);

  fail = false;
  await updates.check();
  assert.deepEqual(found, [release020]);
});

test('watchForUpdates checks at the start and every CHECK_INTERVAL_MS in the installed app', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { deps, asked, found } = fakeDeps(async () => ({ tag_name: 'v0.2.0' }));
  watchForUpdates(fakeApp(), deps);
  assert.deepEqual(asked, [LATEST_RELEASE_URL]);
  await setImmediate();
  assert.deepEqual(found, [release020]);

  t.mock.timers.tick(CHECK_INTERVAL_MS - 1);
  assert.deepEqual(asked, [LATEST_RELEASE_URL]);
  t.mock.timers.tick(1);
  assert.deepEqual(asked, [LATEST_RELEASE_URL, LATEST_RELEASE_URL]);
});

test('watchForUpdates never asks GitHub in the development app or under --user-data-dir', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const askedBy = (app: ReturnType<typeof fakeApp>) => {
    const { deps, asked } = fakeDeps(async () => ({ tag_name: 'v0.2.0' }));
    watchForUpdates(app, deps);
    t.mock.timers.tick(CHECK_INTERVAL_MS);
    return asked;
  };
  assert.deepEqual(askedBy(fakeApp({ isPackaged: false })), []);
  assert.deepEqual(askedBy(fakeApp({ userDataDir: true })), []);
});
