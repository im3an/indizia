// Renders the app icon (build/icon.png, 1024 px) from public/favicon.svg. electron-builder derives the
// macOS .icns and Windows .ico from it. Needs sharp, which the root project already has via wrangler.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../package.json', import.meta.url));
const sharp = require('sharp');
const svg = readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8')
  // A little inset so the rounded square sits like other macOS icons.
  .replace('viewBox="0 0 32 32"', 'viewBox="-3 -3 38 38"');
await sharp(Buffer.from(svg), { density: 2400 }).resize(1024, 1024).png().toFile(new URL('../build/icon.png', import.meta.url).pathname);
console.log('build/icon.png written');
