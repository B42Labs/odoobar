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
  waitForApplicationType,
  waitForExit,
  writeConfig,
} from '../support/app-process';
import { closeWindow, launchInspected } from '../support/main-process';

let electronBinary = '';

// In plain Node.js, require('electron') returns the binary path and downloads
// the binary on first use. The hook keeps that download out of the test timeout.
before(() => {
  if (process.platform === 'darwin') electronBinary = require('electron');
});

test(
  'development app has a Dock icon only while its window is open and allows one instance',
  { skip: process.platform === 'darwin' ? false : 'requires macOS', timeout: 60_000 },
  async () => {
    const userDataDir = makeUserDataDir();
    writeConfig(userDataDir, storedConfig);
    let first: ChildProcess | undefined;
    let second: ChildProcess | undefined;
    try {
      const inspected = await launchInspected(electronBinary, [projectRoot], userDataDir);
      first = inspected.app;
      await waitForApplicationType(first, 'Foreground', 30_000);
      await closeWindow(inspected.main);
      await expectRunningAgentApp(first);

      second = launch(electronBinary, [projectRoot], userDataDir);
      assert.equal(await waitForExit(second, 15_000), 0);
      assert.ok(isRunning(first));

      first.kill('SIGTERM');
      assert.equal(await waitForExit(first, 10_000), 0);
    } finally {
      if (first) await stop(first);
      if (second) await stop(second);
      removeUserDataDir(userDataDir);
    }
  },
);
