// Geospatial helpers, pure: distances, coordinate formats, accuracy, and import/export of points as GeoJSON
// and CSV. A point: { lat, lon, label, source, precision: 'exact'|'street'|'city'|'region'|'country', kind, date? }

const R = 6371008.8; // mean Earth radius, metres

export function haversine(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a path in metres. */
export const pathLength = (pts) => pts.slice(1).reduce((s, p, i) => s + haversine(pts[i], p), 0);

export function formatDistance(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
}

/** Radius that honestly represents a point's uncertainty, in metres (0 = drawn as an exact marker). */
export function uncertaintyRadius(precision) {
  return { exact: 0, street: 150, city: 6000, region: 50_000, country: 250_000 }[precision] ?? 0;
}

export const PRECISION_LABEL = { exact: 'Exact point as stated by the source', street: 'Street level (about 150 m)', city: 'City level (about 6 km): an estimate, not an address', region: 'Region level (about 50 km)', country: 'Country level only' };

const valid = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/**
 * Parse a coordinate string: "52.5163, 13.3777", "52.5163 13.3777", "52°30'58.7\"N 13°22'39.7\"E", "N 52 30.978 E 13 22.662".
 * @returns {{ lat: number, lon: number } | null}
 */
export function parseCoordinates(s) {
  const t = String(s || '').trim().replace(/,(?=\d)/g, '.').replace(/[′’']/g, "'").replace(/[″”"]/g, '"');
  const dec = /^(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(t.replace(/\.(?=\s)/, ''));
  if (dec) {
    const lat = Number(dec[1]);
    const lon = Number(dec[2]);
    return valid(lat, lon) ? { lat, lon } : null;
  }
  // Degrees, minutes, seconds with hemispheres (either side of the numbers)
  const part = /([NSEW])?\s*(\d{1,3})(?:°|\s)\s*(\d{1,2}(?:\.\d+)?)?(?:'|\s)?\s*(\d{1,2}(?:\.\d+)?)?"?\s*([NSEW])?/gi;
  const found = [...t.matchAll(part)].filter((m) => m[2] && (m[1] || m[5]));
  if (found.length === 2) {
    const toDec = (m) => {
      const hemi = (m[1] || m[5]).toUpperCase();
      const v = Number(m[2]) + Number(m[3] || 0) / 60 + Number(m[4] || 0) / 3600;
      return { hemi, v: hemi === 'S' || hemi === 'W' ? -v : v };
    };
    const [a, b] = found.map(toDec);
    const lat = ['N', 'S'].includes(a.hemi) ? a.v : b.v;
    const lon = ['E', 'W'].includes(b.hemi) ? b.v : a.v;
    return valid(lat, lon) ? { lat: Math.round(lat * 1e7) / 1e7, lon: Math.round(lon * 1e7) / 1e7 } : null;
  }
  return null;
}

/** Points → GeoJSON FeatureCollection (RFC 7946: longitude first). */
export function toGeoJSON(points) {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { label: p.label || '', source: p.source || '', precision: p.precision || 'exact', kind: p.kind || '', date: p.date || null, uncertainty_m: uncertaintyRadius(p.precision) },
    })),
  };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(points) {
  const rows = [['lat', 'lon', 'label', 'source', 'precision', 'uncertainty_m', 'kind', 'date']];
  for (const p of points) rows.push([p.lat, p.lon, p.label, p.source, p.precision || 'exact', uncertaintyRadius(p.precision), p.kind || '', p.date || '']);
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\n')}\n`;
}

/** GeoJSON → points (Point and MultiPoint) plus the raw object for drawing lines and polygons. */
export function fromGeoJSON(obj, source = 'Imported GeoJSON') {
  const out = [];
  const feats = obj?.type === 'FeatureCollection' ? obj.features || [] : obj?.type === 'Feature' ? [obj] : obj?.type ? [{ type: 'Feature', geometry: obj, properties: {} }] : [];
  for (const f of feats) {
    const g = f?.geometry;
    const props = f?.properties || {};
    const label = props.label || props.name || props.title || props.Name || '';
    const coords = g?.type === 'Point' ? [g.coordinates] : g?.type === 'MultiPoint' ? g.coordinates : [];
    for (const c of coords) {
      const [lon, lat] = (c || []).map(Number);
      if (valid(lat, lon)) out.push({ lat, lon, label: String(label), source, precision: props.precision || 'exact', kind: 'import', date: props.date || null, props });
    }
  }
  return out;
}

/** CSV rows (first row = header) → points. Finds lat/lon columns by name, or one "coordinates" column. */
export function fromCsvRows(rows, source = 'Imported CSV') {
  if (!rows.length) return { points: [], error: 'empty file' };
  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const find = (names) => head.findIndex((h) => names.includes(h));
  const iLat = find(['lat', 'latitude', 'breite', 'breitengrad', 'y']);
  const iLon = find(['lon', 'lng', 'long', 'longitude', 'länge', 'laenge', 'längengrad', 'x']);
  const iCoord = find(['coordinates', 'coords', 'koordinaten', 'location', 'position', 'latlon', 'lat,lon']);
  const iLabel = find(['label', 'name', 'title', 'bezeichnung', 'description', 'beschreibung']);
  const iDate = find(['date', 'datum', 'time', 'timestamp', 'zeit']);
  if ((iLat < 0 || iLon < 0) && iCoord < 0) return { points: [], error: 'no lat/lon or coordinates column found' };
  const points = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const c = iLat >= 0 && iLon >= 0 ? parseCoordinates(`${r[iLat]}, ${r[iLon]}`) : parseCoordinates(r[iCoord]);
    if (!c) {
      if (r.some((x) => String(x).trim())) skipped++;
      continue;
    }
    points.push({ ...c, label: iLabel >= 0 ? String(r[iLabel] ?? '') : '', source, precision: 'exact', kind: 'import', date: iDate >= 0 ? r[iDate] || null : null });
  }
  return { points, skipped };
}

/** Points that sit inside a bounding box [south, west, north, east]. */
export const inBounds = (p, [s, w, n, e]) => p.lat >= s && p.lat <= n && (w <= e ? p.lon >= w && p.lon <= e : p.lon >= w || p.lon <= e);
