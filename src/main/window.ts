import { checkInClock, readAttendance, switchAttendance, type AttendanceStatus, type PostJson } from './attendance';
import { resolveAppUrl, type Config } from './config';
import { fill, reasonOf, type Messages } from './messages';
import { appKey, isInsideInstance, linkTarget } from './navigation';
import { loadOdooApps, type OdooApp } from './odoo-apps';
import type { Shortcut } from './shortcuts';
import type { Update } from './updates';

/** A step through the pages that a view has shown. */
export type Direction = 'back' | 'forward';

/** What the app bar page shows. The main process sends it whole after every change. */
export interface BarState {
  /** `close` names the button that takes the app off the bar. undefined for an app of the configuration, which has none. */
  readonly apps: readonly { readonly id: string; readonly name: string; readonly close: string | undefined }[];
  readonly activeId: string | undefined;
  /** Which of the buttons that go back, go forward, and reload act on the active app. The others are greyed out. */
  readonly nav: { readonly back: boolean; readonly forward: boolean; readonly reload: boolean };
  /** Shown below the bar while no view is. `retry` adds the button that reloads the active app. */
  readonly notice: { readonly text: string; readonly retry: boolean } | undefined;
  /** The button that leads to a newer release. undefined hides it. */
  readonly update: { readonly label: string; readonly hint: string } | undefined;
  /** The button that checks in and out. undefined hides it. `busy` greys it out while a click is worked on. */
  readonly attendance: { readonly checkedIn: boolean; readonly hint: string; readonly busy: boolean } | undefined;
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
  /** Tells the user in a sheet of the window that something failed. */
  showFailure(failure: { readonly message: string; readonly detail: string }): void;
}

/** What the window asks of the system and of the rest of OdooBar. */
export interface Desktop {
  openExternal(url: string): void;
  /** Opens the settings window. */
  openSettings(): void;
  /**
   * Fetches an address with the login of the views and gives the JSON
   * document of the answer, or undefined for an answer that holds none.
   */
  fetchJson(url: string): Promise<unknown>;
  /**
   * Posts a JSON document with the login of the views and gives the JSON
   * document of the answer, or undefined for an answer that holds none.
   */
  postJson(url: string, body: unknown): Promise<unknown>;
  /** The current time in milliseconds since the epoch. */
  now(): number;
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
 *
 * The bar lists the apps of the configuration and, behind them, the apps
 * that a link opened (followLink). Those are listed nowhere else, and each
 * stays until its close button, a sign-out, or the end of OdooBar.
 *
 * The attendance button shows only what the instance last answered about the
 * signed-in user, and a click asks again before it checks in or out, so it
 * never acts on a state that changed elsewhere.
 */
export class WindowController {
  private baseUrl: string;
  private apps: App[];
  /** The apps that a link opened, in the order of their opening. */
  private extras: App[] = [];
  private extraCount = 0;
  /** The apps of the Odoo account with their full start addresses, as far as the instance has named them. */
  private known: readonly Pick<App, 'name' | 'url'>[] = [];
  private learning = 0;
  private active: string | undefined;
  private visible = false;
  private readonly open = new Set<string>();
  private readonly failures = new Map<string, { readonly url: string; readonly reason: string }>();
  private signingOut: Promise<void> | undefined;
  private update: Update | undefined;
  /** Whether the configuration turns the attendance button on. */
  private attendanceOn: boolean;
  /** What the instance last answered about attendance: undefined before an answer, after a sign-out, and for another one. */
  private attendance: AttendanceStatus | undefined;
  /** A click on the attendance button is worked on. */
  private attendanceBusy = false;
  /** Counts the requests about attendance, as `learning` counts those for the apps, so an old answer is dropped. */
  private attendanceReads = 0;

  constructor(
    private readonly ui: WindowUi,
    private readonly desktop: Desktop,
    private readonly messages: Messages,
    config: Config,
  ) {
    this.baseUrl = config.baseUrl;
    this.apps = appsOf(config);
    this.active = this.apps[0]?.id;
    this.attendanceOn = config.attendance;
  }

  get activeId(): string | undefined {
    return this.active;
  }

  show(): void {
    this.visible = true;
    this.ui.showWindow();
    this.present();
    // refreshAttendance never rejects, it logs what goes wrong.
    void this.refreshAttendance();
  }

  hide(): void {
    this.visible = false;
    this.ui.hideWindow();
  }

  /** Every app of the bar: the ones of the configuration, then the ones that a link opened. */
  private get listed(): App[] {
    return [...this.apps, ...this.extras];
  }

  /** Makes an app the active one. An unknown id and the active app change nothing. */
  selectApp(id: string): void {
    if (id === this.active || !this.listed.some((app) => app.id === id)) return;
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
    if (!this.listed.some((app) => app.id === id)) return;
    if (this.visible && id === this.active && this.ui.isWindowFocused()) return this.hide();
    this.active = id;
    this.show();
  }

  /** A click in the app bar. On the active app it loads the start address again, which is the way back from any page. */
  pressApp(id: string): void {
    if (id !== this.active) return this.selectApp(id);
    const app = this.listed.find((candidate) => candidate.id === id);
    if (!app) return;
    this.failures.delete(id);
    if (this.open.has(id)) this.ui.loadView(id, app.url);
    this.present();
  }

  /**
   * The close button of an app that a link opened. The app leaves the bar,
   * and its view goes with it. Was it the active app, the one behind it
   * takes its place, or else the one before it. An app of the configuration
   * stays, since only the settings remove it.
   */
  closeApp(id: string): void {
    const index = this.extras.findIndex((app) => app.id === id);
    if (index < 0) return;
    this.dropView(id);
    this.extras.splice(index, 1);
    if (id === this.active) this.active = (this.extras[index] ?? this.extras[index - 1] ?? this.apps.at(-1))?.id;
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

  /**
   * A newer release exists, and the app bar offers it until OdooBar quits.
   * Only the bar is drawn again, so a hidden window opens no view. Nothing
   * else sets the update, so a saved configuration keeps the button.
   */
  setUpdate(update: Update): void {
    this.update = update;
    this.ui.renderBar(this.barState());
  }

  /** A click on the update button opens the page of the release in the browser. Without an update, nothing happens. */
  openUpdate(): void {
    if (this.update) this.desktop.openExternal(this.update.url);
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
        const app = this.listed[shortcut.index];
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

  /**
   * A link in the view of `id` asked for a new window or tab, or for an
   * address that is not http(s). A link inside the instance loads in the
   * view, unless it opens another app as followLink describes it.
   */
  openLink(id: string, url: string): void {
    switch (linkTarget(this.baseUrl, url)) {
      case 'view':
        if (this.open.has(id) && !this.openApp(id, url)) this.ui.loadView(id, url);
        return;
      case 'browser':
        return this.desktop.openExternal(url);
      case 'drop':
        return;
    }
  }

  /**
   * A click on a link to `url` in the view of `id`, whose page is at
   * `pageUrl`, before that page hears of it. A link to the start address of
   * another app of the bar makes that app the active one, with the page it
   * has. A link to the start address of an app that the Odoo account has and
   * the bar lacks adds the app behind the others and makes it the active one.
   * True means that the click is taken and the page must not follow the link.
   * False leaves the link to the page: any other link, the link to the app of
   * this view, a link on a page outside the instance, and a link in a view
   * that the user does not see.
   */
  followLink(id: string, pageUrl: string, url: string): boolean {
    return this.open.has(id) && isInsideInstance(this.baseUrl, pageUrl) && this.openApp(id, url);
  }

  /**
   * A view finished loading a page. The account may have changed with it, as
   * a login does, so the instance is asked for the apps of the account, which
   * followLink then knows. An instance that does not answer changes nothing.
   * Resolves once the answer is taken in.
   */
  async pageLoaded(): Promise<void> {
    const request = ++this.learning;
    const baseUrl = this.baseUrl;
    let apps: OdooApp[] | undefined;
    try {
      apps = await loadOdooApps(baseUrl, (url) => this.desktop.fetchJson(url));
    } catch {
      return;
    }
    // A later page, a sign-out, or another instance has made this answer an old one.
    if (request !== this.learning) return;
    this.known = (apps ?? []).map(({ name, url }) => ({ name, url: resolveAppUrl(baseUrl, url) }));
  }

  /**
   * Asks the instance about the attendance of the signed-in user, so the
   * button shows what Odoo says now. The window shown, its focus, a page load
   * in a view, Odoo's own check-in button in a view, and a saved configuration
   * call it. With the switch off it asks nothing, and during a click it leaves
   * the asking to the click. Never rejects.
   */
  async refreshAttendance(): Promise<void> {
    if (!this.attendanceOn || this.attendanceBusy) return;
    const request = ++this.attendanceReads;
    const baseUrl = this.baseUrl;
    let status: AttendanceStatus;
    try {
      status = await readAttendance(baseUrl, (url, body) => this.desktop.postJson(url, body));
    } catch (error) {
      // No network or a refused connection (net::ERR_*), the timeout of the request, an answer that claims JSON
      // and holds none, or an error of Odoo other than an expired login. The button keeps what it shows until the
      // next read.
      console.error(`OdooBar could not read the attendance state of ${baseUrl}:`, error);
      return;
    }
    // A later read, a click, a sign-out, or another instance has made this answer an old one.
    if (request !== this.attendanceReads) return;
    this.attendance = status;
    this.ui.renderBar(this.barState());
  }

  /**
   * A page in a view completed a request to `url`, the route behind Odoo's own
   * check-in button, and the attendance button follows it. The same route on
   * another site, which a page or frame from there may ask as often as it
   * likes, asks the instance nothing. Only the origin counts, because Odoo's
   * button posts to the route at the root, also below a path prefix of the
   * base URL. Never rejects.
   */
  async attendanceSwitched(url: string): Promise<void> {
    if (URL.parse(url)?.origin === new URL(this.baseUrl).origin) await this.refreshAttendance();
  }

  /**
   * A click on the attendance button. It asks the instance first and checks
   * in or out only when Odoo's state is the one the button shows. Otherwise
   * the click only shows the state of Odoo. The button is greyed out until
   * the click is done, and a failure shows in a sheet. A sign-out or another
   * configuration ends a click on its way without a word. Never rejects.
   */
  async pressAttendance(): Promise<void> {
    const shown = this.attendance;
    if (this.attendanceBusy || shown?.kind !== 'usable') return;
    this.attendanceBusy = true;
    const request = ++this.attendanceReads;
    this.ui.renderBar(this.barState());
    const baseUrl = this.baseUrl;
    const postJson: PostJson = (url, body) => this.desktop.postJson(url, body);
    const texts = this.messages.attendance;
    // A sign-out or another configuration has reset the button through forgetAttendance, and a later click may
    // own it by now, so this one stops without a word.
    const dropped = () => request !== this.attendanceReads;
    let failure: string | undefined;
    let status: AttendanceStatus | undefined;
    try {
      status = await readAttendance(baseUrl, postJson);
    } catch (error) {
      failure = reasonOf(error);
    }
    if (dropped()) return;
    if (status?.kind === 'usable' && status.checkedIn === shown.checkedIn) {
      try {
        const outcome = await switchAttendance(baseUrl, postJson);
        if (outcome === 'signed-out') failure = texts.reasons['signed-out'];
        else if (outcome === 'no-answer') failure = texts.noAnswer;
      } catch (error) {
        failure = reasonOf(error);
      }
      if (dropped()) return;
      // Whatever the change did, the button shows what Odoo says afterwards.
      try {
        status = await readAttendance(baseUrl, postJson);
      } catch (error) {
        // As in refreshAttendance. The change may have worked while the button shows the state before it, and the
        // next click asks first, so it only corrects the button.
        console.error(`OdooBar could not read the attendance state of ${baseUrl} after a click:`, error);
        status = undefined;
      }
      if (dropped()) return;
      // Odoo made the change although its answer timed out or got lost on the way, so the click did what it was for.
      if (status?.kind === 'usable' && status.checkedIn !== shown.checkedIn) failure = undefined;
    } else if (status && status.kind !== 'usable') {
      failure = texts.reasons[status.kind];
    }
    if (status) this.attendance = status;
    this.attendanceBusy = false;
    this.ui.renderBar(this.barState());
    if (failure === undefined) return;
    this.ui.showFailure({ message: shown.checkedIn ? texts.checkOutFailed : texts.checkInFailed, detail: failure });
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
   * login page. The apps that a link opened leave the bar, and the first app
   * takes the place of an active one. A call during a sign-out joins it. Rejects with the error of
   * clearProfile. The settings window calls it.
   */
  signOut(): Promise<void> {
    if (this.signingOut) return this.signingOut;
    for (const id of this.open) this.ui.closeView(id);
    this.open.clear();
    this.failures.clear();
    // The next login may be another account, with other apps.
    if (this.extras.some((app) => app.id === this.active)) this.active = this.apps[0]?.id;
    this.extras = [];
    this.forgetKnown();
    this.forgetAttendance();
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
   * listed with the same address. An app that a link opened stays, unless the
   * instance changed or the configuration now lists the app itself, by its
   * start address or under the same id. That app of the configuration then
   * takes the place of an active one. Otherwise the active app stays active
   * when it is still listed, and the first app is when it is not. The
   * attendance button goes with the switch off or another instance, and the
   * instance is asked again when the switch is on and either changed.
   */
  setConfig(config: Config): void {
    const apps = appsOf(config);
    const sameInstance = config.baseUrl === this.baseUrl;
    const wasOn = this.attendanceOn;
    const configured = (extra: App) =>
      apps.find((app) => app.id === extra.id || appKey(app.url) === appKey(extra.url));
    const extras = this.extras.filter((extra) => sameInstance && !configured(extra));
    const active = this.extras.find((extra) => extra.id === this.active);
    for (const id of [...this.open]) {
      const before = this.apps.find((app) => app.id === id);
      const after = apps.find((app) => app.id === id);
      if (before && after && before.url === after.url) continue;
      if (extras.some((extra) => extra.id === id)) continue;
      this.dropView(id);
    }
    if (!sameInstance) this.forgetKnown();
    this.attendanceOn = config.attendance;
    if (!sameInstance || !this.attendanceOn) this.forgetAttendance();
    this.baseUrl = config.baseUrl;
    this.apps = apps;
    this.extras = extras;
    if (active && !extras.includes(active)) this.active = (sameInstance ? configured(active) : undefined)?.id;
    if (!this.listed.some((app) => app.id === this.active)) this.active = apps[0]?.id;
    this.present();
    // refreshAttendance never rejects, it logs what goes wrong.
    if (this.attendanceOn && (!sameInstance || !wasOn)) void this.refreshAttendance();
  }

  /**
   * Makes the app that `url` opens the active one, for a link in the view of
   * `from`. Returns false and changes nothing for a link that opens no app,
   * for the app of `from` itself, and for a view that is not the active one,
   * so no page in the background moves the user away from what they see.
   */
  private openApp(from: string, url: string): boolean {
    const key = appKey(url);
    if (key === undefined || from !== this.active) return false;
    let app = this.listed.find((candidate) => appKey(candidate.url) === key);
    if (!app) {
      const known = this.known.find((candidate) => appKey(candidate.url) === key);
      if (!known) return false;
      app = { id: this.extraId(), name: known.name, url: known.url };
      this.extras.push(app);
    }
    if (app.id === from) return false;
    this.selectApp(app.id);
    return true;
  }

  /** An id that no app of the bar has. A later configuration may take it, and setConfig then drops the opened app. */
  private extraId(): string {
    for (;;) {
      const id = `opened-${++this.extraCount}`;
      if (!this.apps.some((app) => app.id === id)) return id;
    }
  }

  /** Closes the view of an app, if it has one, and drops the notice of its page. */
  private dropView(id: string): void {
    if (this.open.delete(id)) this.ui.closeView(id);
    this.failures.delete(id);
  }

  /** The apps of the account are those of another login or instance now. An answer on its way is dropped as well. */
  private forgetKnown(): void {
    this.learning++;
    this.known = [];
  }

  /**
   * The attendance is that of another login or instance now, or the switch is
   * off. A read and a click on their way are dropped as well.
   */
  private forgetAttendance(): void {
    this.attendanceReads++;
    this.attendance = undefined;
    this.attendanceBusy = false;
  }

  private barState(): BarState {
    const { appBar, attendance: attendanceTexts, locale } = this.messages;
    const app = this.listed.find((candidate) => candidate.id === this.active);
    const failure = app && this.failures.get(app.id);
    let notice: BarState['notice'];
    if (!app) notice = { text: appBar.noApps, retry: false };
    else if (failure) {
      const { url, reason } = failure;
      notice = { text: fill(appBar.loadFailed, { name: app.name, url, reason }), retry: true };
    }
    let attendance: BarState['attendance'];
    if (this.attendance?.kind === 'usable') {
      const { checkedIn, since } = this.attendance;
      let hint = checkedIn ? attendanceTexts.checkOut : attendanceTexts.checkIn;
      if (checkedIn && since !== undefined) {
        hint = fill(attendanceTexts.checkOutSince, { since: checkInClock(since, this.desktop.now(), locale) });
      }
      attendance = { checkedIn, hint, busy: this.attendanceBusy };
    }
    const viewId = app && this.open.has(app.id) ? app.id : undefined;
    const version = this.update?.version;
    return {
      apps: [
        ...this.apps.map(({ id, name }) => ({ id, name, close: undefined })),
        ...this.extras.map(({ id, name }) => ({ id, name, close: fill(appBar.close, { name }) })),
      ],
      activeId: this.active,
      nav: {
        back: viewId !== undefined && this.ui.canGo(viewId, 'back'),
        forward: viewId !== undefined && this.ui.canGo(viewId, 'forward'),
        reload: viewId !== undefined,
      },
      notice,
      update:
        version === undefined
          ? undefined
          : { label: fill(appBar.update, { version }), hint: fill(appBar.updateHint, { version }) },
      attendance,
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
    const app = this.listed.find((candidate) => candidate.id === this.active);
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
