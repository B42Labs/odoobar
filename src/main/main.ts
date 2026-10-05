import { app } from 'electron';
import { join } from 'node:path';
import { ConfigStore } from './config-store';
import { startApp } from './lifecycle';
import { syncLoginItem } from './login-item';
import { messagesFor, pickLocale } from './messages';
import { loadOrCreateConfig } from './startup';
import { createStartupUi } from './startup-ui';

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
}

if (startApp(app)) {
  // A failed start must not leave an invisible app behind.
  start().catch((error: unknown) => {
    console.error('OdooBar could not start:', error);
    app.exit(1);
  });
}
