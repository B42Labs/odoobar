/**
 * The part of Electron's `app` that tells the installed app from other runs.
 * This module never imports electron, so its unit tests run in plain Node.js.
 */
export interface InstalledApp {
  readonly isPackaged: boolean;
  readonly commandLine: { hasSwitch(name: string): boolean };
}

/**
 * Whether this run is the installed app. The development app, whose bundle is
 * Electron's own, and every run under --user-data-dir, as `make run` and the
 * tests start OdooBar, leave the macOS login item and GitHub alone.
 */
export function isInstalledRun(app: InstalledApp): boolean {
  return app.isPackaged && !app.commandLine.hasSwitch('user-data-dir');
}
