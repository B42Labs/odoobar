import { resolveAppUrl, type Config } from './config';
import { fill, type Messages } from './messages';
import { linkTarget } from './navigation';
import type { Shortcut } from './shortcuts';

/** A step through the pages that a view has shown. */
export type Direction = 'back' | 'forward';

/** What the app bar page shows. The main process sends it whole after every change. */
export interface BarState {
  readonly apps: readonly { readonly id: string; readonly name: string }[];
  readonly activeId: string | undefined;
  /** Which of the buttons that go back, go forward, and reload act on the active app. The others are greyed out. */
  readonly nav: { readonly back: boolean; readonly forward: boolean; readonly reload: boolean };
  /** Shown below the bar while no view is. `retry` adds the button that reloads the active app. */
  readonly notice: { readonly text: string; readonly retry: boolean } | undefined;
  readonly texts: {
    readonly back: string;
    readonly forward: string;
    readonly reload: string;
    readonly settings: string;
    readonly retry: string;
  };
}

/** A place on the screens, in the points that Electron counts across all of them. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The seam between the window decisions and the screen. window-ui.ts is the Electron side. */
export interface WindowUi {
  /** Creates the view of an app and loads `url` in it. */
  openView(id: string, url: string): void;
  /** Destroys the view of an app with the page it holds. */
  closeView(id: string): void;
  /** Loads `url` in the existing view of an app. */
  loadView(id: string, url: string): void;
  reloadView(id: string): void;
  /** Whether the view of an app has shown a page that lies one step in this direction. False for an app without a view. */
  canGo(id: string, direction: Direction): boolean;
  /** Takes the view of an app one step through the pages it has shown. */
  go(id: string, direction: Direction): void;
  /** Shows the view of this app and hides every other one. undefined hides all, so the notice shows. */
  showView(id: string | undefined): void;
  renderBar(state: BarState): void;
  /** Brings the window to the front. The first call creates it. */
  showWindow(): void;
  hideWindow(): void;
  /** Whether the window is the one that takes the keys right now. False for a hidden window and before the first showWindow. */
  isWindowFocused(): boolean;
  /** Where the window is, or was when it hid. undefined before the first showWindow. */
  windowBounds(): Bounds | undefined;
  /** Deletes what the pages of all views stored: cookies, page storage, and caches. */
  clearProfile(): Promise<void>;
}

/** What the window asks of the system and of the rest of OdooBar. */
export interface Desktop {
  openExternal(url: string): void;
  /** Opens the settings window. */
  openSettings(): void;
}

interface App {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

function appsOf(config: Config): App[] {
  return config.apps.map(({ id, name, url }) => ({ id, name, url: resolveAppUrl(config.baseUrl, url) }));
}

/**
 * Decides what the window shows: which app is active, which views exist, and
 * what the app bar says. A view is created when its app is first shown in a
 * visible window and lives until OdooBar quits, the configuration drops or
 * changes its app, a sign-out clears the profile, or its page closes itself.
 * A closed view of the active app opens again at the start address.
 */
export class WindowController {
  private baseUrl: string;
  private apps: App[];
  private active: string | undefined;
  private visible = false;
  private readonly open = new Set<string>();
  private readonly failures = new Map<string, { readonly url: string; readonly reason: string }>();
  private signingOut: Promise<void> | undefined;

  constructor(
    private readonly ui: WindowUi,
    private readonly desktop: Desktop,
    private readonly messages: Messages,
    config: Config,
  ) {
    this.baseUrl = config.baseUrl;
    this.apps = appsOf(config);
    this.active = this.apps[0]?.id;
  }

  get activeId(): string | undefined {
    return this.active;
  }

  show(): void {
    this.visible = true;
    this.ui.showWindow();
    this.present();
  }

  hide(): void {
    this.visible = false;
    this.ui.hideWindow();
  }

  /** Makes an app the active one. An unknown id and the active app change nothing. */
  selectApp(id: string): void {
    if (id === this.active || !this.apps.some((app) => app.id === id)) return;
    this.active = id;
    this.present();
  }

  /**
   * A click on the menu bar icon of an app. It hides the window when this app
   * is in front: active in a window that takes the keys. Otherwise it makes
   * the app the active one and brings the window to the front. An unknown id
   * changes nothing.
   */
  toggleApp(id: string): void {
    if (!this.apps.some((app) => app.id === id)) return;
    if (this.visible && id === this.active && this.ui.isWindowFocused()) return this.hide();
    this.active = id;
    this.show();
  }

  /** A click in the app bar. On the active app it loads the start address again, which is the way back from any page. */
  pressApp(id: string): void {
    if (id !== this.active) return this.selectApp(id);
    const app = this.apps.find((candidate) => candidate.id === id);
    if (!app) return;
    this.failures.delete(id);
    if (this.open.has(id)) this.ui.loadView(id, app.url);
    this.present();
  }

  /** Whether an app has a view, and so a page that reloadApp reloads. */
  canReload(id: string): boolean {
    return this.open.has(id);
  }

  /** Reloads the page of an app, or loads the address again that failed. An app without a view stays as it is. */
  reloadApp(id: string): void {
    if (!this.canReload(id)) return;
    const failure = this.failures.get(id);
    if (!failure) return this.ui.reloadView(id);
    this.failures.delete(id);
    this.ui.loadView(id, failure.url);
    this.present();
  }

  /** Reloads the active app as reloadApp does. */
  reloadActive(): void {
    if (this.active !== undefined) this.reloadApp(this.active);
  }

  /**
   * Takes the active app one step through the pages it has shown, as the
   * arrows in the app bar do. Without a page in that direction, nothing
   * happens. A notice makes way for the page the step leads to.
   */
  go(direction: Direction): void {
    const id = this.active;
    if (id === undefined || !this.open.has(id) || !this.ui.canGo(id, direction)) return;
    this.ui.go(id, direction);
    if (this.failures.delete(id)) this.present();
  }

  /** The view of an app gives other answers to canGo than before, so the arrows in the app bar change. */
  historyChanged(id: string): void {
    if (id === this.active) this.ui.renderBar(this.barState());
  }

  openSettings(): void {
    this.desktop.openSettings();
  }

  /** Where the window is on the screens. A hidden window is nowhere, so nothing opens over a place the user does not see. */
  bounds(): Bounds | undefined {
    return this.visible ? this.ui.windowBounds() : undefined;
  }

  handleShortcut(shortcut: Shortcut): void {
    switch (shortcut.kind) {
      case 'select': {
        const app = this.apps[shortcut.index];
        if (app) this.selectApp(app.id);
        return;
      }
      case 'reload':
        return this.reloadActive();
      case 'settings':
        return this.openSettings();
      case 'hide':
        return this.hide();
    }
  }

  /** A link in the view of `id` asked for a new window or tab, or for an address that is not http(s). */
  openLink(id: string, url: string): void {
    switch (linkTarget(this.baseUrl, url)) {
      case 'view':
        if (this.open.has(id)) this.ui.loadView(id, url);
        return;
      case 'browser':
        return this.desktop.openExternal(url);
      case 'drop':
        return;
    }
  }

  /**
   * Whether a page or frame at `url` gets a permission it asks for, such as
   * notifications or the microphone. Only the origin of the Odoo instance
   * does. The path does not count, because Chromium keeps a permission per
   * origin, so `url` may be an origin alone.
   */
  grantsPermission(url: string): boolean {
    return URL.parse(url)?.origin === new URL(this.baseUrl).origin;
  }

  /** The page of an app did not load. The notice replaces its view until a reload. */
  loadFailed(id: string, url: string, reason: string): void {
    if (!this.open.has(id)) return;
    this.failures.set(id, { url, reason });
    this.present();
  }

  /** The page of an app closed its own view, as window.close() does. The app starts over at its start address. */
  viewClosed(id: string): void {
    if (!this.open.delete(id)) return;
    this.failures.delete(id);
    this.present();
  }

  /**
   * Deletes the login with everything else the pages stored. Every view
   * closes first, so no page writes while the profile is cleared, and no view
   * opens until that is done. The active app then opens again, on the Odoo
   * login page. A call during a sign-out joins it. Rejects with the error of
   * clearProfile. The settings window calls it.
   */
  signOut(): Promise<void> {
    if (this.signingOut) return this.signingOut;
    for (const id of this.open) this.ui.closeView(id);
    this.open.clear();
    this.failures.clear();
    // The async function turns an error that clearProfile throws into a rejection.
    const signingOut = (async () => this.ui.clearProfile())().finally(() => {
      this.signingOut = undefined;
      this.present();
    });
    this.signingOut = signingOut;
    this.present();
    return signingOut;
  }

  /**
   * Takes over a saved configuration. A view survives when its app is still
   * listed with the same address. The active app stays active when it is
   * still listed, otherwise the first app is.
   */
  setConfig(config: Config): void {
    const apps = appsOf(config);
    for (const id of [...this.open]) {
      const before = this.apps.find((app) => app.id === id);
      const after = apps.find((app) => app.id === id);
      if (before && after && before.url === after.url) continue;
      this.ui.closeView(id);
      this.open.delete(id);
      this.failures.delete(id);
    }
    this.baseUrl = config.baseUrl;
    this.apps = apps;
    if (!apps.some((app) => app.id === this.active)) this.active = apps[0]?.id;
    this.present();
  }

  private barState(): BarState {
    const { appBar } = this.messages;
    const app = this.apps.find((candidate) => candidate.id === this.active);
    const failure = app && this.failures.get(app.id);
    let notice: BarState['notice'];
    if (!app) notice = { text: appBar.noApps, retry: false };
    else if (failure) {
      const { url, reason } = failure;
      notice = { text: fill(appBar.loadFailed, { name: app.name, url, reason }), retry: true };
    }
    const viewId = app && this.open.has(app.id) ? app.id : undefined;
    return {
      apps: this.apps.map(({ id, name }) => ({ id, name })),
      activeId: this.active,
      nav: {
        back: viewId !== undefined && this.ui.canGo(viewId, 'back'),
        forward: viewId !== undefined && this.ui.canGo(viewId, 'forward'),
        reload: viewId !== undefined,
      },
      notice,
      texts: {
        back: appBar.back,
        forward: appBar.forward,
        reload: appBar.reload,
        settings: appBar.settings,
        retry: appBar.retry,
      },
    };
  }

  /** Brings the screen in line with the state. A hidden window gets no view, and neither does a sign-out in progress. */
  private present(): void {
    const app = this.apps.find((candidate) => candidate.id === this.active);
    if (this.visible) {
      if (app && !this.open.has(app.id) && !this.signingOut) {
        this.ui.openView(app.id, app.url);
        this.open.add(app.id);
      }
      this.ui.showView(app && this.open.has(app.id) && !this.failures.has(app.id) ? app.id : undefined);
    }
    this.ui.renderBar(this.barState());
  }
}
