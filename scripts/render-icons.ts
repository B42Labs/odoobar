import { Resvg } from '@resvg/resvg-js';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Renders every Lucide icon as a menu bar image: <name>.png for a standard
// display and <name>@2x.png for a Retina display. Electron loads both from
// the path of the first. "npm run build" runs this after tsc.

/** Repository root. This file runs from out/scripts/, two levels below it. */
const projectRoot = resolve(__dirname, '../..');
const source = join(projectRoot, 'node_modules/lucide-static');
const target = join(projectRoot, 'out/src/icons');

/** The edge of a menu bar image in points. */
const POINTS = 18;

mkdirSync(target, { recursive: true });
for (const file of readdirSync(join(source, 'icons'))) {
  if (!file.endsWith('.svg')) continue;
  const name = file.slice(0, -'.svg'.length);
  const svg = readFileSync(join(source, 'icons', file), 'utf8');
  for (const scale of [1, 2]) {
    let png: Buffer;
    try {
      // Lucide draws with currentColor, which is black here. macOS recolors a
      // template image, so only the alpha channel counts. The icons hold no
      // text, and loading the system fonts would take 50 ms per image.
      png = new Resvg(svg, {
        fitTo: { mode: 'width', value: POINTS * scale },
        font: { loadSystemFonts: false },
      })
        .render()
        .asPng();
    } catch (error) {
      throw new Error(`cannot render ${file}`, { cause: error });
    }
    writeFileSync(join(target, scale === 1 ? `${name}.png` : `${name}@${scale}x.png`), png);
  }
}
// The ISC license of Lucide asks for its notice in every copy.
copyFileSync(join(source, 'LICENSE'), join(target, 'LICENSE'));
