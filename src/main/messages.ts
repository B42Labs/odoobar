import type { ConfigErrorCode } from './config';
import type { ShortcutStatus } from './global-shortcuts';

export type Locale = 'de' | 'en';

/**
 * Every text that OdooBar shows. Later packages add their texts here and to
 * both constants below, so a missing translation is a compile error.
 */
export interface Messages {
  readonly quit: string;
  readonly firstStart: { readonly title: string; readonly label: string; readonly hint: string; readonly save: string };
  readonly seedApps: { readonly home: string; readonly timesheets: string };
  readonly configErrors: Readonly<Record<ConfigErrorCode, string>>;
  readonly saveFailed: string;
  readonly invalidConfig: { readonly message: string; readonly detail: string; readonly reset: string };
  readonly unreadableConfig: string;
  readonly resetFailed: string;
  readonly appBar: {
    readonly back: string;
    readonly forward: string;
    readonly reload: string;
    readonly settings: string;
    readonly retry: string;
    readonly noApps: string;
    readonly loadFailed: string;
  };
  readonly menuBar: { readonly reload: string; readonly settings: string };
  readonly appMenu: {
    readonly about: string;
    readonly hide: string;
    readonly hideOthers: string;
    readonly showAll: string;
    readonly quit: string;
    readonly edit: string;
    readonly undo: string;
    readonly redo: string;
    readonly cut: string;
    readonly copy: string;
    readonly paste: string;
    readonly pasteAndMatchStyle: string;
    readonly delete: string;
    readonly selectAll: string;
    readonly view: string;
    readonly actualSize: string;
    readonly zoomIn: string;
    readonly zoomOut: string;
    readonly developerTools: string;
    readonly window: string;
    readonly minimize: string;
    readonly zoom: string;
    readonly close: string;
    readonly bringAllToFront: string;
  };
  readonly about: { readonly version: string; readonly ok: string; readonly repository: string };
  readonly settings: {
    readonly title: string;
    readonly general: string;
    readonly baseUrl: string;
    readonly launchAtLogin: string;
    readonly apps: string;
    readonly name: string;
    readonly url: string;
    readonly icon: string;
    readonly shortcut: string;
    readonly menuBar: string;
    readonly record: string;
    readonly recording: string;
    readonly moveUp: string;
    readonly moveDown: string;
    readonly remove: string;
    readonly add: string;
    readonly blankApp: string;
    readonly odooApps: {
      readonly title: string;
      readonly loading: string;
      readonly none: string;
      readonly signedOut: string;
      readonly failed: string;
    };
    readonly shortcutHint: string;
    readonly shortcutNotices: Readonly<Record<Exclude<ShortcutStatus, 'registered'>, string>>;
    readonly pickIcon: string;
    readonly searchIcons: string;
    readonly noIcon: string;
    readonly session: string;
    readonly signOut: string;
    readonly signOutHint: string;
    readonly confirmSignOut: { readonly message: string; readonly detail: string };
    readonly signOutFailed: string;
    readonly save: string;
    readonly cancel: string;
    readonly discard: { readonly message: string; readonly discard: string; readonly keep: string };
  };
}

const en: Messages = {
  quit: 'Quit',
  firstStart: {
    title: 'Welcome to OdooBar',
    label: 'Address of your Odoo instance',
    hint: 'Example: https://odoo.example.com',
    save: 'Save',
  },
  seedApps: { home: 'Home', timesheets: 'Timesheets' },
  configErrors: {
    'invalid-json': 'The file is not valid JSON.',
    'expected-object': 'An object is expected here.',
    'expected-array': 'A list is expected here.',
    'expected-string': 'A text value is expected here.',
    'expected-boolean': 'true or false is expected here.',
    empty: 'This value must not be empty.',
    'duplicate-id': 'Another app already uses this id.',
    'url-invalid': 'This is not a valid address.',
    'url-scheme': 'The address must start with http:// or https://.',
    'url-credentials': 'The address must not contain a user name or a password.',
    'url-query': 'The address must not contain ? or #.',
    'app-url': 'A path that starts with / or a full http:// or https:// address is expected here.',
  },
  saveFailed: 'OdooBar could not save the configuration: {reason}',
  invalidConfig: {
    message: 'The OdooBar configuration is invalid',
    detail:
      '{file}\n\n{problem}\n\nQuit keeps the file as it is, so you can repair it. Reset renames the file to a backup copy next to it and asks for the Odoo address again.',
    reset: 'Reset',
  },
  unreadableConfig: 'OdooBar cannot read its configuration',
  resetFailed: 'OdooBar could not rename the configuration file',
  appBar: {
    back: 'Back',
    forward: 'Forward',
    reload: 'Reload',
    settings: 'Settings',
    retry: 'Try again',
    noApps: 'No apps are configured.',
    loadFailed: '{name} could not be loaded.\n\n{url}\n{reason}',
  },
  menuBar: { reload: 'Reload', settings: 'Settings…' },
  appMenu: {
    about: 'About OdooBar',
    hide: 'Hide OdooBar',
    hideOthers: 'Hide Others',
    showAll: 'Show All',
    quit: 'Quit OdooBar',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    pasteAndMatchStyle: 'Paste and Match Style',
    delete: 'Delete',
    selectAll: 'Select All',
    view: 'View',
    actualSize: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    developerTools: 'Toggle Developer Tools',
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom',
    close: 'Close Window',
    bringAllToFront: 'Bring All to Front',
  },
  about: { version: 'Version {version}', ok: 'OK', repository: 'Open on GitHub' },
  settings: {
    title: 'OdooBar Settings',
    general: 'General',
    baseUrl: 'Address of your Odoo instance',
    launchAtLogin: 'Start OdooBar at login',
    apps: 'Apps',
    name: 'Name',
    url: 'Address',
    icon: 'Icon',
    shortcut: 'Shortcut',
    menuBar: 'Show in menu bar',
    record: 'Record',
    recording: 'Press the shortcut…',
    moveUp: 'Move up',
    moveDown: 'Move down',
    remove: 'Remove',
    add: 'Add app',
    blankApp: 'Empty app',
    odooApps: {
      title: 'Apps of your Odoo account',
      loading: 'Loading…',
      none: 'Your Odoo account has no apps.',
      signedOut:
        'Odoo lists the apps of your account only after the login. Sign in to Odoo in the OdooBar window, then open this choice again.',
      failed: 'OdooBar could not load the apps: {reason}',
    },
    shortcutHint:
      'macOS does not tell OdooBar when another program uses a shortcut. If a shortcut does not respond, choose another one.',
    shortcutNotices: {
      invalid: 'This is not a valid shortcut.',
      duplicate: 'An app further up already has this shortcut, and it works only there.',
      refused: 'macOS refused this shortcut.',
    },
    pickIcon: 'Choose an icon',
    searchIcons: 'Search icons',
    noIcon: 'No icon',
    session: 'Session',
    signOut: 'Sign out',
    signOutHint: 'Deletes everything the Odoo pages stored on this Mac, the login included. The configuration stays.',
    confirmSignOut: { message: 'Sign out of Odoo?', detail: 'Every app shows the Odoo login page again.' },
    signOutFailed: 'OdooBar could not sign out: {reason}',
    save: 'Save',
    cancel: 'Cancel',
    discard: { message: 'Discard the unsaved changes?', discard: 'Discard', keep: 'Keep editing' },
  },
};

const de: Messages = {
  quit: 'Beenden',
  firstStart: {
    title: 'Willkommen bei OdooBar',
    label: 'Adresse deiner Odoo-Instanz',
    hint: 'Beispiel: https://odoo.example.com',
    save: 'Speichern',
  },
  seedApps: { home: 'Home', timesheets: 'Zeiterfassung' },
  configErrors: {
    'invalid-json': 'Die Datei ist kein gültiges JSON.',
    'expected-object': 'Hier wird ein Objekt erwartet.',
    'expected-array': 'Hier wird eine Liste erwartet.',
    'expected-string': 'Hier wird ein Text erwartet.',
    'expected-boolean': 'Hier wird true oder false erwartet.',
    empty: 'Dieser Wert darf nicht leer sein.',
    'duplicate-id': 'Diese id verwendet schon eine andere App.',
    'url-invalid': 'Das ist keine gültige Adresse.',
    'url-scheme': 'Die Adresse muss mit http:// oder https:// beginnen.',
    'url-credentials': 'Die Adresse darf keinen Benutzernamen und kein Passwort enthalten.',
    'url-query': 'Die Adresse darf kein ? und kein # enthalten.',
    'app-url':
      'Hier wird ein Pfad, der mit / beginnt, oder eine vollständige Adresse mit http:// oder https:// erwartet.',
  },
  saveFailed: 'OdooBar konnte die Konfiguration nicht speichern: {reason}',
  invalidConfig: {
    message: 'Die OdooBar-Konfiguration ist ungültig',
    detail:
      '{file}\n\n{problem}\n\n„Beenden“ lässt die Datei unverändert, damit du sie reparieren kannst. „Zurücksetzen“ benennt die Datei in eine Sicherungskopie im selben Ordner um und fragt erneut nach der Odoo-Adresse.',
    reset: 'Zurücksetzen',
  },
  unreadableConfig: 'OdooBar kann seine Konfiguration nicht lesen',
  resetFailed: 'OdooBar konnte die Konfigurationsdatei nicht umbenennen',
  appBar: {
    back: 'Zurück',
    forward: 'Vorwärts',
    reload: 'Neu laden',
    settings: 'Einstellungen',
    retry: 'Erneut versuchen',
    noApps: 'Es sind keine Apps eingerichtet.',
    loadFailed: '{name} konnte nicht geladen werden.\n\n{url}\n{reason}',
  },
  menuBar: { reload: 'Neu laden', settings: 'Einstellungen …' },
  appMenu: {
    about: 'Über OdooBar',
    hide: 'OdooBar ausblenden',
    hideOthers: 'Andere ausblenden',
    showAll: 'Alle einblenden',
    quit: 'OdooBar beenden',
    edit: 'Bearbeiten',
    undo: 'Widerrufen',
    redo: 'Wiederholen',
    cut: 'Ausschneiden',
    copy: 'Kopieren',
    paste: 'Einsetzen',
    pasteAndMatchStyle: 'Einsetzen und Stil anpassen',
    delete: 'Löschen',
    selectAll: 'Alles auswählen',
    view: 'Darstellung',
    actualSize: 'Originalgröße',
    zoomIn: 'Vergrößern',
    zoomOut: 'Verkleinern',
    developerTools: 'Entwicklertools ein-/ausblenden',
    window: 'Fenster',
    minimize: 'Im Dock ablegen',
    zoom: 'Zoomen',
    close: 'Fenster schließen',
    bringAllToFront: 'Alle nach vorne bringen',
  },
  about: { version: 'Version {version}', ok: 'OK', repository: 'Auf GitHub öffnen' },
  settings: {
    title: 'OdooBar-Einstellungen',
    general: 'Allgemein',
    baseUrl: 'Adresse deiner Odoo-Instanz',
    launchAtLogin: 'OdooBar bei der Anmeldung starten',
    apps: 'Apps',
    name: 'Name',
    url: 'Adresse',
    icon: 'Symbol',
    shortcut: 'Kürzel',
    menuBar: 'In Menüleiste anzeigen',
    record: 'Aufnehmen',
    recording: 'Kürzel drücken …',
    moveUp: 'Nach oben',
    moveDown: 'Nach unten',
    remove: 'Entfernen',
    add: 'App hinzufügen',
    blankApp: 'Leere App',
    odooApps: {
      title: 'Apps deines Odoo-Kontos',
      loading: 'Lädt …',
      none: 'Dein Odoo-Konto hat keine Apps.',
      signedOut:
        'Odoo nennt die Apps deines Kontos erst nach der Anmeldung. Melde dich im Fenster von OdooBar bei Odoo an und öffne diese Auswahl dann erneut.',
      failed: 'OdooBar konnte die Apps nicht laden: {reason}',
    },
    shortcutHint:
      'macOS teilt OdooBar nicht mit, ob ein anderes Programm ein Kürzel verwendet. Reagiert ein Kürzel nicht, wähle ein anderes.',
    shortcutNotices: {
      invalid: 'Das ist kein gültiges Kürzel.',
      duplicate: 'Eine App weiter oben hat dieses Kürzel schon, es gilt nur dort.',
      refused: 'macOS hat dieses Kürzel abgelehnt.',
    },
    pickIcon: 'Symbol wählen',
    searchIcons: 'Symbole durchsuchen',
    noIcon: 'Kein Symbol',
    session: 'Sitzung',
    signOut: 'Abmelden',
    signOutHint:
      'Löscht alles, was die Odoo-Seiten auf diesem Mac gespeichert haben, auch die Anmeldung. Die Konfiguration bleibt erhalten.',
    confirmSignOut: { message: 'Von Odoo abmelden?', detail: 'Jede App zeigt danach wieder die Odoo-Anmeldeseite.' },
    signOutFailed: 'OdooBar konnte nicht abmelden: {reason}',
    save: 'Speichern',
    cancel: 'Abbrechen',
    discard: { message: 'Ungespeicherte Änderungen verwerfen?', discard: 'Verwerfen', keep: 'Weiter bearbeiten' },
  },
};

/** German for a German language tag such as de-AT, English for every other tag. */
export function pickLocale(tag: string): Locale {
  return tag.toLowerCase().split(/[-_]/)[0] === 'de' ? 'de' : 'en';
}

export function messagesFor(locale: Locale): Messages {
  return locale === 'de' ? de : en;
}

/**
 * Replaces each {name} in `template` with `values[name]`. A placeholder
 * without a value stays as it is. A `$` in a value stays literal, and an
 * inserted value is not searched for placeholders again.
 */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}

/** The text of an error for the {reason} of a message. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
