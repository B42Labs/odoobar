import { app } from 'electron';
import { join } from 'node:path';
import { ConfigStore } from './config-store';
import { GlobalShortcuts } from './global-shortcuts';
import { createGlobalShortcutsUi } from './global-shortcuts-ui';
import { startApp } from './lifecycle';
import { syncLoginItem } from './login-item';
import { MenuBar } from './menu-bar';
import { createMenuBarUi } from './menu-bar-ui';
import { messagesFor, pickLocale } from './messages';
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
    createDesktop(store.filePath),
    messages,
    result.config,
  );
  const menuBar = new MenuBar(createMenuBarUi(controller, messages), result.config);
  const shortcuts = new GlobalShortcuts(createGlobalShortcutsUi(), (id) => controller.toggleApp(id), result.config);
  store.onChange((config) => {
    controller.setConfig(config);
    menuBar.setConfig(config);
    shortcuts.setConfig(config);
  });
  // Starting OdooBar again is the way to the window: a process started
  // directly ends on the single-instance lock, and Finder reopens this one.
  app.on('second-instance', () => controller.show());
  app.on('activate', () => controller.show());
  // A first start goes on to the Odoo login page. Every later start stays hidden.
  if (result.created) controller.show();
}

if (startApp(app)) {
  // A failed start must not leave an invisible app behind.
  start().catch((error: unknown) => {
    console.error('OdooBar could not start:', error);
    app.exit(1);
  });
}
