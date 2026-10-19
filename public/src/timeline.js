// Timeline of findings (dated facts from sources) and changes (what the analyst did, what re-runs found).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Normalise "2019", "2019-04", ISO stamps and crt.sh-style "2019-04-01T00:00:00" to a sortable ISO-ish string. */
function norm(d) {
  if (!d) return null;
  const s = String(d).trim();
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * @param {object[]} snapshots investigation snapshots
 * @param {object[]} activity case audit trail ({ at, kind, text })
 */
export function buildTimeline(snapshots, activity = []) {
  const out = [];
  const seen = new Set();
  const push = (e) => {
    const date = norm(e.date);
    if (!date || date > '2100') return;
    const k = `${date.slice(0, 10)}|${e.title}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ ...e, date });
  };
  for (const s of snapshots) {
    const q = s.root?.value;
    for (const f of s.findings || []) {
      if (f.crossCheck) continue;
      if (f.date) push({ kind: 'event', date: f.date, title: f.title, source: f.source, query: q, confidence: f.confidence });
      for (const ev of f.events || []) push({ kind: 'event', date: ev.date, title: ev.title, source: f.source, query: q, confidence: f.confidence });
    }
    for (const [group, facts] of Object.entries(s.facts || {})) {
      for (const x of facts) if (x.date) push({ kind: 'event', date: x.date, title: `${x.label}: ${x.value}`, source: x.sources?.join(', '), query: q, group, confidence: x.confidence });
    }
  }
  for (const a of activity) push({ kind: 'activity', date: a.at, title: a.text, source: 'Case log' });
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

const fmt = (d) => {
  const day = d.slice(0, 10);
  return d.length > 10 && d.includes('T') ? `${day} ${d.slice(11, 16)}` : day;
};

export function timelineHtml(items, { multi = false, filter = 'all' } = {}) {
  const list = items.filter((e) => filter === 'all' || e.kind === filter);
  if (!list.length) return '<p class="empty-note">No dated events yet. Registration dates, first certificates, archive captures, DNS history and scans appear here.</p>';
  let year = '';
  let html = '<ol class="timeline">';
  for (const e of list) {
    const y = e.date.slice(0, 4);
    if (y !== year) {
      year = y;
      html += `<li class="tl-year" aria-hidden="true">${esc(y)}</li>`;
    }
    html += `<li class="tl-item ${e.kind}">
      <time datetime="${esc(e.date)}">${esc(fmt(e.date))}</time>
      <span class="tl-dot ${esc(e.confidence || '')}"></span>
      <div><p>${esc(e.title)}</p><small>${esc(e.source || '')}${multi && e.query ? ` · ${esc(e.query)}` : ''}</small></div>
    </li>`;
  }
  return html + '</ol>';
}

/**
 * Timesketch import format (JSONL): one event per line with the three required fields (message, datetime,
 * timestamp_desc) plus Indizia's own. Day-only dates are kept at midnight UTC and flagged as such.
 */
export function timesketchJsonl(items, query = '') {
  const out = [];
  for (const e of [...items].reverse()) {
    const dayOnly = e.date.length === 10;
    const t = Date.parse(dayOnly ? `${e.date}T00:00:00Z` : e.date);
    if (!Number.isFinite(t)) continue;
    out.push(JSON.stringify({
      message: e.title,
      datetime: new Date(t).toISOString(),
      timestamp_desc: e.kind === 'activity' ? 'Case activity' : 'Date stated by source',
      data_type: e.kind === 'activity' ? 'sherlock:activity' : 'sherlock:finding',
      source_name: e.source || '',
      query: e.query || query,
      confidence: e.confidence || '',
      date_precision: dayOnly ? 'day' : 'time',
    }));
  }
  return out.length ? `${out.join('\n')}\n` : '';
}
