// Copies the browser builds of runtime libraries into public/vendor so the app needs no CDN.
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const FILES = [
  ['node_modules/pdfjs-dist/build/pdf.min.mjs', 'public/vendor/pdfjs/pdf.min.mjs'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/vendor/pdfjs/pdf.worker.min.mjs'],
  ['node_modules/exifr/dist/full.esm.mjs', 'public/vendor/exifr/full.esm.mjs'],
  ['node_modules/libphonenumber-js/bundle/libphonenumber-max.js', 'public/vendor/libphonenumber/libphonenumber-max.js'],
  ['node_modules/leaflet/dist/leaflet.js', 'public/vendor/leaflet/leaflet.js'],
  ['node_modules/leaflet/dist/leaflet.css', 'public/vendor/leaflet/leaflet.css'],
  ['node_modules/leaflet.markercluster/dist/leaflet.markercluster.js', 'public/vendor/leaflet/leaflet.markercluster.js'],
  ['node_modules/leaflet.markercluster/dist/MarkerCluster.css', 'public/vendor/leaflet/MarkerCluster.css'],
  ['node_modules/minisearch/dist/es/index.js', 'public/vendor/minisearch/index.js'],
  ['node_modules/diff/dist/diff.min.js', 'public/vendor/diff/diff.min.js'],
  // OCR: tesseract.js runs in a Web Worker; only the LSTM engine builds are shipped (smaller, better).
  ['node_modules/tesseract.js/dist/tesseract.esm.min.js', 'public/vendor/tesseract/tesseract.esm.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'public/vendor/tesseract/worker.min.js'],
  ...['', '-simd', '-relaxedsimd'].flatMap((v) => ['.wasm.js'].map((ext) => [`node_modules/tesseract.js-core/tesseract-core${v}-lstm${ext}`, `public/vendor/tesseract/core/tesseract-core${v}-lstm${ext}`])),
  // Compact integer models (tessdata "best_int"): English 3 MB, German 1.3 MB.
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'public/vendor/tesseract/lang/eng.traineddata.gz'],
  ['node_modules/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz', 'public/vendor/tesseract/lang/deu.traineddata.gz'],
];

if (!existsSync('node_modules')) {
  console.log('vendor: node_modules missing, skipping');
  process.exit(0);
}
for (const [from, to] of FILES) {
  if (!existsSync(from)) {
    console.error(`vendor: missing ${from}`);
    process.exitCode = 1;
    continue;
  }
  await mkdir(to.slice(0, to.lastIndexOf('/')), { recursive: true });
  await cp(from, to);
}
await cp('node_modules/leaflet/dist/images', 'public/vendor/leaflet/images', { recursive: true });
console.log(`vendor: copied ${FILES.length} files`);
