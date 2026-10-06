/** Where a link that asks for a new window or tab goes. */
export type LinkTarget = 'view' | 'browser' | 'drop';

/** True for baseUrl itself and for every address below it. `/prefixed` is not below `/prefix`. */
export function isInsideInstance(baseUrl: string, url: string): boolean {
  const base = URL.parse(baseUrl);
  const target = URL.parse(url);
  if (!base || !target || target.origin !== base.origin) return false;
  const prefix = base.pathname.replace(/\/+$/, '');
  return target.pathname === prefix || target.pathname.startsWith(`${prefix}/`);
}

/**
 * A link inside the Odoo instance loads in the view that asked. Every other
 * web, mail, or phone link goes to the system. Anything else, such as file:
 * or javascript:, is dropped.
 */
export function linkTarget(baseUrl: string, url: string): LinkTarget {
  const protocol = URL.parse(url)?.protocol;
  if (protocol === 'http:' || protocol === 'https:') return isInsideInstance(baseUrl, url) ? 'view' : 'browser';
  if (protocol === 'mailto:' || protocol === 'tel:') return 'browser';
  return 'drop';
}

/**
 * What the start address of an app shares with every link that opens this
 * app, or undefined for an address that is no web page. Two addresses with
 * the same key open the same app. An Odoo before 18 names the app as
 * `menu_id` behind the `#`, in any order and next to other values, so there
 * the menu alone counts. Everywhere else the whole address counts, but for a
 * slash at the end of its path.
 */
export function appKey(url: string): string | undefined {
  const parsed = URL.parse(url);
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return undefined;
  const page = parsed.origin + parsed.pathname.replace(/\/+$/, '') + parsed.search;
  const menu = new URLSearchParams(parsed.hash.slice(1)).get('menu_id');
  if (menu) return `${page}#menu_id=${menu}`;
  return parsed.hash.length > 1 ? page + parsed.hash : page;
}
