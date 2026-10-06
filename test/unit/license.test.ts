import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from '../support/app-process';

/** The empty line, the line of hyphens, and the empty line between the parameters and the license text. */
const SEPARATOR = `\n${'-'.repeat(77)}\n\n`;

/** Lines 1 to 19 of LICENSE: the parameters of OdooBar and the notice. */
const HEADER = `${[
  'Business Source License 1.1',
  '',
  'Parameters',
  '',
  'Licensor:             B42 Labs',
  'Licensed Work:        OdooBar. The Licensed Work is (c) 2026 B42 Labs.',
  'Additional Use Grant: You may make production use of the Licensed Work,',
  '                      provided Your use does not include selling the Licensed',
  '                      Work or a derivative work of it, or offering either to',
  '                      third parties for a fee.',
  'Change Date:          One year from the date the respective version of the',
  '                      Licensed Work is published.',
  'Change License:       Apache License, Version 2.0',
  '',
  'Notice',
  '',
  'The Business Source License (this document, or the "License") is not an Open',
  'Source license. However, the Licensed Work will eventually be made available',
  'under an Open Source License, as stated in this License.',
].join('\n')}\n`;

/**
 * The SHA-256 of the Business Source License 1.1 as SPDX publishes it.
 * Covenant 4 of the license forbids any change to it.
 */
const TERMS_SHA256 = 'd90560217049db1d6020ec7cf482da4198bfa372dffd22270ba08fd8088cd93b';

/**
 * The header and the license text of LICENSE. Each test reads the file
 * itself, so a missing file fails only these tests.
 */
function licenseParts(): [header: string, terms: string] {
  const parts = readFileSync(join(projectRoot, 'LICENSE'), 'utf8').split(SEPARATOR);
  const [header, terms] = parts;
  assert.ok(parts.length === 2 && header !== undefined && terms !== undefined, 'LICENSE has no separator line');
  return [header, terms];
}

test('LICENSE carries the parameters of OdooBar', () => {
  const [header] = licenseParts();
  assert.equal(header, HEADER);
});

test('LICENSE keeps the text of the Business Source License 1.1 unchanged', () => {
  const [, terms] = licenseParts();
  assert.equal(createHash('sha256').update(terms).digest('hex'), TERMS_SHA256);
});

test('package.json names the licensor and the license', () => {
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
    author: unknown;
    license: unknown;
  };
  assert.equal(manifest.author, 'B42 Labs');
  assert.equal(manifest.license, 'BUSL-1.1');
});
