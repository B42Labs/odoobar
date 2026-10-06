import { ConfigError, isObject, validateConfig, type Config } from './config';
import type { ShortcutState } from './global-shortcuts';
import { fill, reasonOf, type Messages } from './messages';
import { loadOdooApps, type OdooApp } from './odoo-apps';
import type { KeyInput } from './shortcuts';
import type { Bounds } from './window';

/** What the settings page shows. It is sent whole on init and after every save. */
export interface SettingsState {
  readonly config: Config;
  /** The notice for the saved shortcut of an app, by app id. An app without a shortcut, or with a registered one, is absent. */
  readonly notices: Readonly<Record<string, string>>;
  readonly texts: Messages['settings'];
}

/** What 'settings:init' returns. The preload script imports the type from here. */
export interface SettingsInit {
  readonly state: SettingsState;
  /** The address of the icon directory, with a trailing slash. */
  readonly iconsUrl: string;
  /** Every icon name of the build, sorted. */
  readonly icons: readonly string[];
  readonly fallbackIcon: string;
}

export type SaveResult =
  | { readonly ok: true; readonly state: SettingsState }
  /** `path` is the ConfigError path, such as `apps[1].url`, or '' for an error that belongs to no field. */
  | { readonly ok: false; readonly path: string; readonly error: string };

export type SignOutResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type OdooAppsResult =
  | { readonly ok: true; readonly apps: readonly OdooApp[] }
  | { readonly ok: false; readonly error: string };

export type RecordedKey =
  | { readonly kind: 'shortcut'; readonly accelerator: string }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'wait' };

/** The seam between the settings decisions and the screen. settings-ui.ts is the Electron side. */
export interface SettingsUi {
  /**
   * Brings the settings window to the front. The first call, and the first
   * after a close, creates it: over `over`, the place of the main window, or on
   * the screen with the mouse pointer when the main window shows nowhere. A
   * window that exists stays where it is.
   */
  showWindow(over: Bounds | undefined): void;
  /** Destroys the settings window without asking. */
  closeWindow(): void;
  /** Tells the page what the recorder caught. undefined ends the recording without a shortcut. */
  recorded(accelerator: string | undefined): void;
  confirmSignOut(): Promise<boolean>;
  confirmDiscard(): Promise<boolean>;
}

/** What the settings ask of the rest of OdooBar. */
export interface SettingsDeps {
  getConfig(): Config;
  saveConfig(config: Config): void;
  shortcutStates(): readonly ShortcutState[];
  suspendShortcuts(): void;
  resumeShortcuts(): void;
  /** Where the main window is on the screens, or undefined while it is hidden. */
  windowBounds(): Bounds | undefined;
  signOut(): Promise<void>;
  /**
   * Fetches an address with the login of the Odoo pages and returns the JSON
   * document of the answer, or undefined for an answer that holds none, such
   * as a login page.
   */
  fetchJson(url: string): Promise<unknown>;
}

/**
 * The id of a new app, made from its name, since the settings let a user edit
 * every field of an app but its id. The name is lower-cased, every run of
 * characters outside a-z and 0-9 becomes `-`, and `-` at both ends goes. A
 * name that is no string or leaves nothing gives `app`. An id in `taken` gets
 * the suffix `-2`, `-3`, and so on.
 */
export function appId(name: unknown, taken: ReadonlySet<string>): string {
  const slug = typeof name === 'string' ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
  const base = slug === '' ? 'app' : slug;
  let id = base;
  for (let suffix = 2; taken.has(id); suffix++) id = `${base}-${suffix}`;
  return id;
}

/** The text fields of an app that the settings trim before validation. */
const TEXT_FIELDS = ['name', 'url', 'icon', 'shortcut'] as const;

function keptId(entry: unknown): string | undefined {
  return isObject(entry) && typeof entry.id === 'string' && entry.id.trim() !== '' ? entry.id : undefined;
}

/**
 * Turns the draft of the settings page into a value for validateConfig: every
 * app that is an object has its texts trimmed and an id, its own or one from
 * appId. Anything that is not an object with an `apps` list comes back as it
 * is, and so does an entry of the list that is no object, so validateConfig
 * names it.
 */
export function prepareDraft(value: unknown): unknown {
  if (!isObject(value) || !Array.isArray(value.apps)) return value;
  const list: unknown[] = value.apps;
  const taken = new Set(list.map(keptId).filter((id) => id !== undefined));
  const apps = list.map((entry) => {
    if (!isObject(entry)) return entry;
    const app: Record<string, unknown> = { ...entry };
    for (const field of TEXT_FIELDS) {
      const text = app[field];
      if (typeof text === 'string') app[field] = text.trim();
    }
    if (keptId(entry) === undefined) {
      const id = appId(app.name, taken);
      taken.add(id);
      app.id = id;
    }
    return app;
  });
  return { ...value, apps };
}

/**
 * The top left corner of a window of `size` that opens centered over
 * `anchor`. `area` is the part of the screen of the anchor that windows may
 * use, and the window moves as far as it must to lie inside: an anchor at the
 * edge of the screen would push it off. A window larger than the area starts
 * at the top left corner of the area, so its title bar stays in reach.
 */
export function placeOver(
  size: { readonly width: number; readonly height: number },
  anchor: Bounds,
  area: Bounds,
): { x: number; y: number } {
  const along = (start: number, length: number, areaStart: number, areaLength: number, own: number) =>
    Math.round(Math.max(areaStart, Math.min(start + (length - own) / 2, areaStart + areaLength - own)));
  return {
    x: along(anchor.x, anchor.width, area.x, area.width, size.width),
    y: along(anchor.y, anchor.height, area.y, area.height, size.height),
  };
}

/** The accelerator names of the keys the recorder takes besides letters, digits, and F keys, by `code`. */
const NAMED_KEYS = new Map([
  ['Space', 'Space'],
  ['Tab', 'Tab'],
  ['Backspace', 'Backspace'],
  ['Delete', 'Delete'],
  ['Home', 'Home'],
  ['End', 'End'],
  ['PageUp', 'PageUp'],
  ['PageDown', 'PageDown'],
  ['Enter', 'Return'],
  ['ArrowUp', 'Up'],
  ['ArrowDown', 'Down'],
  ['ArrowLeft', 'Left'],
  ['ArrowRight', 'Right'],
]);

function keyName(code: string): string | undefined {
  return /^Key([A-Z])$/.exec(code)?.[1] ?? /^Digit([0-9])$/.exec(code)?.[1] ?? NAMED_KEYS.get(code);
}

/**
 * What a key press means while the settings record a shortcut. The key is
 * read from `code`, its position, because Electron registers a global
 * shortcut on macOS by the position on the US layout (electron/electron#19747),
 * so the key a user presses is the key that works afterwards. A key other than
 * an F key needs Command, Control, or Option, since a plain key, or one with
 * Shift alone, would take that key from every other program. Escape alone
 * cancels, and every other key is waited past.
 */
export function recordKey(input: KeyInput): RecordedKey {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return { kind: 'wait' };
  const { meta, control, alt, shift } = input;
  if (input.code === 'Escape' && !meta && !control && !alt && !shift) return { kind: 'cancel' };
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(input.code);
  const key = functionKey ? input.code : keyName(input.code);
  if (key === undefined || (!functionKey && !meta && !control && !alt)) return { kind: 'wait' };
  const modifiers: [boolean, string][] = [
    [control, 'Control'],
    [alt, 'Alt'],
    [shift, 'Shift'],
    [meta, 'Command'],
  ];
  const parts = modifiers.filter(([pressed]) => pressed).map(([, name]) => name);
  return { kind: 'shortcut', accelerator: [...parts, key].join('+') };
}

/**
 * Decides what the settings window shows, saves, and records. The page keeps
 * the edits until Save, and tells this class whether it has unsaved ones, so
 * a close asks before it discards them. A recording releases the global
 * shortcuts until it ends.
 */
export class Settings {
  private dirty = false;
  private recording = false;
  private closing = false;

  constructor(
    private readonly ui: SettingsUi,
    private readonly deps: SettingsDeps,
    private readonly messages: Messages,
  ) {}

  open(): void {
    this.ui.showWindow(this.deps.windowBounds());
  }

  state(): SettingsState {
    const texts = this.messages.settings;
    const notices: Record<string, string> = {};
    for (const { id, status } of this.deps.shortcutStates()) {
      if (status !== 'registered') notices[id] = texts.shortcutNotices[status];
    }
    return { config: this.deps.getConfig(), notices, texts };
  }

  /**
   * Validates and saves the draft of the page. Saving tells every listener of
   * the store, so the returned state holds what the window, the menu bar, and
   * the global shortcuts made of it. A shortcut that is no accelerator saves
   * as well and comes back with its notice.
   */
  save(draft: unknown): SaveResult {
    this.cancelRecording();
    try {
      this.deps.saveConfig(validateConfig(prepareDraft(draft)));
    } catch (error) {
      if (error instanceof ConfigError) {
        return { ok: false, path: error.path, error: this.messages.configErrors[error.code] };
      }
      // A file system error of ConfigStore.save, such as EACCES or ENOSPC. The
      // window shows it and keeps the edits, so the user can try again.
      return { ok: false, path: '', error: fill(this.messages.saveFailed, { reason: reasonOf(error) }) };
    }
    this.dirty = false;
    return { ok: true, state: this.state() };
  }

  /** The page reports whether its draft differs from the saved configuration. */
  setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  /**
   * The user asked to close the window. Without unsaved edits it closes at
   * once. With them it asks first, and a second request while the question is
   * open does nothing.
   */
  requestClose(): void {
    if (!this.dirty) return this.ui.closeWindow();
    if (this.closing) return;
    this.closing = true;
    // The async function turns an error that confirmDiscard throws into a rejection.
    (async () => this.ui.confirmDiscard())()
      .catch((error: unknown) => {
        // A question that fails keeps the window and its edits.
        console.error('OdooBar could not ask whether to discard the settings:', error);
        return false;
      })
      .then((discard) => {
        this.closing = false;
        if (discard) this.ui.closeWindow();
      });
  }

  /** The window is gone, with whatever it held. */
  closed(): void {
    this.dirty = false;
    this.closing = false;
    this.cancelRecording();
  }

  startRecording(): void {
    if (this.recording) return;
    this.recording = true;
    // macOS would hand a shortcut that OdooBar holds to its app instead of the window.
    this.deps.suspendShortcuts();
  }

  /** Ends a recording without a shortcut. */
  cancelRecording(): void {
    if (this.recording) this.endRecording(undefined);
  }

  /** A key press in the settings window. Returns true when the recording takes it, so the page never sees it. */
  keyPressed(input: KeyInput): boolean {
    if (!this.recording) return false;
    const key = recordKey(input);
    if (key.kind === 'shortcut') this.endRecording(key.accelerator);
    else if (key.kind === 'cancel') this.endRecording(undefined);
    return true;
  }

  /** Asks first, then deletes what the Odoo pages stored. A cancelled question is no failure, a failed one is. */
  async signOut(): Promise<SignOutResult> {
    try {
      if (!(await this.ui.confirmSignOut())) return { ok: true };
      await this.deps.signOut();
    } catch (error) {
      return { ok: false, error: fill(this.messages.settings.signOutFailed, { reason: reasonOf(error) }) };
    }
    return { ok: true };
  }

  /**
   * The apps of the Odoo account, for the choice of a new app. They come from
   * the saved instance, since the login belongs to it.
   */
  async odooApps(): Promise<OdooAppsResult> {
    const texts = this.messages.settings.odooApps;
    try {
      const apps = await loadOdooApps(this.deps.getConfig().baseUrl, (url) => this.deps.fetchJson(url));
      return apps ? { ok: true, apps } : { ok: false, error: texts.signedOut };
    } catch (error) {
      return { ok: false, error: fill(texts.failed, { reason: reasonOf(error) }) };
    }
  }

  private endRecording(accelerator: string | undefined): void {
    this.recording = false;
    this.deps.resumeShortcuts();
    this.ui.recorded(accelerator);
  }
}
