import { resolveAppUrl, type Config } from './config';
import { fill, type Messages } from './messages';
import { linkTarget } from './navigation';
import type { Shortcut } from './shortcuts';

/** What the app bar page shows. The main process sends it whole after every change. */
export interface BarState {
  readonly apps: readonly { readonly id: string; readonly name: string }[];
  readonly activeId: string | undefined;
  /** Shown below the bar while no view is. `retry` adds the button that reloads the active app. */
  readonly notice: { readonly text: string; readonly retry: boolean } | undefined;
  readonly texts: { readonly settings: string; readonly retry: string };
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
  /** Shows the view of this app and hides every other one. undefined hides all, so the notice shows. */
  showView(id: string | undefined): void;
  renderBar(state: BarState): void;
  /** Brings the window to the front. The first call creates it. */
  showWindow(): void;
  hideWindow(): void;
}

/** What the window asks of the system. */
export interface Desktop {
  openExternal(url: string): void;
  revealConfig(): void;
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
 * changes its app, or its page closes itself. A closed view of the active app
 * opens again at the start address.
 */
export class WindowController {
  private baseUrl: string;
  private apps: App[];
  private active: string | undefined;
  private visible = false;
  private readonly open = new Set<string>();
  private readonly failures = new Map<string, { readonly url: string; readonly reason: string }>();

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

  /** A click in the app bar. On the active app it loads the start address again, which is the way back from any page. */
  pressApp(id: string): void {
    if (id !== this.active) return this.selectApp(id);
    const app = this.apps.find((candidate) => candidate.id === id);
    if (!app) return;
    this.failures.delete(id);
    if (this.open.has(id)) this.ui.loadView(id, app.url);
    this.present();
  }

  /** Reloads the page of the active app, or loads the address again that failed. */
  reloadActive(): void {
    const id = this.active;
    if (id === undefined || !this.open.has(id)) return;
    const failure = this.failures.get(id);
    if (!failure) return this.ui.reloadView(id);
    this.failures.delete(id);
    this.ui.loadView(id, failure.url);
    this.present();
  }

  openSettings(): void {
    this.desktop.revealConfig();
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

  /** A link in the view of `id` asked for a new window or tab. */
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
    return {
      apps: this.apps.map(({ id, name }) => ({ id, name })),
      activeId: this.active,
      notice,
      texts: { settings: appBar.settings, retry: appBar.retry },
    };
  }

  /** Brings the screen in line with the state. A hidden window gets no view. */
  private present(): void {
    const app = this.apps.find((candidate) => candidate.id === this.active);
    if (this.visible) {
      if (app && !this.open.has(app.id)) {
        this.ui.openView(app.id, app.url);
        this.open.add(app.id);
      }
      this.ui.showView(app && !this.failures.has(app.id) ? app.id : undefined);
    }
    this.ui.renderBar(this.barState());
  }
}
