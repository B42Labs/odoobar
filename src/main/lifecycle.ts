/**
 * The part of Electron's `app` that startApp uses. This module never imports
 * electron, so its unit tests run in plain Node.js.
 */
export interface LifecycleApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: 'window-all-closed', listener: () => void): unknown;
  readonly dock?: { hide(): void };
}

/**
 * Takes the single-instance lock, hides the Dock icon, and keeps OdooBar
 * running without windows. Returns false after asking the app to quit when
 * another instance with the same user data directory already runs.
 */
export function startApp(app: LifecycleApp): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.dock?.hide();
  // Electron quits when the last window closes unless this event has a listener.
  app.on('window-all-closed', () => {});
  return true;
}
