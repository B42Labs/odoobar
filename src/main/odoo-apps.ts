import { isObject } from './config';

/** An app of the Odoo account, with what a new app of the configuration takes from it. */
export interface OdooApp {
  readonly name: string;
  /** The path that opens the app, such as `/odoo/crm`. */
  readonly url: string;
  /** The name of a Lucide icon, or '' for an app that APP_ICONS does not know. */
  readonly icon: string;
}

/**
 * The Lucide icon of an Odoo app, by the module that defines its menu, which
 * is the part of the menu's XML id before the dot. The module `base` defines
 * two apps, so those stand with their whole XML id.
 */
const APP_ICONS: ReadonlyMap<string, string> = new Map([
  ['base.menu_management', 'layout-grid'],
  ['base.menu_administration', 'settings'],
  ['mail', 'message-circle'],
  ['calendar', 'calendar'],
  ['appointment', 'calendar-clock'],
  ['project_todo', 'list-todo'],
  ['knowledge', 'book-open'],
  ['contacts', 'contact'],
  ['crm', 'handshake'],
  ['sale', 'trending-up'],
  ['sale_subscription', 'repeat'],
  ['sale_renting', 'key-round'],
  ['point_of_sale', 'store'],
  ['pos_enterprise', 'chef-hat'],
  ['account', 'receipt'],
  ['account_accountant', 'receipt'],
  ['accountant', 'receipt'],
  ['hr_expense', 'wallet'],
  ['documents', 'folder'],
  ['sign', 'signature'],
  ['spreadsheet_dashboard', 'layout-dashboard'],
  ['project', 'square-kanban'],
  ['hr_timesheet', 'clock'],
  ['planning', 'calendar-range'],
  ['industry_fsm', 'map-pinned'],
  ['helpdesk', 'life-buoy'],
  ['website', 'globe'],
  ['website_slides', 'graduation-cap'],
  ['im_livechat', 'messages-square'],
  ['mass_mailing', 'mail'],
  ['mass_mailing_sms', 'message-square-text'],
  ['marketing_automation', 'workflow'],
  ['social', 'share-2'],
  ['event', 'ticket'],
  ['survey', 'clipboard-list'],
  ['utm', 'link'],
  ['purchase', 'shopping-cart'],
  ['stock', 'package'],
  ['stock_barcode', 'scan-barcode'],
  ['mrp', 'factory'],
  ['mrp_workorder', 'hard-hat'],
  ['quality_control', 'badge-check'],
  ['maintenance', 'wrench'],
  ['repair', 'hammer'],
  ['hr', 'users'],
  ['hr_recruitment', 'user-search'],
  ['hr_holidays', 'tree-palm'],
  ['hr_attendance', 'user-check'],
  ['hr_payroll', 'banknote'],
  ['hr_appraisal', 'star'],
  ['fleet', 'car'],
  ['lunch', 'utensils'],
  ['approvals', 'stamp'],
  ['voip', 'phone'],
  ['iot', 'cpu'],
  ['web_studio', 'pencil-ruler'],
]);

/** Every icon that odooApps can name. test/unit/odoo-apps.test.ts checks that Lucide has each. */
export const appIcons: readonly string[] = [...new Set(APP_ICONS.values())];

function iconOf(xmlid: unknown): string {
  if (typeof xmlid !== 'string') return '';
  return APP_ICONS.get(xmlid) ?? APP_ICONS.get(xmlid.split('.')[0] ?? '') ?? '';
}

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/**
 * The path that opens the app of a menu, or undefined for a menu without an
 * action. Odoo 18 and later name the path of the action, or `false` for an
 * action without one. Odoo checks a path against this pattern, and a text
 * that does not match it never becomes part of an address. Earlier versions
 * have no `actionPath` and open an app by the numbers of its action and menu.
 */
function urlOf(menu: Readonly<Record<string, unknown>>): string | undefined {
  const { id, actionID, actionPath } = menu;
  if (!isId(actionID)) return undefined;
  if (!Object.hasOwn(menu, 'actionPath')) {
    return isId(id) ? `/web#action=${actionID}&menu_id=${id}` : `/web#action=${actionID}`;
  }
  return typeof actionPath === 'string' && /^[a-z][a-z0-9_-]*$/.test(actionPath)
    ? `/odoo/${actionPath}`
    : `/odoo/action-${actionID}`;
}

/**
 * The apps in the menu document of Odoo, in the order of its home page. The
 * document maps the id of each menu to the menu, and `root` lists the ids of
 * the apps as its children. A menu without a name or an action is left out.
 * A value that is no menu document, such as undefined, gives undefined.
 */
export function odooApps(menus: unknown): OdooApp[] | undefined {
  if (!isObject(menus) || !isObject(menus.root) || !Array.isArray(menus.root.children)) return undefined;
  const apps: OdooApp[] = [];
  for (const id of menus.root.children as unknown[]) {
    const menu = Object.hasOwn(menus, String(id)) ? menus[String(id)] : undefined;
    if (!isObject(menu)) continue;
    const name = typeof menu.name === 'string' ? menu.name.trim() : '';
    const url = urlOf(menu);
    if (name !== '' && url !== undefined) apps.push({ name, url, icon: iconOf(menu.xmlid) });
  }
  return apps;
}

/**
 * The addresses that answer with the menu document of the signed-in user, the
 * one of Odoo 19 first. Earlier versions want one more path segment, of which
 * they use nothing.
 */
export function menuUrls(baseUrl: string): string[] {
  return [`${baseUrl}/web/webclient/load_menus`, `${baseUrl}/web/webclient/load_menus/odoobar`];
}

/**
 * Asks the Odoo instance for the apps of the signed-in user: the menus that
 * its home page shows as apps. `fetchJson` gives the JSON document of an
 * address, or undefined for an answer without one. undefined means that no
 * address answered with a menu document, as without a login.
 */
export async function loadOdooApps(
  baseUrl: string,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<OdooApp[] | undefined> {
  for (const url of menuUrls(baseUrl)) {
    const apps = odooApps(await fetchJson(url));
    if (apps) return apps;
  }
  return undefined;
}
