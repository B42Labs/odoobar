import { app } from 'electron';
import { join } from 'node:path';
import { showAppMenu } from './app-menu-ui';
import { ConfigStore } from './config-store';
import { Dock } from './dock';
import { createDockUi } from './dock-ui';
import { GlobalShortcuts } from './global-shortcuts';
import { createGlobalShortcutsUi } from './global-shortcuts-ui';
import { startApp } from './lifecycle';
import { startedAtLogin, syncLoginItem } from './login-item';
import { MenuBar } from './menu-bar';
import { createMenuBarUi } from './menu-bar-ui';
import { messagesFor, pickLocale } from './messages';
import { Settings } from './settings';
import { createSettingsUi } from './settings-ui';
import { loadOrCreateConfig } from './startup';
import { createStartupUi } from './startup-ui';
import { watchForUpdates } from './updates';
import { fetchReleaseJson } from './updates-ui';
import { WindowController } from './window';
import { createDesktop, createWindowUi, fetchOdooJson } from './window-ui';

async function start(): Promise<void> {
  await app.whenReady();
  // app.getLocale() is valid only after ready.
  const messages = messagesFor(pickLocale(app.getLocale()));
  const store = new ConfigStore(join(app.getPath('userData'), 'config.json'));
  const dock = new Dock(createDockUi());
  // The first-start prompt has the menu as well, without the way to the settings.
  showAppMenu(messages);
  const result = await loadOrCreateConfig(store, createStartupUi(messages, dock), messages);
  if (!result) {
    app.quit();
    return;
  }
  syncLoginItem(app, result.config.launchAtLogin);

  const controller: WindowController = new WindowController(
    createWindowUi(() => controller, dock),
    createDesktop(() => settings.open()),
    messages,
    result.config,
  );
  const menuBar = new MenuBar(createMenuBarUi(controller, messages), result.config);
  const shortcuts = new GlobalShortcuts(createGlobalShortcutsUi(), (id) => controller.toggleApp(id), result.config);
  const settings: Settings = new Settings(
    createSettingsUi(() => settings, messages, dock),
    {
      getConfig: () => store.get(),
      saveConfig: (config) => store.save(config),
      shortcutStates: () => shortcuts.states(),
      suspendShortcuts: () => shortcuts.suspend(),
      resumeShortcuts: () => shortcuts.setConfig(store.get()),
      windowBounds: () => controller.bounds(),
      signOut: () => controller.signOut(),
      fetchJson: fetchOdooJson,
    },
    messages,
  );
  showAppMenu(messages, () => settings.open());
  watchForUpdates(app, { fetchJson: fetchReleaseJson, found: (update) => controller.setUpdate(update) });
  store.onChange((config) => {
    controller.setConfig(config);
    menuBar.setConfig(config);
    shortcuts.setConfig(config);
    syncLoginItem(app, config.launchAtLogin);
  });
  // Starting OdooBar again is the way to the window: a process started
  // directly ends on the single-instance lock, and Finder reopens this one.
  app.on('second-instance', () => controller.show());
  app.on('activate', () => controller.show());
  // A start by the user opens the window, and a first start goes on to the Odoo
  // login page. Only the start that macOS makes at login stays hidden.
  if (result.created || !startedAtLogin(app)) controller.show();
}

if (startApp(app)) {
  // A failed start must not leave an invisible app behind.
  start().catch((error: unknown) => {
    console.error('OdooBar could not start:', error);
    app.exit(1);
  });
}
