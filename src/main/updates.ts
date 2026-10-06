import { REPOSITORY, REPOSITORY_URL } from './app-menu';
import { isObject } from './config';
import { isInstalledRun, type InstalledApp } from './installed-run';

/** A newer release of OdooBar: its version without the `v`, and the page that offers its download. */
export interface Update {
  readonly version: string;
  readonly url: string;
}

/** The address that names the latest release. GitHub leaves drafts and pre-releases out of it. */
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

/** The time between two checks while OdooBar runs. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Major, minor, and patch. */
export type Version = readonly [number, number, number];

/** Three numbers without leading zeros, as semantic versioning writes them, with one `v` in front for a tag. */
const VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Reads a version such as `0.2.0` or a tag such as `v0.2.0`. Anything else, such as `v0.2.0-rc.1`, gives undefined. */
export function parseVersion(text: unknown): Version | undefined {
  const match = typeof text === 'string' ? VERSION.exec(text) : null;
  if (!match) return undefined;
  const [, major, minor, patch] = match;
  return [Number(major), Number(minor), Number(patch)];
}

/** Whether `candidate` comes after `current`: by major, then minor, then patch, each as a number. */
export function isNewer(candidate: Version, current: Version): boolean {
  const [major, minor, patch] = candidate;
  const [currentMajor, currentMinor, currentPatch] = current;
  if (major !== currentMajor) return major > currentMajor;
  if (minor !== currentMinor) return minor > currentMinor;
  return patch > currentPatch;
}

/**
 * The update that a release document of the GitHub API offers over the
 * version `current`, or undefined. Only `tag_name` counts. The address of the
 * page starts with REPOSITORY_URL, and the version pattern lets nothing but
 * digits, dots, and one leading `v` into it, so no address from the network,
 * such as `html_url`, reaches the browser.
 */
export function updateFrom(release: unknown, current: string): Update | undefined {
  const tag = isObject(release) ? release.tag_name : undefined;
  if (typeof tag !== 'string') return undefined;
  const candidate = parseVersion(tag);
  const installed = parseVersion(current);
  if (!candidate || !installed || !isNewer(candidate, installed)) return undefined;
  return { version: candidate.join('.'), url: `${REPOSITORY_URL}/releases/tag/${tag}` };
}

/** The seam between the update decisions and the network. updates-ui.ts is the Electron side. */
export interface UpdatesDeps {
  /** The JSON document at an address, or undefined for an answer without one. Rejects when the address does not answer. */
  fetchJson(url: string): Promise<unknown>;
  /** A newer release exists. Called once per version. */
  found(update: Update): void;
}

/** Asks for the latest release and reports each version that is newer than `current` once. */
export class Updates {
  private reported: string | undefined;

  constructor(
    private readonly deps: UpdatesDeps,
    private readonly current: string,
  ) {}

  /**
   * Checks once and never rejects. An answer without a release document, as
   * GitHub gives while the repository has no release or is private, is the
   * normal case and reports nothing.
   */
  async check(): Promise<void> {
    try {
      const update = updateFrom(await this.deps.fetchJson(LATEST_RELEASE_URL), this.current);
      if (!update || update.version === this.reported) return;
      this.deps.found(update);
      this.reported = update.version;
    } catch (error) {
      // No network or a failed connection (net::ERR_*), the timeout of the request, a body that
      // is no JSON, or an error of found. Nothing shows, and the next check tries again.
      console.error('OdooBar could not check for updates:', error);
    }
  }
}

/**
 * Checks for a newer release now and every CHECK_INTERVAL_MS, in the installed
 * app only. Every other run never contacts GitHub.
 */
export function watchForUpdates(app: InstalledApp & { getVersion(): string }, deps: UpdatesDeps): void {
  if (!isInstalledRun(app)) return;
  const updates = new Updates(deps, app.getVersion());
  // check() never rejects, it logs what goes wrong.
  void updates.check();
  setInterval(() => void updates.check(), CHECK_INTERVAL_MS);
}
