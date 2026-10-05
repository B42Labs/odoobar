import { ConfigError, normalizeBaseUrl, type Config } from './config';
import type { ConfigStore } from './config-store';
import { fill, type Messages } from './messages';

export type SubmitResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** The seam between the startup decisions and the screen. startup-ui.ts is the Electron side. */
export interface StartupUi {
  /**
   * Shows the first-start prompt and calls `submit` for every attempt.
   * Resolves true once `submit` returned ok, false when the user closed the
   * prompt.
   */
  askBaseUrl(submit: (input: string) => SubmitResult): Promise<boolean>;
  /** Shows the invalid-file dialog. Resolves true when the user chose "Reset". */
  confirmReset(detail: string): Promise<boolean>;
  showFatal(message: string, detail: string): Promise<void>;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The configuration a first start writes: two apps with a menu bar icon and
 * no shortcut. The language picks their names once, they are ordinary values
 * in the file afterwards.
 */
export function initialConfig(baseUrl: string, messages: Messages): Config {
  return {
    baseUrl,
    launchAtLogin: false,
    apps: [
      { id: 'home', name: messages.seedApps.home, url: '/odoo', icon: 'house', shortcut: '', menuBar: true },
      {
        id: 'timesheets',
        name: messages.seedApps.timesheets,
        url: '/odoo/timesheets',
        icon: 'clock',
        shortcut: '',
        menuBar: true,
      },
    ],
  };
}

/** Checks a typed address and saves the initial configuration for it. */
export function submitBaseUrl(store: ConfigStore, input: string, messages: Messages): SubmitResult {
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(input);
  } catch (error) {
    if (error instanceof ConfigError) return { ok: false, error: messages.configErrors[error.code] };
    throw error;
  }
  try {
    store.save(initialConfig(baseUrl, messages));
  } catch (error) {
    // A file system error such as EACCES or ENOSPC. The prompt shows it and
    // stays open, so the user can try again.
    return { ok: false, error: fill(messages.saveFailed, { reason: reasonOf(error) }) };
  }
  return { ok: true };
}

/**
 * Returns the configuration to run with, or undefined when OdooBar has to
 * quit. A missing file opens the first-start prompt. An invalid file stays as
 * it is unless the user chooses to reset it, which renames it to a backup and
 * opens the prompt.
 */
export async function loadOrCreateConfig(
  store: ConfigStore,
  ui: StartupUi,
  messages: Messages,
): Promise<Config | undefined> {
  const result = store.load();
  switch (result.status) {
    case 'loaded':
      return result.config;
    case 'unreadable':
      await ui.showFatal(messages.unreadableConfig, `${store.filePath}\n\n${result.reason}`);
      return undefined;
    case 'invalid': {
      const { code, path } = result.error;
      const text = messages.configErrors[code];
      const problem = path === '' ? text : `${path}: ${text}`;
      const detail = fill(messages.invalidConfig.detail, { file: store.filePath, problem });
      if (!(await ui.confirmReset(detail))) return undefined;
      try {
        store.moveAside();
      } catch (error) {
        // A file system error such as EACCES. The dialog names it, and the
        // file stays where it is.
        await ui.showFatal(messages.resetFailed, `${store.filePath}\n\n${reasonOf(error)}`);
        return undefined;
      }
      break;
    }
    case 'missing':
      break;
  }
  const saved = await ui.askBaseUrl((input) => submitBaseUrl(store, input, messages));
  return saved ? store.get() : undefined;
}
