import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceStatus,
  checkInClock,
  checkInTime,
  readAttendance,
  switchAttendance,
  type PostJson,
} from '../../src/main/attendance';

const B = 'https://odoo.example.com';
const CALL = { jsonrpc: '2.0', method: 'call', params: {} };

/** The answer of the state route for an employee, as Odoo 17 and later give it. `more` replaces fields. */
function employee(more: object = {}) {
  return {
    result: {
      id: 7,
      hours_today: 1.5,
      last_check_in: '2026-10-06 06:15:00',
      attendance_state: 'checked_in',
      display_systray: true,
      ...more,
    },
  };
}

/** A JSON-RPC error of Odoo for an exception it raised. */
function serverError(data: object, message = 'Odoo Server Error') {
  return { error: { code: 200, message, data } };
}

/** A postJson that records every call and answers with `answer`. */
function recording(answer: () => Promise<unknown>) {
  const calls: [string, unknown][] = [];
  const postJson: PostJson = (url, body) => {
    calls.push([url, body]);
    return answer();
  };
  return { postJson, calls };
}

test('attendanceStatus reads a checked-in employee with the time of the check-in', () => {
  assert.deepEqual(attendanceStatus(employee()), {
    kind: 'usable',
    checkedIn: true,
    since: Date.UTC(2026, 9, 6, 6, 15, 0),
  });
});

test('attendanceStatus gives no check-in time while checked out', () => {
  for (const last of ['2026-10-06 06:15:00', false]) {
    assert.deepEqual(
      attendanceStatus(employee({ attendance_state: 'checked_out', last_check_in: last })),
      { kind: 'usable', checkedIn: false, since: undefined },
      String(last),
    );
  }
});

test('attendanceStatus gives no check-in time for a check-in that Odoo does not name', () => {
  const { result } = employee();
  const { last_check_in: _, ...withoutTime } = result;
  for (const answer of [
    employee({ last_check_in: false }),
    { result: withoutTime },
    employee({ last_check_in: 'yesterday' }),
  ]) {
    const status = attendanceStatus(answer);
    assert.deepEqual(status, { kind: 'usable', checkedIn: true, since: undefined }, JSON.stringify(answer));
  }
});

test('attendanceStatus tells a user without an employee and a hidden check-in apart', () => {
  assert.deepEqual(attendanceStatus({ result: {} }), { kind: 'no-employee' });
  assert.deepEqual(attendanceStatus(employee({ attendance_state: 'unknown' })), { kind: 'no-employee' });
  const { display_systray: _, ...withoutSystray } = employee().result;
  for (const answer of [employee({ display_systray: false }), { result: withoutSystray }]) {
    assert.deepEqual(attendanceStatus(answer), { kind: 'systray-off' }, JSON.stringify(answer));
  }
});

test('attendanceStatus finds no attendance in an answer without the routes or without a result', () => {
  for (const answer of [undefined, null, 'text', [], {}, { error: { code: 404 } }, { result: 'yes' }]) {
    assert.deepEqual(attendanceStatus(answer), { kind: 'unavailable' }, JSON.stringify(answer));
  }
});

test('attendanceStatus reads an expired login', () => {
  assert.deepEqual(attendanceStatus({ error: { code: 100, message: 'Odoo Session Expired' } }), {
    kind: 'signed-out',
  });
});

test('attendanceStatus throws the text of Odoo for any other error', () => {
  assert.throws(() => attendanceStatus(serverError({ message: 'You are not an employee.' })), {
    message: 'You are not an employee.',
  });
  for (const data of [{}, { message: '' }, { message: 5 }]) {
    assert.throws(() => attendanceStatus(serverError(data, 'Access Denied')), { message: 'Access Denied' });
  }
  assert.throws(() => attendanceStatus({ error: { code: 200, message: '', data: { message: '' } } }), {
    message: 'Odoo Server Error',
  });
  assert.throws(() => attendanceStatus({ error: {} }), { message: 'Odoo Server Error' });
});

test('checkInTime reads the UTC time of Odoo and nothing else', () => {
  assert.equal(checkInTime('2026-10-06 06:15:00'), Date.UTC(2026, 9, 6, 6, 15, 0));
  assert.equal(checkInTime('2025-12-31 23:59:59'), Date.UTC(2025, 11, 31, 23, 59, 59));
  const others = [false, undefined, null, 1_760_000_000_000, '', 'yesterday', '2026-10-06T06:15:00', '2026-10-06 06:15'];
  for (const value of others) assert.equal(checkInTime(value), undefined, JSON.stringify(value));
});

test('readAttendance posts the JSON-RPC call to the state route and keeps a path prefix', async () => {
  const { postJson, calls } = recording(() => Promise.resolve(employee({ attendance_state: 'checked_out' })));
  assert.deepEqual(await readAttendance(B, postJson), { kind: 'usable', checkedIn: false, since: undefined });
  assert.deepEqual(calls, [[`${B}/hr_attendance/attendance_user_data`, CALL]]);

  calls.length = 0;
  await readAttendance(`${B}/prefix`, postJson);
  assert.deepEqual(calls, [[`${B}/prefix/hr_attendance/attendance_user_data`, CALL]]);
});

test('readAttendance passes the error of the request and of Odoo on', async () => {
  const failure = new TypeError('fetch failed');
  await assert.rejects(readAttendance(B, () => Promise.reject(failure)), (error) => error === failure);
  await assert.rejects(readAttendance(B, () => Promise.resolve(serverError({ message: 'Odoo is down.' }))), {
    message: 'Odoo is down.',
  });
});

test('switchAttendance posts to the toggle route and reports what Odoo answered', async () => {
  const answers: unknown[] = [{ result: {} }, undefined, { error: { code: 100, message: 'Odoo Session Expired' } }];
  const { postJson, calls } = recording(() => Promise.resolve(answers.shift()));
  assert.equal(await switchAttendance(B, postJson), 'done');
  assert.equal(await switchAttendance(B, postJson), 'no-answer');
  assert.equal(await switchAttendance(B, postJson), 'signed-out');
  const toggle = [`${B}/hr_attendance/systray_check_in_out`, CALL];
  assert.deepEqual(calls, [toggle, toggle, toggle]);
});

test('switchAttendance throws the text of Odoo for a refused change and passes the error of the request on', async () => {
  await assert.rejects(
    switchAttendance(B, () => Promise.resolve(serverError({ message: 'You cannot check in today.' }))),
    { message: 'You cannot check in today.' },
  );
  await assert.rejects(switchAttendance(B, () => Promise.resolve(serverError({}))), {
    message: 'Odoo Server Error',
  });
  const failure = new TypeError('fetch failed');
  await assert.rejects(switchAttendance(B, () => Promise.reject(failure)), (error) => error === failure);
});

test('checkInClock names the clock time on the day of now and adds the day otherwise', () => {
  const now = new Date(2026, 9, 6, 17, 0).getTime();
  const today = new Date(2026, 9, 6, 8, 15).getTime();
  const yesterday = new Date(2026, 9, 5, 8, 15).getTime();
  assert.match(checkInClock(today, now, 'de'), /^08:15$/);
  assert.match(checkInClock(today, now, 'en'), /^08:15\sAM$/u);
  assert.match(checkInClock(yesterday, now, 'de'), /5\. Okt.*08:15/);
  assert.match(checkInClock(yesterday, now, 'en'), /Oct 5.*08:15/);
  // Midnight starts another day.
  const late = new Date(2026, 9, 5, 23, 59).getTime();
  assert.match(checkInClock(late, new Date(2026, 9, 6, 0, 1).getTime(), 'en'), /Oct 5.*11:59/);
});
