import { app } from 'electron';
import { join } from 'node:path';
import { ConfigStore } from './config-store';
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
import { WindowController } from './window';
import { createDesktop, createWindowUi } from './window-ui';

async function start(): Promise<void> {
  await app.whenReady();
  // app.getLocale() is valid only after ready.
  const messages = messagesFor(pickLocale(app.getLocale()));
  const store = new ConfigStore(join(app.getPath('userData'), 'config.json'));
  const result = await loadOrCreateConfig(store, createStartupUi(messages), messages);
  if (!result) {
    app.quit();
    return;
  }
  syncLoginItem(app, result.config.launchAtLogin);

  const controller: WindowController = new WindowController(
    createWindowUi(() => controller),
    createDesktop(() => settings.open()),
    messages,
    result.config,
  );
  const menuBar = new MenuBar(createMenuBarUi(controller, messages), result.config);
  const shortcuts = new GlobalShortcuts(createGlobalShortcutsUi(), (id) => controller.toggleApp(id), result.config);
  const settings: Settings = new Settings(
    createSettingsUi(() => settings, messages),
    {
      getConfig: () => store.get(),
      saveConfig: (config) => store.save(config),
      shortcutStates: () => shortcuts.states(),
      suspendShortcuts: () => shortcuts.suspend(),
      resumeShortcuts: () => shortcuts.setConfig(store.get()),
      signOut: () => controller.signOut(),
    },
    messages,
  );
  store.onChange((config) => {
    controller.setConfig(config);
    menuBar.setConfig(config);
    shortcuts.setConfig(config);
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
