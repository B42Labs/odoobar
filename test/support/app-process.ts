import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** Repository root. This file runs from out/test/support/, three levels below it. */
export const projectRoot = resolve(__dirname, '../../..');

/** The number of Lucide icons, and so of the icons that the build renders. */
export function iconCount(): number {
  const files = readdirSync(join(projectRoot, 'node_modules/lucide-static/icons'));
  return files.filter((file) => file.endsWith('.svg')).length;
}

/** The options of a test that launches OdooBar, which runs only on macOS. */
export const macOnly = { skip: process.platform === 'darwin' ? false : 'requires macOS', timeout: 60_000 };

export function makeUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'odoobar-test-'));
}

export function removeUserDataDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** A valid config.json. With it in the user data directory, OdooBar starts without the first-start prompt. */
export const storedConfig =
  '{\n  "baseUrl": "https://odoo.example.com",\n  "launchAtLogin": false,\n  "apps": []\n}\n';

/** The config.json that a first start writes for https://odoo.example.com, with the name of the second app. */
export function seededConfig(timesheets: string): string {
  return `{
  "baseUrl": "https://odoo.example.com",
  "launchAtLogin": false,
  "apps": [
    {
      "id": "home",
      "name": "Home",
      "url": "/odoo",
      "icon": "house",
      "shortcut": "",
      "menuBar": true
    },
    {
      "id": "timesheets",
      "name": "${timesheets}",
      "url": "/odoo/timesheets",
      "icon": "clock",
      "shortcut": "",
      "menuBar": true
    }
  ]
}
`;
}

export function writeConfig(userDataDir: string, text: string): string {
  const file = join(userDataDir, 'config.json');
  writeFileSync(file, text);
  return file;
}

/**
 * Electron keys the single-instance lock to the user data directory, so a
 * temporary one keeps a test away from a running OdooBar and its data.
 */
export function launch(executable: string, args: string[], userDataDir: string): ChildProcess {
  return spawn(executable, [...args, '--user-data-dir=' + userDataDir], { stdio: 'ignore' });
}

export function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

export function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  if (!isRunning(child)) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error(`process ${child.pid} still running after ${timeoutMs} ms`));
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

/**
 * Returns "UIElement" for an agent app and "Foreground" for an app with a Dock
 * icon, or undefined when macOS does not know the pid as an app. Throws ENOENT
 * where lsappinfo does not exist.
 */
export function applicationType(pid: number): string | undefined {
  const output = execFileSync('lsappinfo', ['info', '-only', 'ApplicationType', String(pid)], {
    encoding: 'utf8',
  });
  return /"ApplicationType"="([^"]+)"/.exec(output)?.[1];
}

export async function waitForApplicationType(
  child: ChildProcess,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: string | undefined;
  for (;;) {
    if (!isRunning(child)) {
      throw new Error(`process exited with code ${child.exitCode} before it became ${expected}`);
    }
    if (child.pid === undefined) throw new Error('process has no pid, it failed to start');
    last = applicationType(child.pid);
    if (last === expected) return;
    if (Date.now() >= deadline) {
      throw new Error(`ApplicationType is ${last ?? 'unset'} after ${timeoutMs} ms, expected ${expected}`);
    }
    await sleep(250);
  }
}

/**
 * Waits until the app runs as an agent app, then checks that it still runs a
 * moment later. The pause is long enough for a lifecycle bug, such as quitting
 * when no window is open, to end the process.
 */
export async function expectRunningAgentApp(child: ChildProcess): Promise<void> {
  await waitForApplicationType(child, 'UIElement', 30_000);
  await sleep(3_000);
  if (!isRunning(child)) {
    throw new Error(`process exited with code ${child.exitCode} after it became UIElement`);
  }
}

/**
 * Ends the process so that no invisible agent app outlives a test, with
 * SIGKILL if SIGTERM has not ended it within 10 s. Tests that check how the
 * app handles SIGTERM do so before they call stop.
 */
export async function stop(child: ChildProcess): Promise<void> {
  if (!isRunning(child)) return;
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 10_000);
  } catch {
    // waitForExit only rejects on timeout.
    child.kill('SIGKILL');
    await waitForExit(child, 5_000);
  }
}
