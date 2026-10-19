import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, pathLength, formatDistance, parseCoordinates, toGeoJSON, fromGeoJSON, toCsv, fromCsvRows, uncertaintyRadius, inBounds } from '../public/src/geo/geo.js';
import { parseCsv } from '../public/src/docs/extract.js';

test('distances: Berlin Brandenburg Gate → Reichstag ≈ 275 m; path length adds up', () => {
  const gate = { lat: 52.5163, lon: 13.3777 };
  const reichstag = { lat: 52.5186, lon: 13.3762 };
  const d = haversine(gate, reichstag);
  assert.ok(d > 250 && d < 300, String(d));
  assert.ok(Math.abs(haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111195) < 10);
  assert.equal(Math.round(pathLength([gate, reichstag, gate])), Math.round(2 * d));
  assert.equal(formatDistance(812), '812 m');
  assert.equal(formatDistance(4321), '4.32 km');
});

test('coordinate formats: decimal, comma decimals, DMS with hemispheres', () => {
  assert.deepEqual(parseCoordinates('52.5163, 13.3777'), { lat: 52.5163, lon: 13.3777 });
  assert.deepEqual(parseCoordinates('52.5163 13.3777'), { lat: 52.5163, lon: 13.3777 });
  const dms = parseCoordinates(`52°30'58.7"N 13°22'39.7"E`);
  assert.ok(Math.abs(dms.lat - 52.51631) < 1e-4 && Math.abs(dms.lon - 13.37769) < 1e-4);
  const sw = parseCoordinates(`33°51'35.9"S 151°12'40.0"E`);
  assert.ok(sw.lat < 0 && sw.lon > 0);
  assert.equal(parseCoordinates('95.0, 10.0'), null);
  assert.equal(parseCoordinates('hello'), null);
});

test('GeoJSON round trip keeps longitude-first order and uncertainty', () => {
  const pts = [{ lat: 52.5, lon: 13.4, label: 'A', source: 'RIPEstat', precision: 'city' }];
  const gj = toGeoJSON(pts);
  assert.deepEqual(gj.features[0].geometry.coordinates, [13.4, 52.5]);
  assert.equal(gj.features[0].properties.uncertainty_m, uncertaintyRadius('city'));
  const back = fromGeoJSON(gj);
  assert.equal(back[0].lat, 52.5);
  assert.equal(back[0].precision, 'city');
  assert.equal(fromGeoJSON({ type: 'Point', coordinates: [200, 10] }).length, 0, 'invalid coordinates are dropped');
});

test('CSV import finds lat/lon or coordinate columns; export escapes', () => {
  const { rows } = parseCsv('Name;Breite;Länge;Datum\nTor;52,5163;13,3777;2024-05-01\nleer;;;\n');
  const r = fromCsvRows(rows);
  assert.deepEqual(r.points.map((p) => [p.label, p.lat, p.lon, p.date]), [['Tor', 52.5163, 13.3777, '2024-05-01']]);
  const r2 = fromCsvRows([['title', 'coordinates'], ['X', '52.1, 13.1'], ['Y', 'nonsense']]);
  assert.equal(r2.points.length, 1);
  assert.equal(r2.skipped, 1);
  assert.match(fromCsvRows([['a', 'b'], ['1', '2']]).error, /no lat\/lon/);
  assert.match(toCsv([{ lat: 1, lon: 2, label: 'a, "b"', source: 's' }]), /"a, ""b"""/);
});

test('bounding boxes, including across the antimeridian', () => {
  assert.ok(inBounds({ lat: 52, lon: 13 }, [50, 10, 55, 15]));
  assert.ok(!inBounds({ lat: 52, lon: 20 }, [50, 10, 55, 15]));
  assert.ok(inBounds({ lat: 0, lon: 179 }, [-10, 170, 10, -170]));
});

test('Overpass: named features near a point, nearest first, with OSM links (recorded response)', async () => {
  const { nearbyFeatures, overpassQuery } = await import('../public/src/sources/geo.js');
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(new URL('./fixtures/overpass-brandenburg-gate.json', import.meta.url), 'utf8'));
  const list = nearbyFeatures(data.elements, 52.5163, 13.3777);
  assert.ok(list.length > 5);
  assert.ok(list.every((f, i) => i === 0 || f.distance >= list[i - 1].distance), 'sorted by distance');
  assert.ok(list.every((f) => f.distance <= 200 && /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(f.osm)));
  assert.match(overpassQuery(52.5, 13.4), /around:150,52\.5,13\.4\)\[name\];out center tags 80;$/);
});

test('Photon reverse features: named only, OSM links, nearest first (recorded answer)', async () => {
  const { photonFeatures } = await import('../public/src/sources/geo.js');
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(new URL('./fixtures/photon-brandenburg-gate.json', import.meta.url), 'utf8'));
  const list = photonFeatures(data.features, 52.5163, 13.3777);
  assert.ok(list.length >= 10 && list.every((f) => f.name));
  const gate = list.find((f) => f.name === 'Brandenburger Tor');
  assert.equal(gate.osm, 'https://www.openstreetmap.org/way/518071791');
  assert.equal(gate.kind, 'tourism=attraction');
  assert.ok(list.every((f, i) => i === 0 || list[i - 1].distance <= f.distance));
});

test('nearby places: a failed Overpass starts the next at once, the first answer wins, the rest are cancelled', async () => {
  const { nearbyPlaces } = await import('../public/src/sources/geo.js');
  const aborted = [];
  const fetchJson = (url, { signal }) => {
    if (url.includes('overpass-api.de')) return Promise.reject(new Error('HTTP 502'));
    if (url.includes('private.coffee')) return new Promise((_, reject) => signal.addEventListener('abort', () => (aborted.push(url), reject(new Error('aborted')))));
    return Promise.resolve({ data: { features: [{ type: 'Feature', geometry: { coordinates: [13.3777, 52.5163] }, properties: { name: 'Gate', osm_type: 'W', osm_id: 1, osm_key: 'tourism', osm_value: 'attraction' } }] }, evidence: { url } });
  };
  const res = await nearbyPlaces(fetchJson, 52.5163, 13.3777, 150, { hedgeMs: 5 });
  assert.equal(res.via, 'photon.komoot.io');
  assert.equal(res.list[0].name, 'Gate');
  assert.deepEqual(res.tried.map((t) => t.host), ['overpass-api.de']);
  assert.equal(aborted.length, 1);
});

test('nearby places: Overpass answering first means Photon is never asked; all failing rejects with every host', async () => {
  const { nearbyPlaces } = await import('../public/src/sources/geo.js');
  const asked = [];
  const ok = (url) => (asked.push(url), Promise.resolve({ data: { elements: [{ type: 'node', id: 1, lat: 52.5163, lon: 13.3777, tags: { name: 'Gate', tourism: 'attraction' } }], osm3s: { timestamp_osm_base: '2026-10-19T08:00:00Z' } }, evidence: {} }));
  const res = await nearbyPlaces(ok, 52.5163, 13.3777, 150, { hedgeMs: 1000 });
  assert.equal(res.via, 'overpass-api.de');
  assert.equal(res.base, '2026-10-19');
  assert.equal(asked.length, 1);
  const busy = () => Promise.resolve({ data: { elements: [], remark: 'runtime error: Query run out of memory' }, evidence: {} });
  const fail = (url) => (url.includes('photon') ? Promise.reject(new Error('HTTP 503')) : busy());
  await assert.rejects(nearbyPlaces(fail, 52.5, 13.4, 150, { hedgeMs: 5 }), (err) => err.tried.length === 3 && /runtime error/.test(err.tried[0].error));
});
