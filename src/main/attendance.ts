import { isObject } from './config';
import type { Locale } from './messages';

// The attendance of the signed-in user, through the two JSON-RPC routes behind
// the attendance button of the Odoo web client. Odoo 17 and later have them.
// The module holds no Electron import, so its tests run in plain Node.js.

/**
 * What the Odoo instance says about the attendance of the signed-in user.
 * Only `usable` lets OdooBar check in and out. `since` is the check-in in
 * milliseconds since the epoch, undefined while checked out and when Odoo
 * names no check-in.
 */
export type AttendanceStatus =
  | { readonly kind: 'usable'; readonly checkedIn: boolean; readonly since: number | undefined }
  /** The instance has no such routes: Odoo 16 or earlier, or no Attendances app. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'signed-out' }
  /** The Odoo user has no employee record. */
  | { readonly kind: 'no-employee' }
  /** The company turned off the check-in in the top bar of Odoo. */
  | { readonly kind: 'systray-off' };

/** Posts a JSON document and gives the JSON document of the answer, or undefined for an answer that holds none. */
export type PostJson = (url: string, body: unknown) => Promise<unknown>;

/** The JSON-RPC call that both routes take. Odoo reads no parameter of it. */
const CALL = { jsonrpc: '2.0', method: 'call', params: {} };

/** The route behind the check-in button in the top bar of Odoo, below the address of the instance. */
export const TOGGLE_ROUTE = 'hr_attendance/systray_check_in_out';

/** The JSON-RPC error code of Odoo for an expired or absent login. */
const SESSION_EXPIRED = 100;
/** The JSON-RPC error code of Odoo for a route that it does not have. */
const NOT_FOUND = 404;

/** The error of a JSON-RPC answer, with the text that Odoo has for the user. */
function odooError(error: Readonly<Record<string, unknown>>): Error {
  const detail = isObject(error.data) ? error.data.message : undefined;
  if (typeof detail === 'string' && detail !== '') return new Error(detail);
  if (typeof error.message === 'string' && error.message !== '') return new Error(error.message);
  return new Error('Odoo Server Error');
}

/**
 * Reads the answer of the state route. A value that is no JSON object, as
 * for a 404, and the error code 404 give `unavailable`. The error code 100,
 * an expired or absent login, gives `signed-out`. Every other error throws
 * the text of Odoo. A result without a state of attendance is that of a user
 * without an employee.
 */
export function attendanceStatus(answer: unknown): AttendanceStatus {
  if (!isObject(answer)) return { kind: 'unavailable' };
  const { error, result } = answer;
  if (isObject(error)) {
    if (error.code === SESSION_EXPIRED) return { kind: 'signed-out' };
    if (error.code === NOT_FOUND) return { kind: 'unavailable' };
    throw odooError(error);
  }
  if (!isObject(result)) return { kind: 'unavailable' };
  const state = result.attendance_state;
  if (state !== 'checked_in' && state !== 'checked_out') return { kind: 'no-employee' };
  if (result.display_systray !== true) return { kind: 'systray-off' };
  const checkedIn = state === 'checked_in';
  return { kind: 'usable', checkedIn, since: checkedIn ? checkInTime(result.last_check_in) : undefined };
}

/**
 * The time of a check-in, which Odoo names in UTC as `YYYY-MM-DD HH:MM:SS`,
 * in milliseconds since the epoch. Any other value, such as the `false` of an
 * employee who never checked in, gives undefined.
 */
export function checkInTime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const part = (index: number) => Number(match[index]);
  return Date.UTC(part(1), part(2) - 1, part(3), part(4), part(5), part(6));
}

/** Asks the instance for the attendance of the signed-in user. Rejects with the error of `postJson` or of Odoo. */
export async function readAttendance(baseUrl: string, postJson: PostJson): Promise<AttendanceStatus> {
  return attendanceStatus(await postJson(`${baseUrl}/hr_attendance/attendance_user_data`, CALL));
}

/**
 * Checks the signed-in user in when checked out, and out when checked in.
 * `no-answer` is an answer without a JSON document. The state is not read
 * from the answer: the caller asks for it again. Rejects with the error of
 * `postJson` or with the text of an error of Odoo.
 */
export async function switchAttendance(
  baseUrl: string,
  postJson: PostJson,
): Promise<'done' | 'signed-out' | 'no-answer'> {
  const answer = await postJson(`${baseUrl}/${TOGGLE_ROUTE}`, CALL);
  if (!isObject(answer)) return 'no-answer';
  if (isObject(answer.error)) {
    if (answer.error.code === SESSION_EXPIRED) return 'signed-out';
    throw odooError(answer.error);
  }
  return 'done';
}

/**
 * The local clock time of a check-in, such as `08:15`, with the day and the
 * month when the check-in was on another local day than `now`.
 */
export function checkInClock(since: number, now: number, locale: Locale): string {
  const sameDay = new Date(since).toDateString() === new Date(now).toDateString();
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(locale, options).format(since);
}
