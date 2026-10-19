// Places: reverse geocoding for coordinates, approximate IP location.

let lastNominatim = 0;
/** Nominatim policy: at most one request per second for the whole application. */
async function nominatimSlot() {
  const wait = lastNominatim + 1100 - Date.now();
  lastNominatim = Math.max(Date.now(), lastNominatim + 1100);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export const nominatim = {
  id: 'nominatim',
  name: 'OpenStreetMap Nominatim',
  provider: 'OpenStreetMap Foundation',
  homepage: 'https://nominatim.org/release-docs/latest/api/Reverse/',
  terms: 'https://operations.osmfoundation.org/policies/nominatim/',
  licence: 'ODbL 1.0 (© OpenStreetMap contributors); max 1 request/second',
  category: 'Places',
  accepts: ['coordinates'],
  cors: true,

  async run(ctx) {
    const [lat, lon] = ctx.entity.value.split(/,\s*/).map(Number);
    ctx.geo({ lat, lon, label: ctx.entity.value, precision: 'exact', kind: 'input' });
    await nominatimSlot();
    const { data, evidence } = await ctx.fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=18&accept-language=en`);
    if (data.error) {
      ctx.note('No mapped place at these coordinates (e.g. open water)');
      return;
    }
    const a = data.address || {};
    const place = [a.road && `${a.road}${a.house_number ? ' ' + a.house_number : ''}`, a.city || a.town || a.village || a.municipality, a.country].filter(Boolean).join(', ');
    const osmUrl = `https://www.openstreetmap.org/${data.osm_type}/${data.osm_id}`;
    ctx.fact('Place', { label: 'Nearest feature', value: data.name || data.display_name.split(',')[0], evidence, href: osmUrl });
    ctx.fact('Place', { label: 'Address', value: place || data.display_name, evidence });
    ctx.fact('Place', { label: 'Feature type', value: `${data.category} · ${data.type}`, evidence });
    ctx.finding({
      title: `${data.name ? `${data.name}, ` : ''}${place || data.display_name}`,
      detail: 'Reverse-geocoded from OpenStreetMap. The nearest mapped feature, not necessarily what is at the exact point.',
      confidence: 'confirmed',
      evidence,
      href: osmUrl,
    });
  },
};

export const ipGeo = {
  id: 'ripestat-geo',
  name: 'RIPEstat geolocation',
  provider: 'RIPE NCC (MaxMind GeoLite data)',
  homepage: 'https://stat.ripe.net/docs/data_api#maxmind-geo-lite',
  terms: 'https://www.ripe.net/about-us/legal/ripestat-service-terms-and-conditions/',
  licence: 'City-level estimate. Never an address or a household',
  category: 'IP & network',
  accepts: ['ip'],
  cors: true,

  async run(ctx) {
    const { data, evidence } = await ctx.fetch(`https://stat.ripe.net/data/maxmind-geo-lite/data.json?resource=${encodeURIComponent(ctx.entity.value)}&sourceapp=indizia`);
    const loc = data.data?.located_resources?.[0]?.locations?.[0];
    if (!loc) {
      ctx.note('No geolocation estimate');
      return;
    }
    const clean = (v) => (v && v !== '?' ? v : null);
    const where = [clean(loc.city), clean(loc.country)].filter(Boolean).join(', ');
    if (!where) {
      ctx.note('No usable location: often the case for anycast and cloud addresses');
      return;
    }
    ctx.fact('Network', { label: 'Approx. location', value: `${where || 'unknown'} (${Math.round(loc.covered_percentage ?? 0)}% of prefix)`, evidence });
    if (loc.latitude != null) ctx.geo({ lat: loc.latitude, lon: loc.longitude, label: `${ctx.entity.value} · ${where}`, precision: 'city', kind: 'ip' });
    ctx.finding({ title: `${ctx.entity.value} geolocates to ${where || 'an unknown place'}`, detail: 'Database estimate at city level at best. Hosting and VPN addresses are often wrong.', confidence: 'plausible', evidence });
  },
};

// Named features around a point, from OpenStreetMap. Places, not people: buildings, offices, shops, landmarks,
// infrastructure. Overpass gives the richest answer (operators, websites) but its public instances are often at
// capacity (HTTP 406/429/502/504), so they are asked staggered and Photon (komoot), a fast OSM geocoder, answers
// when neither does. maps.mail.ru was dropped as a mirror: it would send investigated coordinates to VK.
// A form POST keeps the Overpass request "simple" (no CORS preflight).
export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
export const PHOTON = 'https://photon.komoot.io/reverse';
/** How long one attempt runs before the next one starts alongside it. A failed attempt starts the next at once. */
export const HEDGE_MS = 4000;
const KEYS = ['amenity', 'office', 'shop', 'tourism', 'historic', 'man_made', 'building', 'landuse', 'leisure', 'craft', 'industrial', 'government', 'public_transport', 'railway', 'aeroway', 'power', 'telecom', 'military'];
const OSM_TYPE = { N: 'node', W: 'way', R: 'relation' };

const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => 2 * 6371008.8 * Math.asin(Math.sqrt(Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2));

export function overpassQuery(lat, lon, radius = 150) {
  return `[out:json][timeout:20];nwr(around:${radius},${lat},${lon})[name];out center tags 80;`;
}

/** Overpass elements → { name, kind, lat, lon, osm, distance } sorted by distance. */
export function nearbyFeatures(elements, lat, lon) {
  return (elements || [])
    .map((e) => {
      const p = e.type === 'node' ? { lat: e.lat, lon: e.lon } : e.center ? { lat: e.center.lat, lon: e.center.lon } : null;
      if (!p || !e.tags?.name) return null;
      const k = KEYS.find((key) => e.tags[key]);
      return { name: e.tags.name, kind: k ? `${k}=${e.tags[k]}` : Object.keys(e.tags).find((t) => t !== 'name') || 'feature', ...p, osm: `https://www.openstreetmap.org/${e.type}/${e.id}`, website: e.tags.website || e.tags['contact:website'] || null, operator: e.tags.operator || null, distance: Math.round(dist({ lat, lon }, p)) };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
}

/** Photon GeoJSON features → the same shape as nearbyFeatures. Photon carries no operator or website tags. */
export function photonFeatures(features, lat, lon) {
  return (features || [])
    .map((f) => {
      const p = f.properties || {};
      const [fLon, fLat] = f.geometry?.coordinates || [];
      if (!p.name || fLat == null || !OSM_TYPE[p.osm_type]) return null;
      return { name: p.name, kind: `${p.osm_key}=${p.osm_value}`, lat: fLat, lon: fLon, osm: `https://www.openstreetmap.org/${OSM_TYPE[p.osm_type]}/${p.osm_id}`, website: null, operator: null, distance: Math.round(dist({ lat, lon }, { lat: fLat, lon: fLon })) };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Named OSM features within `radius` metres. Overpass instances and then Photon are started staggered (hedged);
 * the first usable answer wins and the others are cancelled.
 * @param {(url: string, opts: object) => Promise<{data: any, evidence: any}>} fetchJson  http.js fetchJson or ctx.fetch
 * @returns {Promise<{list, data, evidence, via: string, base: string|null, tried: {host: string, error: string}[]}>}
 *   Rejects with the last error, carrying `tried`, when nothing answered.
 */
export function nearbyPlaces(fetchJson, lat, lon, radius = 150, { hedgeMs = HEDGE_MS, signal } = {}) {
  const overpass = (url) => async (s) => {
    const { data, evidence } = await fetchJson(url, { method: 'POST', form: { data: overpassQuery(lat, lon, radius) }, timeout: 30000, signal: s });
    // Overpass reports overload inside a 200 answer as a "runtime error" remark.
    if (!Array.isArray(data?.elements) || /runtime error/i.test(data.remark || '')) throw new Error(data?.remark || 'Unexpected answer');
    return { list: nearbyFeatures(data.elements, lat, lon), data, evidence, base: data.osm3s?.timestamp_osm_base?.slice(0, 10) || null };
  };
  const photon = async (s) => {
    const { data, evidence } = await fetchJson(`${PHOTON}?lat=${lat}&lon=${lon}&radius=${radius / 1000}&limit=50`, { timeout: 15000, signal: s });
    if (!Array.isArray(data?.features)) throw new Error('Unexpected answer');
    return { list: photonFeatures(data.features, lat, lon).filter((f) => f.distance <= radius), data, evidence, base: null };
  };
  const attempts = [...OVERPASS.map((url) => ({ host: new URL(url).hostname, run: overpass(url) })), { host: new URL(PHOTON).hostname, run: photon }];

  const ctrl = new AbortController();
  signal?.addEventListener('abort', () => ctrl.abort(signal.reason));
  const tried = [];
  const timers = [];
  return new Promise((resolve, reject) => {
    let started = 0;
    let settled = false;
    const finish = () => {
      settled = true;
      timers.forEach(clearTimeout);
    };
    const start = () => {
      if (settled || started >= attempts.length) return;
      const a = attempts[started++];
      a.run(ctrl.signal).then(
        (r) => {
          if (settled) return;
          finish();
          ctrl.abort();
          resolve({ ...r, via: a.host, tried });
        },
        (err) => {
          if (settled) return;
          tried.push({ host: a.host, error: err.message });
          if (tried.length === attempts.length) {
            finish();
            reject(Object.assign(err, { tried }));
          } else if (tried.length === started) start(); // everything running has failed: do not wait for the timer
        },
      );
    };
    start();
    for (let i = 1; i < attempts.length; i++) timers.push(setTimeout(start, hedgeMs * i));
  });
}

export const overpassNearby = {
  id: 'overpass',
  name: 'Nearby features (OpenStreetMap)',
  provider: 'Overpass API (overpass-api.de, fallback private.coffee), then Photon by komoot · OpenStreetMap data',
  homepage: 'https://wiki.openstreetmap.org/wiki/Overpass_API',
  terms: 'https://dev.overpass-api.de/overpass-doc/en/preface/commons.html',
  licence: 'ODbL 1.0 (© OpenStreetMap contributors); public instances, fair use',
  category: 'Places',
  accepts: ['coordinates'],
  cors: true,

  async run(ctx) {
    const [lat, lon] = ctx.entity.value.split(/,\s*/).map(Number);
    ctx.progress('Asking Overpass, then Photon if it is busy');
    let res;
    try {
      res = await nearbyPlaces(ctx.fetch, lat, lon, 150, { signal: ctx.signal });
    } catch (err) {
      for (const t of err.tried || []) ctx.note(`${t.host}: ${t.error}`);
      throw err;
    } finally {
      ctx.progress('');
    }
    for (const t of res.tried) ctx.note(`${t.host}: ${t.error}`);
    const { list, evidence, via, base } = res;
    if (!list.length) return ctx.note('No named OpenStreetMap features within 150 m');
    ctx.fact('Place', { label: 'Named features within 150 m', value: String(list.length), evidence });
    for (const f of list.slice(0, 25)) ctx.geo({ lat: f.lat, lon: f.lon, label: `${f.name} (${f.kind})`, precision: 'exact', kind: 'osm' });
    const operators = [...new Set(list.map((f) => f.operator).filter(Boolean))];
    const from = via === 'photon.komoot.io' ? 'From OpenStreetMap via Photon (Overpass was busy, so operators and websites are missing)' : `From OpenStreetMap as of ${base || 'today'}`;
    ctx.finding({
      title: `${list.length} named places within 150 m, nearest: ${list[0].name} (${list[0].distance} m)`,
      detail: `${from}. Mapped by volunteers: check against imagery or on site.${operators.length ? ` Operators named: ${operators.slice(0, 5).join(', ')}.` : ''}`,
      confidence: 'confirmed',
      confidenceNote: 'What OpenStreetMap records at this place, not what is there today',
      evidence,
      list: list.slice(0, 60).map((f) => `${f.distance} m  ${f.name}  ·  ${f.kind}${f.operator ? `  ·  operator ${f.operator}` : ''}`),
      listLabel: `${Math.min(list.length, 60)} features, nearest first`,
      pivots: list.map((f) => f.website).filter(Boolean).slice(0, 3).map((w) => {
        try {
          return { type: 'domain', value: new URL(w).hostname.replace(/^www\./, '') };
        } catch {
          return null;
        }
      }).filter(Boolean),
    });
  },
};
