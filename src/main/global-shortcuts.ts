import type { Config } from './config';

/**
 * What became of the global shortcut of an app. `invalid` is a text that is
 * no accelerator, `duplicate` a shortcut that an earlier app of the
 * configuration already has, and `refused` one that the system refused for
 * any other reason. macOS does not refuse a shortcut that another program or
 * the system itself uses, so such a shortcut is `registered` as well.
 */
export type ShortcutStatus = 'registered' | 'invalid' | 'duplicate' | 'refused';

/** The global shortcut of one app, as config.json spells it, and its status. */
export interface ShortcutState {
  readonly id: string;
  readonly shortcut: string;
  readonly status: ShortcutStatus;
}

/** The seam between the shortcut decisions and the system. global-shortcuts-ui.ts is the Electron side. */
export interface GlobalShortcutsUi {
  /** Takes a system-wide shortcut and tells what became of it. `press` runs on every press of a registered one. */
  register(accelerator: string, press: () => void): ShortcutStatus;
  /** Releases every shortcut that register took. */
  unregisterAll(): void;
}

/**
 * Every modifier name of an Electron accelerator that macOS honours, in lower
 * case. AltGr is missing on purpose: Electron accepts it, but macOS registers
 * the shortcut without it, so `AltGr+D` would take the plain key D.
 */
const MODIFIERS = new Set([
  'command',
  'cmd',
  'control',
  'ctrl',
  'commandorcontrol',
  'cmdorctrl',
  'alt',
  'option',
  'shift',
  'super',
  'meta',
]);

/**
 * Whether `text` has the form of an Electron accelerator: any number of
 * modifiers, then one key, joined by `+`, such as `Control+Alt+D`. Electron
 * skips a part it does not know, so it would take `Contrl+D` as the plain key
 * D in every program. Such a text never reaches Electron. Whether the last
 * part names a key is left to Electron, which refuses a key it does not know.
 */
export function isAccelerator(text: string): boolean {
  const parts = text.split('+').map((part) => part.trim().toLowerCase());
  const key = parts.pop();
  return key !== undefined && key !== '' && !MODIFIERS.has(key) && parts.every((part) => MODIFIERS.has(part));
}

/**
 * Decides which global shortcuts OdooBar holds: one for each app with a
 * shortcut. Every configuration releases all of them and registers them
 * again in the order of the apps, so the first of two apps with the same
 * shortcut gets it, and every save tries a refused shortcut again.
 */
export class GlobalShortcuts {
  private current: readonly ShortcutState[] = [];

  constructor(
    private readonly ui: GlobalShortcutsUi,
    private readonly press: (id: string) => void,
    config: Config,
  ) {
    this.setConfig(config);
  }

  /** The apps with a shortcut, in the order of the configuration. The settings window reads its notices from here. */
  states(): readonly ShortcutState[] {
    return this.current;
  }

  /**
   * Releases every shortcut while the settings record one, since macOS would
   * hand a held shortcut to its app. states() stays as it is, and the next
   * setConfig takes the shortcuts again.
   */
  suspend(): void {
    this.ui.unregisterAll();
  }

  setConfig(config: Config): void {
    this.ui.unregisterAll();
    this.current = config.apps
      .filter((app) => app.shortcut !== '')
      .map(({ id, shortcut }) => ({
        id,
        shortcut,
        status: isAccelerator(shortcut) ? this.ui.register(shortcut, () => this.press(id)) : 'invalid',
      }));
  }
}
