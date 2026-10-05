/**
 * The part of Electron's `app` that syncLoginItem uses. This module never
 * imports electron, so its unit tests run in plain Node.js.
 */
export interface LoginItemApp {
  readonly isPackaged: boolean;
  readonly commandLine: { hasSwitch(name: string): boolean };
  getLoginItemSettings(): { openAtLogin: boolean };
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
}

/**
 * Makes the macOS login item follow launchAtLogin. The development app, whose
 * bundle is Electron's own, and test runs under --user-data-dir never touch
 * it, and a login item that already matches is left alone.
 */
export function syncLoginItem(app: LoginItemApp, launchAtLogin: boolean): void {
  if (!app.isPackaged || app.commandLine.hasSwitch('user-data-dir')) return;
  if (app.getLoginItemSettings().openAtLogin === launchAtLogin) return;
  app.setLoginItemSettings({ openAtLogin: launchAtLogin });
}
