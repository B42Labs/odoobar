import { session } from 'electron';
import { fetchSessionJson } from './window-ui';

/**
 * The JSON document of an answer, as fetchOdooJson gives it, but through the
 * default session, which holds no cookie of Odoo. An answer without one, such
 * as the 404 of a repository without a release or of a private one, or the
 * 403 and 429 of the rate limit, gives undefined. An address that does not
 * answer, or not within ten seconds, fails, and so does a body that is no
 * JSON despite its content type.
 */
export async function fetchReleaseJson(url: string): Promise<unknown> {
  return fetchSessionJson(session.defaultSession, url, 'application/vnd.github+json');
}
