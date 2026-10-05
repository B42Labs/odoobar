/** One app as config.json lists it. README.md, section "Felder pro App", describes the fields. */
export interface AppConfig {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly icon: string;
  readonly shortcut: string;
  readonly menuBar: boolean;
}

/** The content of config.json after validation, with every optional field filled in. */
export interface Config {
  readonly baseUrl: string;
  readonly launchAtLogin: boolean;
  readonly apps: readonly AppConfig[];
}

export type ConfigErrorCode =
  | 'invalid-json'
  | 'expected-object'
  | 'expected-array'
  | 'expected-string'
  | 'expected-boolean'
  | 'empty'
  | 'duplicate-id'
  | 'url-invalid'
  | 'url-scheme'
  | 'url-credentials'
  | 'url-query'
  | 'app-url';

/**
 * A rule that config.json or a typed address violates. It carries a code and
 * the path of the value, such as `apps[1].url` or `''` for the whole file,
 * never a sentence: the sentence depends on the language (messages.ts).
 */
export class ConfigError extends Error {
  constructor(
    readonly code: ConfigErrorCode,
    readonly path: string,
  ) {
    super(path === '' ? code : `${path}: ${code}`);
    this.name = 'ConfigError';
  }
}

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The path of `key` inside the value at `parent`, such as `apps[1].url`. */
function pathOf(parent: string, key: string): string {
  return parent === '' ? key : `${parent}.${key}`;
}

/** Reads a string. An absent key gives `fallback`, or fails when the key is required. */
function readString(object: JsonObject, parent: string, key: string, fallback?: string): string {
  const path = pathOf(parent, key);
  if (!Object.hasOwn(object, key)) {
    if (fallback === undefined) throw new ConfigError('expected-string', path);
    return fallback;
  }
  const value = object[key];
  if (typeof value !== 'string') throw new ConfigError('expected-string', path);
  return value;
}

/** Reads a required string that holds more than white space. */
function readText(object: JsonObject, parent: string, key: string): string {
  const value = readString(object, parent, key);
  if (value.trim() === '') throw new ConfigError('empty', pathOf(parent, key));
  return value;
}

/** Reads a boolean. An absent key gives false. */
function readBoolean(object: JsonObject, parent: string, key: string): boolean {
  if (!Object.hasOwn(object, key)) return false;
  const value = object[key];
  if (typeof value !== 'boolean') throw new ConfigError('expected-boolean', pathOf(parent, key));
  return value;
}

/**
 * Turns a typed address into the stored form of baseUrl: https:// when the
 * scheme is missing, a lower-case host, no default port, and no trailing
 * slash. A path prefix stays, because app paths are appended to baseUrl.
 */
export function normalizeBaseUrl(input: string): string {
  const path = 'baseUrl';
  const trimmed = input.trim();
  if (trimmed === '') throw new ConfigError('empty', path);
  // Without a scheme, new URL('localhost:8069') would read "localhost:" as one.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = URL.parse(withScheme);
  if (!url) throw new ConfigError('url-invalid', path);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ConfigError('url-scheme', path);
  // OdooBar stores no password.
  if (url.username !== '' || url.password !== '') throw new ConfigError('url-credentials', path);
  if (/[?#]/.test(trimmed)) throw new ConfigError('url-query', path);
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/**
 * The address an app opens. A path is appended to baseUrl as plain text, so
 * `/web#action=123` keeps its fragment. A full address stays as it is.
 */
export function resolveAppUrl(baseUrl: string, appUrl: string): string {
  return appUrl.startsWith('/') ? baseUrl + appUrl : appUrl;
}

function isAppUrl(url: string): boolean {
  return url.startsWith('/') || (/^https?:\/\//i.test(url) && URL.canParse(url));
}

function validateApp(value: unknown, path: string): AppConfig {
  if (!isObject(value)) throw new ConfigError('expected-object', path);
  const id = readText(value, path, 'id');
  const name = readText(value, path, 'name');
  const url = readString(value, path, 'url');
  if (!isAppUrl(url)) throw new ConfigError('app-url', pathOf(path, 'url'));
  return {
    id,
    name,
    url,
    icon: readString(value, path, 'icon', ''),
    shortcut: readString(value, path, 'shortcut', ''),
    menuBar: readBoolean(value, path, 'menuBar'),
  };
}

/**
 * Checks a parsed config.json and throws a ConfigError for the first rule it
 * violates. The result holds the normalized baseUrl, the defaults of absent
 * optional fields, and no unknown keys.
 */
export function validateConfig(value: unknown): Config {
  if (!isObject(value)) throw new ConfigError('expected-object', '');
  const baseUrl = normalizeBaseUrl(readString(value, '', 'baseUrl'));
  const launchAtLogin = readBoolean(value, '', 'launchAtLogin');
  const list = Object.hasOwn(value, 'apps') ? value.apps : [];
  if (!Array.isArray(list)) throw new ConfigError('expected-array', 'apps');
  const apps: AppConfig[] = [];
  const ids = new Set<string>();
  for (const [index, entry] of (list as unknown[]).entries()) {
    const path = `apps[${index}]`;
    const app = validateApp(entry, path);
    if (ids.has(app.id)) throw new ConfigError('duplicate-id', pathOf(path, 'id'));
    ids.add(app.id);
    apps.push(app);
  }
  return { baseUrl, launchAtLogin, apps };
}

/** Parses and validates the text of config.json. Text that is no JSON, an empty file included, gives `invalid-json`. */
export function parseConfig(text: string): Config {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new ConfigError('invalid-json', '');
    throw error;
  }
  return validateConfig(value);
}

/** The text of config.json, with the keys in the order of the example in README.md. */
export function serializeConfig(config: Config): string {
  const value = {
    baseUrl: config.baseUrl,
    launchAtLogin: config.launchAtLogin,
    apps: config.apps.map((app) => ({
      id: app.id,
      name: app.name,
      url: app.url,
      icon: app.icon,
      shortcut: app.shortcut,
      menuBar: app.menuBar,
    })),
  };
  return JSON.stringify(value, null, 2) + '\n';
}
