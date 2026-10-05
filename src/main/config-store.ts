import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigError, parseConfig, serializeConfig, validateConfig, type Config } from './config';

export type LoadResult =
  | { readonly status: 'loaded'; readonly config: Config }
  | { readonly status: 'missing' }
  | { readonly status: 'invalid'; readonly error: ConfigError }
  | { readonly status: 'unreadable'; readonly reason: string };

/**
 * The one way to read and write config.json. It reads the file once, at
 * start, and does not watch it. Later packages read the configuration with
 * get() and onChange() and write it with save().
 */
export class ConfigStore {
  private current: Config | undefined;
  private readonly listeners = new Set<(config: Config) => void>();

  constructor(readonly filePath: string) {}

  /** Reads and validates the file. It never writes, so an invalid file stays as it is. */
  load(): LoadResult {
    let text: string;
    try {
      text = readFileSync(this.filePath, 'utf8');
    } catch (error) {
      const { code, message } = error as NodeJS.ErrnoException;
      if (code === 'ENOENT') return { status: 'missing' };
      // Every other read error, such as EISDIR or EACCES, reaches the user
      // with its message, because OdooBar cannot start without the file.
      return { status: 'unreadable', reason: message };
    }
    try {
      this.current = parseConfig(text);
    } catch (error) {
      if (error instanceof ConfigError) return { status: 'invalid', error };
      throw error;
    }
    return { status: 'loaded', config: this.current };
  }

  /** The current configuration. Throws before a successful load() or save(). */
  get(): Config {
    if (this.current === undefined) throw new Error('configuration is not loaded');
    return this.current;
  }

  /**
   * Validates and writes the configuration, then tells every listener. The
   * file is written next to its target and renamed onto it, so a crash never
   * leaves half a file. When this throws, the file, the current
   * configuration, and the listeners are untouched.
   */
  save(config: Config): void {
    const valid = validateConfig(config);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    const fd = openSync(temporary, 'w');
    try {
      writeFileSync(fd, serializeConfig(valid));
      // Without the fsync, a power loss can store the rename before the data
      // and leave an empty config.json.
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.filePath);
    this.current = valid;
    for (const listener of [...this.listeners]) listener(valid);
  }

  /** Calls `listener` after every successful save. Returns a function that unsubscribes. */
  onChange(listener: (config: Config) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Renames the file to config.invalid-YYYYMMDD-HHMMSS.json in the same
   * directory, in local time, and returns the new path. Throws the ENOENT
   * error of the rename when there is no file.
   */
  moveAside(now = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const backup = join(dirname(this.filePath), `config.invalid-${date}-${time}.json`);
    renameSync(this.filePath, backup);
    return backup;
  }
}
