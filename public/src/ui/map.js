// Geospatial workspace: every point Indizia found (input coordinates, places, IP estimates, photo GPS,
// document coordinates, imported data) on Leaflet. Base layers: OpenStreetMap, OpenTopoMap terrain and
// Sentinel-2 cloudless yearly composites (2016–2025) with a year-against-year comparison. Exact points are
// clustered; approximate ones are drawn as uncertainty circles, never as pins. Tools: measure, nearby OSM
// features (Overpass, Photon when it is busy), import GeoJSON/CSV, export GeoJSON/CSV.
import { loadScript, loadStyle } from '../loader.js';
import { formatDistance, pathLength, uncertaintyRadius, PRECISION_LABEL, toGeoJSON, toCsv, fromGeoJSON, fromCsvRows } from '../geo/geo.js';
import { parseCsv } from '../docs/extract.js';
import { nearbyPlaces } from '../sources/geo.js';
import { fetchJson } from '../http.js';
import { download } from '../report.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const YEARS = [2016, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const s2 = (y) => `https://tiles.maps.eox.at/wmts/1.0.0/${y === 2016 ? 's2cloudless_3857' : `s2cloudless-${y}_3857`}/default/g/{z}/{y}/{x}.jpg`;
const S2_ATTR = (y) => `<a href="https://s2maps.eu" target="_blank" rel="noopener noreferrer">Sentinel-2 cloudless ${y}</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data ${y}; ${y === 2016 ? 'CC BY 4.0' : 'CC BY-NC-SA 4.0'})`;
const KIND = { input: ['Your input', '#1D4FB8'], ip: ['IP estimate', '#946000'], file: ['Photo / file', '#64748B'], osm: ['OpenStreetMap feature', '#0F9488'], import: ['Imported', '#7C4DCC'], doc: ['Document', '#8C6D46'], org: ['Organisation', '#7C4DCC'], '': ['Other', '#6A737B'] };

async function leaflet() {
  await loadStyle('/vendor/leaflet/leaflet.css');
  await loadStyle('/vendor/leaflet/MarkerCluster.css');
  await loadScript('/vendor/leaflet/leaflet.js');
  await loadScript('/vendor/leaflet/leaflet.markercluster.js');
  return window.L;
}

function dot(L, color) {
  return L.divIcon({ className: 'geo-pin', html: `<span style="--c:${color}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -8] });
}

function popupHtml(p) {
  const prec = p.precision || 'exact';
  return `<div class="geo-pop"><strong>${esc(p.label || 'Point')}</strong>
    <dl><dt>Source</dt><dd>${esc(p.source || '—')}</dd><dt>Accuracy</dt><dd>${esc(PRECISION_LABEL[prec] || prec)}</dd><dt>Coordinates</dt><dd class="mono">${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</dd>${p.date ? `<dt>Date</dt><dd>${esc(String(p.date).slice(0, 19))}</dd>` : ''}</dl>
    <div class="geo-pop-act"><button type="button" class="linkish" data-nearby="${p.lat},${p.lon}">What's nearby (OSM)</button> · <a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=17/${p.lat}/${p.lon}" target="_blank" rel="noopener noreferrer">OpenStreetMap ↗</a>${p.query !== false ? ` · <button type="button" class="linkish" data-search="${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}">Investigate</button>` : ''}</div></div>`;
}

/**
 * @param {HTMLElement} container
 * @param {object[]} points
 * @param {{ navigate?: (q: string) => void, title?: string, note?: string }} [opts]
 */
export async function renderMap(container, points, opts = {}) {
  const L = await leaflet();
  let st = container._geo;
  if (!st || !container.contains(st.map.getContainer())) {
    container.innerHTML = `<section class="vcard">
      <div class="vcard-bar geo-tools" role="toolbar" aria-label="Map tools">
        <button type="button" class="btn" data-g="measure" aria-pressed="false">Measure</button>
        <label class="btn geo-file">Import GeoJSON / CSV<input type="file" accept=".geojson,.json,.csv,.tsv,.txt" hidden></label>
        <button type="button" class="btn" data-g="geojson">Export GeoJSON</button>
        <button type="button" class="btn" data-g="csv">Export CSV</button>
        <span class="geo-compare"><label>Imagery <select data-g="ya"><option value="">off</option>${YEARS.map((y) => `<option>${y}</option>`).join('')}</select></label>
          <label>compare <select data-g="yb"><option value="">—</option>${YEARS.map((y) => `<option>${y}</option>`).join('')}</select></label>
          <input type="range" min="0" max="100" value="50" data-g="op" aria-label="Opacity of the comparison year" style="--fill:50%" disabled></span>
      </div>
      <div class="map" id="map-canvas"></div>
      <div class="vcard-foot"><div class="geo-status" aria-live="polite"></div><p class="geo-msg" aria-live="polite"></p>
      <p class="map-note">Map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors · terrain © <a href="https://opentopomap.org" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (CC-BY-SA) · imagery: yearly cloud-free Sentinel-2 composites (10 m), not a capture of a specific day. Circles mark approximate positions (estimates), pins mark points stated exactly by a source.</p></div>
    </section>`;
    const map = L.map(container.querySelector('#map-canvas'), { zoomControl: true, attributionControl: true, worldCopyJump: true });
    // OSM's tile policy rejects referrer-less requests; tiles alone send the bare origin, never the path.
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', referrerPolicy: 'origin' });
    const topo = L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)', referrerPolicy: 'origin' });
    const bases = { OpenStreetMap: osm, 'Terrain (OpenTopoMap)': topo };
    for (const y of [...YEARS].reverse()) bases[`Satellite ${y} (Sentinel-2)`] = L.tileLayer(s2(y), { maxZoom: 17, maxNativeZoom: 15, attribution: S2_ATTR(y), referrerPolicy: 'origin' });
    osm.addTo(map);
    const groups = { points: L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 44, spiderfyOnMaxZoom: true }), approx: L.layerGroup(), nearby: L.layerGroup(), imported: L.layerGroup(), measure: L.layerGroup() };
    Object.values(groups).forEach((g) => g.addTo(map));
    L.control.layers(bases, { 'Exact points': groups.points, 'Approximate (circles)': groups.approx, 'Nearby OSM features': groups.nearby, Imported: groups.imported }, { collapsed: true }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    st = container._geo = { map, groups, bases, points: [], imported: [], compare: null, measuring: null };
    wire(L, container, st, opts);
  }
  st.points = points;
  draw(L, container, st);
  setTimeout(() => st.map.invalidateSize(), 50);
}

function draw(L, container, st) {
  const { groups, map } = st;
  groups.points.clearLayers();
  groups.approx.clearLayers();
  const bounds = [];
  const all = [...st.points, ...st.imported];
  for (const p of all) {
    const color = (KIND[p.kind] || KIND[''])[1];
    const r = uncertaintyRadius(p.precision);
    const html = popupHtml(p);
    if (r) {
      L.circle([p.lat, p.lon], { radius: r, color, weight: 1.5, fillOpacity: 0.1, dashArray: '4 4' }).bindPopup(html).addTo(groups.approx);
      L.circleMarker([p.lat, p.lon], { radius: 3, color, weight: 1, fillOpacity: 0.9 }).bindPopup(html).addTo(groups.approx);
    } else {
      L.marker([p.lat, p.lon], { icon: dot(L, color), title: p.label || '' }).bindPopup(html).addTo(p.kind === 'import' ? groups.imported : groups.points);
    }
    bounds.push([p.lat, p.lon]);
  }
  if (bounds.length === 1) map.setView(bounds[0], uncertaintyRadius(all[0].precision) > 1000 ? 9 : 16);
  else if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  else map.setView([50, 10], 4);
  const approx = all.filter((p) => uncertaintyRadius(p.precision)).length;
  const kinds = [...new Set(all.map((p) => p.kind || ''))];
  container.querySelector('.geo-status').innerHTML = `<b>${all.length}</b> point${all.length === 1 ? '' : 's'}${approx ? ` · ${approx} approximate` : ''} ${kinds.map((k) => `<span class="geo-key"><i style="--c:${(KIND[k] || KIND[''])[1]}"></i>${esc((KIND[k] || KIND[''])[0])}</span>`).join('')}`;
}

function wire(L, container, st, opts) {
  const { map } = st;
  const status = (t) => (container.querySelector('.geo-msg').textContent = t);
  // Popup buttons: nearby features and new search.
  map.on('popupopen', (ev) => {
    const node = ev.popup.getElement();
    node.querySelector('[data-search]')?.addEventListener('click', (e) => opts.navigate?.(e.currentTarget.dataset.search));
    node.querySelector('[data-nearby]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const [lat, lon] = btn.dataset.nearby.split(',').map(Number);
      btn.textContent = 'Asking OpenStreetMap…';
      btn.disabled = true;
      try {
        const { list, via } = await nearbyPlaces(fetchJson, lat, lon, 200);
        st.groups.nearby.clearLayers();
        for (const f of list.slice(0, 80)) {
          L.circleMarker([f.lat, f.lon], { radius: 5, color: KIND.osm[1], weight: 2, fillOpacity: 0.6 })
            .bindPopup(popupHtml({ lat: f.lat, lon: f.lon, label: `${f.name} (${f.kind}, ${f.distance} m)`, source: `OpenStreetMap via ${via === 'photon.komoot.io' ? 'Photon' : 'Overpass'}`, precision: 'exact', kind: 'osm' }))
            .addTo(st.groups.nearby);
        }
        btn.textContent = list.length ? `${list.length} named features within 200 m (teal)` : 'Nothing named within 200 m';
      } catch (err) {
        btn.textContent = `OpenStreetMap did not answer (${(err.tried || []).map((t) => t.host).join(', ') || err.message})`;
      }
    });
  });

  // Measure: click to add points, double-click or Esc to finish.
  const mBtn = container.querySelector('[data-g="measure"]');
  const stopMeasure = () => {
    st.measuring = null;
    mBtn.setAttribute('aria-pressed', 'false');
    map.getContainer().style.cursor = '';
    map.doubleClickZoom.enable();
  };
  mBtn.addEventListener('click', () => {
    if (st.measuring) return stopMeasure();
    st.groups.measure.clearLayers();
    st.measuring = { pts: [], line: L.polyline([], { color: '#B0362D', weight: 3, dashArray: '6 6' }).addTo(st.groups.measure), label: null };
    mBtn.setAttribute('aria-pressed', 'true');
    map.getContainer().style.cursor = 'crosshair';
    map.doubleClickZoom.disable();
  });
  map.on('click', (ev) => {
    const m = st.measuring;
    if (!m) return;
    m.pts.push({ lat: ev.latlng.lat, lon: ev.latlng.lng });
    m.line.setLatLngs(m.pts.map((p) => [p.lat, p.lon]));
    L.circleMarker(ev.latlng, { radius: 4, color: '#B0362D', fillOpacity: 1 }).addTo(st.groups.measure);
    const d = formatDistance(pathLength(m.pts));
    m.label?.remove();
    m.label = L.tooltip({ permanent: true, direction: 'right', className: 'geo-measure' }).setLatLng(ev.latlng).setContent(m.pts.length > 1 ? d : 'Click the next point').addTo(st.groups.measure);
    mBtn.textContent = m.pts.length > 1 ? `Measure: ${d} (double-click to finish)` : 'Measure';
  });
  map.on('dblclick', () => st.measuring && (stopMeasure(), (mBtn.textContent = 'Measure')));
  container.addEventListener('keydown', (ev) => ev.key === 'Escape' && st.measuring && (stopMeasure(), (mBtn.textContent = 'Measure')));

  // Import
  container.querySelector('.geo-file input').addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const text = await f.text();
    let pts = [];
    let msg = '';
    if (/\.(geo)?json$/i.test(f.name) || /^\s*[{[]/.test(text)) {
      try {
        const obj = JSON.parse(text);
        pts = fromGeoJSON(obj, `Imported: ${f.name}`);
        // Lines and polygons are drawn as they are; points become workspace points.
        L.geoJSON(obj, { filter: (feat) => !/Point/.test(feat.geometry?.type || ''), style: { color: KIND.import[1], weight: 2, fillOpacity: 0.08 } }).addTo(st.groups.imported);
      } catch {
        msg = 'Not valid GeoJSON';
      }
    } else {
      const r = fromCsvRows(parseCsv(text).rows, `Imported: ${f.name}`);
      pts = r.points;
      msg = r.error || (r.skipped ? `${r.skipped} row(s) without valid coordinates skipped` : '');
    }
    st.imported.push(...pts);
    draw(L, container, st);
    container.querySelector('.geo-status').insertAdjacentHTML('beforeend', ` · imported ${pts.length} from ${esc(f.name)}${msg ? ` (${esc(msg)})` : ''}`);
  });

  const all = () => [...st.points, ...st.imported].map(({ props, ...p }) => p);
  container.querySelector('[data-g="geojson"]').addEventListener('click', () => download(`indizia-points-${new Date().toISOString().slice(0, 10)}.geojson`, JSON.stringify(toGeoJSON(all()), null, 1)));
  container.querySelector('[data-g="csv"]').addEventListener('click', () => download(`indizia-points-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(all())));

  // Imagery by year, and a second year on top with an opacity slider.
  const ya = container.querySelector('[data-g="ya"]');
  const yb = container.querySelector('[data-g="yb"]');
  const op = container.querySelector('[data-g="op"]');
  const setBase = () => {
    const y = Number(ya.value);
    const want = y ? st.bases[`Satellite ${y} (Sentinel-2)`] : st.bases.OpenStreetMap;
    for (const layer of Object.values(st.bases)) if (layer !== want && map.hasLayer(layer)) map.removeLayer(layer);
    if (!map.hasLayer(want)) want.addTo(map);
  };
  const setCompare = () => {
    st.compare?.remove();
    st.compare = null;
    const y = Number(yb.value);
    op.disabled = !y;
    if (!y) return;
    st.compare = L.tileLayer(s2(y), { maxZoom: 17, maxNativeZoom: 15, attribution: S2_ATTR(y), opacity: Number(op.value) / 100, referrerPolicy: 'origin', zIndex: 5 }).addTo(map);
    status(`Comparing Sentinel-2 ${ya.value || 'map'} with ${y}: move the slider`);
  };
  ya.addEventListener('change', () => {
    setBase();
    if (ya.value && !yb.value) yb.value = String(Math.min(2025, Number(ya.value) + (ya.value === '2016' ? 2 : 1)));
    setCompare();
  });
  yb.addEventListener('change', setCompare);
  op.addEventListener('input', () => st.compare?.setOpacity(Number(op.value) / 100));
  map.on('baselayerchange', (ev) => {
    const m = /Satellite (\d{4})/.exec(ev.name);
    ya.value = m ? m[1] : '';
  });
}
