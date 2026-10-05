import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FALLBACK_ICON, isIconName } from '../../src/main/menu-bar';
import { projectRoot } from '../support/app-process';

const icons = join(projectRoot, 'out/src/icons');
const lucide = join(projectRoot, 'node_modules/lucide-static/icons');

test('the build renders every Lucide icon in two sizes, with the license of Lucide', () => {
  const names = readdirSync(lucide)
    .filter((file) => file.endsWith('.svg'))
    .map((file) => file.slice(0, -'.svg'.length));
  // An empty or missing source would otherwise pass with an empty output.
  assert.ok(names.length >= 2_000, `only ${names.length} icons in ${lucide}`);
  assert.deepEqual(names.filter((name) => !isIconName(name)), []);
  const expected = [...names.flatMap((name) => [`${name}.png`, `${name}@2x.png`]), 'LICENSE'];
  assert.deepEqual(readdirSync(icons).sort(), expected.sort());
  assert.ok(readFileSync(join(icons, 'LICENSE'), 'utf8').startsWith('ISC License\n'));
});

test('an icon is 18 pixels wide and high, 36 for a Retina display, with an alpha channel', () => {
  // The IHDR chunk follows the PNG signature: width and height as 32-bit
  // big-endian numbers, then the bit depth and the color type.
  const header = (file: string) => {
    const png = readFileSync(join(icons, file));
    return [png.readUInt32BE(16), png.readUInt32BE(20), png[25]];
  };
  for (const name of ['house', 'clock', 'message-circle', 'handshake', 'calendar', FALLBACK_ICON]) {
    // Color type 6 is RGBA.
    assert.deepEqual(header(`${name}.png`), [18, 18, 6], name);
    assert.deepEqual(header(`${name}@2x.png`), [36, 36, 6], `${name}@2x`);
  }
});
