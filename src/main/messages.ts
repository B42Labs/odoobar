import type { ConfigErrorCode } from './config';

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
    readonly settings: string;
    readonly retry: string;
    readonly noApps: string;
    readonly loadFailed: string;
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
    settings: 'Settings',
    retry: 'Try again',
    noApps: 'No apps are configured.',
    loadFailed: '{name} could not be loaded.\n\n{url}\n{reason}',
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
    settings: 'Einstellungen',
    retry: 'Erneut versuchen',
    noApps: 'Es sind keine Apps eingerichtet.',
    loadFailed: '{name} konnte nicht geladen werden.\n\n{url}\n{reason}',
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
