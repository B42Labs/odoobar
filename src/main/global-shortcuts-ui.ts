import { globalShortcut } from 'electron';
import type { GlobalShortcutsUi } from './global-shortcuts';

/**
 * The Electron side of GlobalShortcutsUi. It holds no decisions,
 * global-shortcuts.ts picks the shortcuts and window.ts answers a press.
 */
export function createGlobalShortcutsUi(): GlobalShortcutsUi {
  return {
    register(accelerator, press) {
      try {
        if (globalShortcut.register(accelerator, press)) return 'registered';
        // Electron refuses a shortcut that OdooBar already holds, in any spelling.
        return globalShortcut.isRegistered(accelerator) ? 'duplicate' : 'refused';
      } catch (error) {
        // Electron throws a TypeError for a text without a key it knows. Every
        // error ends here on purpose: register runs inside ConfigStore.save,
        // and a throw would keep the later listeners from the saved file.
        console.error(`OdooBar could not register the shortcut ${accelerator}:`, error);
        return 'invalid';
      }
    },
    unregisterAll() {
      globalShortcut.unregisterAll();
    },
  };
}
