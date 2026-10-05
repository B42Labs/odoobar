import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import {
  expectRunningAgentApp,
  isRunning,
  launch,
  makeUserDataDir,
  projectRoot,
  removeUserDataDir,
  stop,
  storedConfig,
  waitForExit,
  writeConfig,
} from '../support/app-process';

let electronBinary = '';

// In plain Node.js, require('electron') returns the binary path and downloads
// the binary on first use. The hook keeps that download out of the test timeout.
before(() => {
  if (process.platform === 'darwin') electronBinary = require('electron');
});

test(
  'development app runs without a Dock icon and allows one instance',
  { skip: process.platform === 'darwin' ? false : 'requires macOS', timeout: 60_000 },
  async () => {
    const userDataDir = makeUserDataDir();
    writeConfig(userDataDir, storedConfig);
    const first = launch(electronBinary, [projectRoot], userDataDir);
    let second: ChildProcess | undefined;
    try {
      await expectRunningAgentApp(first);

      second = launch(electronBinary, [projectRoot], userDataDir);
      assert.equal(await waitForExit(second, 15_000), 0);
      assert.ok(isRunning(first));

      first.kill('SIGTERM');
      assert.equal(await waitForExit(first, 10_000), 0);
    } finally {
      await stop(first);
      if (second) await stop(second);
      removeUserDataDir(userDataDir);
    }
  },
);
