import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fill, messagesFor, pickLocale } from '../../src/main/messages';

test('pickLocale picks German for German tags and English for all others', () => {
  for (const tag of ['de', 'de-DE', 'de_AT', 'DE-ch']) assert.equal(pickLocale(tag), 'de', tag);
  for (const tag of ['en-GB', 'en', 'fr', 'den', '']) assert.equal(pickLocale(tag), 'en', JSON.stringify(tag));
});

/** Every text with its key path, such as `firstStart.title`. */
function texts(value: object, prefix = ''): [string, unknown][] {
  return Object.entries(value).flatMap(([key, child]): [string, unknown][] =>
    typeof child === 'object' && child !== null ? texts(child, `${prefix}${key}.`) : [[`${prefix}${key}`, child]],
  );
}

test('German and English define the same messages', () => {
  const de = new Map(texts(messagesFor('de')));
  const en = new Map(texts(messagesFor('en')));
  assert.deepEqual([...de.keys()].sort(), [...en.keys()].sort());

  const placeholders = (text: unknown) => String(text).match(/\{\w+\}/g)?.sort() ?? [];
  for (const [path, german] of de) {
    const english = en.get(path);
    assert.ok(typeof german === 'string' && german !== '', `German ${path} is empty`);
    assert.ok(typeof english === 'string' && english !== '', `English ${path} is empty`);
    assert.deepEqual(placeholders(german), placeholders(english), `${path} uses other placeholders`);
  }

  assert.equal(messagesFor('de').seedApps.timesheets, 'Zeiterfassung');
  assert.equal(messagesFor('en').seedApps.timesheets, 'Timesheets');
});

test('fill replaces named placeholders and keeps unknown ones', () => {
  assert.equal(fill('{a} and {b} and {a}', { a: 'x' }), 'x and {b} and x');
  assert.equal(fill('{reason}', { reason: "$& and {reason} and $'" }), "$& and {reason} and $'");
});
