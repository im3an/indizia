// Internet Archive Wayback Machine. The availability API is CORS-enabled; the CDX API is not (relay).

import { versionsFromCdx, pickVersions, extractPage, diffPages, describeChange, summariseChanges, tsToDate } from '../history.js';
import { registrableDomain } from '../hosting.js';
import { FREEMAIL } from './local.js';

function tsToIso(ts) {
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}

function targetOf(entity) {
  return entity.type === 'url' ? entity.value : entity.value;
}

export const waybackAvailability = {
  id: 'wayback-available',
  name: 'Wayback (latest snapshot)',
  provider: 'Internet Archive',
  homepage: 'https://archive.org/help/wayback_api.php',
  terms: 'https://archive.org/about/terms.php',
  licence: 'Internet Archive terms',
  category: 'Archives',
  accepts: ['domain', 'url'],
  cors: true,
  // The availability API often returns an empty result even for well-archived sites,
  // so it only runs when the CDX history could not be fetched.
  fallbackFor: 'wayback-cdx',

  async run(ctx) {
    const target = targetOf(ctx.entity);
    const { data, evidence } = await ctx.fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(target)}`);
    const snap = data.archived_snapshots?.closest;
    if (!snap?.available) {
      ctx.note('The availability API returned no snapshot. It is known to miss archived sites; check the Wayback calendar.');
      return;
    }
    ctx.fact('Archive', { label: 'Latest snapshot', value: tsToIso(snap.timestamp), evidence, href: snap.url.replace(/^http:/, 'https:'), date: tsToIso(snap.timestamp) });
    ctx.finding({
      title: `Archived snapshot from ${tsToIso(snap.timestamp)}`,
      confidence: 'confirmed',
      evidence,
      href: snap.url.replace(/^http:/, 'https:'),
      date: tsToIso(snap.timestamp),
    });
  },
};

export const waybackCdx = {
  id: 'wayback-cdx',
  name: 'Wayback CDX (history)',
  provider: 'Internet Archive',
  homepage: 'https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server',
  terms: 'https://archive.org/about/terms.php',
  licence: 'Internet Archive terms',
  category: 'Archives',
  accepts: ['domain', 'url'],
  cors: false,

  async run(ctx) {
    const target = targetOf(ctx.entity);
    // One row per month that has captures: enough for first-seen and an activity profile, small enough to be polite.
    const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}&output=json&fl=timestamp,statuscode&collapse=timestamp:6&limit=1200`;
    const { data, evidence } = await ctx.fetch(url, { relay: true, timeout: 30000 });
    const rows = (data || []).slice(1);
    if (!rows.length) {
      ctx.note('The archive has no captures');
      return;
    }
    const first = rows[0][0];
    const last = rows[rows.length - 1][0];
    const years = new Map();
    for (const [ts] of rows) years.set(ts.slice(0, 4), (years.get(ts.slice(0, 4)) || 0) + 1);

    ctx.fact('Archive', { label: 'First captured', value: tsToIso(first), evidence, date: tsToIso(first), href: `https://web.archive.org/web/${first}/${target}` });
    ctx.fact('Archive', { label: 'Last month captured', value: tsToIso(last).slice(0, 7), evidence, href: `https://web.archive.org/web/${last}/${target}` });
    ctx.fact('Archive', { label: 'Months with captures', value: `${rows.length} (${first.slice(0, 4)}–${last.slice(0, 4)})`, evidence });
    ctx.share('wayback.years', [...years.entries()]);
    ctx.finding({
      title: `First archived ${tsToIso(first)} · captured in ${rows.length} months`,
      detail: `Years with captures: ${years.size}. Latest capture month: ${tsToIso(last).slice(0, 7)}.`,
      confidence: 'confirmed',
      evidence,
      href: `https://web.archive.org/web/${first}/${target}`,
      date: tsToIso(first),
      spark: [...years.entries()],
    });
  },
};

/* ---------------- Time machine: how the homepage and the operator pages changed ---------------- */

const MAX_CAPTURES = 4; // homepage versions read per investigation: first, last and two between
const OPERATOR_PAGES = /(impressum|imprint|legal-notice|mentions-legales|kontakt|contact|about|ueber-uns|uber-uns|wir-ueber-uns|team|company|unternehmen)/i;

/** Run async jobs two at a time: polite to the archive, still reasonably fast. */
async function inPairs(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all([worker(), worker()]);
  return out;
}

export const waybackHistory = {
  id: 'wayback-history',
  name: 'Wayback time machine',
  provider: 'Internet Archive',
  homepage: 'https://web.archive.org/',
  terms: 'https://archive.org/about/terms.php',
  licence: 'Internet Archive terms. Archived pages are read as text and never rendered; personal contact details are masked',
  category: 'Archives',
  accepts: ['domain', 'url'],
  cors: false,
  // A URL with a path gets its own history; a bare homepage URL is covered by its domain.
  when: (e) => e.type === 'domain' || !/^https?:\/\/[^/]+\/?$/i.test(e.value),

  async run(ctx) {
    const { entity } = ctx;
    const target = entity.type === 'domain' ? `${entity.value}/` : entity.value;
    const site = entity.type === 'domain' ? entity.value : new URL(entity.value).hostname.replace(/^www\./, '');
    const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}&output=json&fl=timestamp,original,digest&filter=statuscode:200&filter=mimetype:text/html&collapse=timestamp:6&limit=1200`;
    const { data, evidence: cdxEv } = await ctx.fetch(cdxUrl, { relay: true, timeout: 30000 });
    const versions = versionsFromCdx((data || []).slice(1));
    if (!versions.length) {
      ctx.note('The archive holds no readable capture of this page');
      return;
    }
    ctx.fact('Archive', { label: 'Homepage versions', value: `${versions.length} distinct (${versions[0].ts.slice(0, 4)}–${versions.at(-1).ts.slice(0, 4)})`, evidence: cdxEv });

    // 1. Read a handful of versions spread over the history.
    const picks = pickVersions(versions, MAX_CAPTURES);
    let lastError = null;
    const pages = (
      await inPairs(picks, async (v, i) => {
        ctx.progress(`Reading archived capture ${i + 1} of ${picks.length}`);
        try {
          const { data: html, evidence } = await ctx.fetch(`https://web.archive.org/web/${v.ts}id_/${v.original}`, { relay: true, text: true, timeout: 30000 });
          return { v, date: tsToDate(v.ts), href: `https://web.archive.org/web/${v.ts}/${v.original}`, page: extractPage(html, v.original), evidence };
        } catch (err) {
          lastError = err;
          return null;
        }
      })
    ).filter(Boolean);
    ctx.progress('');
    if (!pages.length) throw lastError || new Error('no capture could be read');
    if (pages.length < picks.length) ctx.note(`${picks.length - pages.length} of ${picks.length} captures could not be read`);

    ctx.finding({
      title: `Homepage at ${pages.length} points in time, ${pages[0].date} to ${pages.at(-1).date}`,
      detail: `${versions.length} distinct versions are archived (one row per month with captures). Open a capture to see the page as it looked that day.`,
      confidence: 'confirmed',
      evidence: cdxEv,
      date: pages[0].date,
      asOf: { url: versions.at(-1).original, min: tsToDate(versions[0].ts), max: tsToDate(versions.at(-1).lastTs) },
      links: pages.map((p) => ({
        href: p.href,
        label: `${p.date}: ${p.page.title || '(no title)'}`,
        meta: [p.page.generator, p.page.emails.length && `${p.page.emails.length} email${p.page.emails.length > 1 ? 's' : ''}`, p.page.trackers.length && `${p.page.trackers.length} tracking ID${p.page.trackers.length > 1 ? 's' : ''}`, p.page.imprint && 'imprint link'].filter(Boolean).join(' · '),
      })),
    });

    const own = registrableDomain(site);
    // Entities that appeared in a change: they become pivots (held for the user) and the finding's next questions.
    const newEntities = (changes) =>
      changes
        .filter((c) => c.kind === 'added')
        .map((c) => {
          if (c.field === 'orgs') return { type: 'organisation', value: c.to };
          if (c.field === 'emails') {
            const d = registrableDomain(String(c.key).split('@')[1] || '');
            return d && d !== own && !FREEMAIL.has(d) ? { type: 'domain', value: d } : null;
          }
          return null;
        })
        .filter(Boolean)
        .slice(0, 3);

    // 2. What changed between consecutive captures.
    for (let i = 1; i < pages.length; i++) {
      const a = pages[i - 1];
      const b = pages[i];
      const { changes, similarity } = diffPages(a.page, b.page);
      if (!changes.length && similarity > 0.9) continue;
      const summary = summariseChanges(changes);
      const notable = changes.filter((c) => ['contact', 'branding', 'identity'].includes(c.area));
      ctx.finding({
        title: `${a.date} → ${b.date}: ${changes.length ? summary : 'the text was rewritten'}`,
        detail: `Text ${Math.round(similarity * 100)}% similar.${changes.length ? '' : ' No tracked detail (title, contacts, logo, tracking IDs …) changed.'} Only these two captures were compared; changes in between are not shown.`,
        confidence: 'confirmed',
        evidence: b.evidence,
        href: b.href,
        date: b.date,
        list: changes.map(describeChange),
        listLabel: `${changes.length} change${changes.length === 1 ? '' : 's'}`,
        links: [a, b].map((p) => ({ href: p.href, label: `Capture of ${p.date}`, meta: p.page.title || '' })),
        pivots: newEntities(changes),
        // The finding's own date already puts the summary on the timeline; events add the notable details.
        events: notable.slice(0, 5).map((c) => ({ date: b.date, title: describeChange(c) })),
      });
    }

    // 3. Contact details over time (masked unless they are role addresses).
    const contacts = new Map();
    for (const p of pages) {
      for (const c of [...p.page.emails.map((e) => ({ ...e, kind: 'email' })), ...p.page.phones.map((x) => ({ ...x, kind: 'phone' }))]) {
        const cur = contacts.get(c.value) || { shown: c.shown, kind: c.kind, first: p.date, last: p.date };
        cur.last = p.date;
        contacts.set(c.value, cur);
      }
    }
    if (contacts.size) {
      const list = [...contacts.values()].map((c) => `${c.shown} · ${c.first === c.last ? `seen ${c.first}` : `${c.first} to ${c.last}`}`);
      ctx.finding({
        title: `${contacts.size} contact detail${contacts.size > 1 ? 's' : ''} on the archived homepage`,
        detail: 'Role addresses are shown in full. Personal-looking addresses and phone numbers are masked; the archived page itself has the full text.',
        confidence: 'confirmed',
        evidence: pages.at(-1).evidence,
        list,
        listLabel: 'When each appeared',
      });
    }

    // 4. Feed the engine: archived identifiers become graph links, and new entities become pivots.
    const year = (p) => p.date.slice(0, 4);
    for (const p of pages) {
      for (const t of p.page.trackers) ctx.relate(entity, { type: 'tracker', value: t.id, label: `${t.type} ${t.id}` }, 'used tracking ID (archived)');
      for (const s of p.page.social) ctx.relate(entity, { type: 'account', value: `${s.network}:${s.handle}`, label: `${s.network} ${s.handle}` }, 'links to profile (archived)');
    }
    const pivots = [];
    for (const p of [...pages].reverse()) {
      for (const e of p.page.emails) {
        const d = registrableDomain(e.value.split('@')[1]);
        if (d && d !== own && !FREEMAIL.has(d)) pivots.push([{ type: 'domain', value: d }, `contact email domain (archived ${year(p)})`]);
      }
      try {
        const c = p.page.canonical && registrableDomain(new URL(p.page.canonical).hostname);
        if (c && c !== own) pivots.push([{ type: 'domain', value: c }, `canonical address (archived ${year(p)})`]);
      } catch {
        /* not a URL */
      }
      for (const o of p.page.orgs.slice(0, 2)) pivots.push([{ type: 'organisation', value: o }, `named on the archived homepage (${year(p)})`]);
    }
    const seen = new Set();
    for (const [e, reason] of pivots) {
      const k = `${e.type}:${e.value.toLowerCase()}`;
      if (seen.has(k) || seen.size >= 6) continue;
      seen.add(k);
      ctx.pivot(e, reason);
    }

    // 5. Operator pages still preserved in the archive (best effort: slow on very large sites), and how the
    //    imprint linked from the homepage changed between its first and last archived version.
    if (entity.type !== 'domain') return;
    await Promise.all([listOperatorPages(ctx, site), imprintHistory(ctx, pages, newEntities)]);
  },
};

async function listOperatorPages(ctx, site) {
  try {
    const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(`${site}/*`)}&output=json&fl=timestamp,original&filter=statuscode:200&filter=mimetype:text/html&filter=original:.*${encodeURIComponent(OPERATOR_PAGES.source)}.*&collapse=urlkey&limit=300`;
    const { data, evidence } = await ctx.fetch(url, { relay: true, timeout: 30000 });
    const byPath = new Map();
    for (const [ts, original] of (data || []).slice(1)) {
      const path = original.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase() || '/';
      if (!OPERATOR_PAGES.test(path) || byPath.has(path)) continue;
      byPath.set(path, { ts, original });
    }
    if (!byPath.size) return;
    const list = [...byPath.entries()].sort((a, b) => a[0].length - b[0].length).slice(0, 15);
    ctx.finding({
      title: `${byPath.size} archived page${byPath.size > 1 ? 's' : ''} about the operator (imprint, contact, about)`,
      detail: 'Archived pages that may since have changed or been removed. Each link opens the archive at that address; the date is its first capture.',
      confidence: 'confirmed',
      evidence,
      links: list.map(([path, x]) => ({ href: `https://web.archive.org/web/*/${x.original}`, label: path, meta: `first archived ${tsToDate(x.ts)}` })),
    });
  } catch (err) {
    ctx.note(`Operator pages could not be listed (${err.message || 'archive error'})`);
  }
}

async function imprintHistory(ctx, pages, newEntities) {
  const withImprint = [...pages].reverse().find((p) => p.page.imprintUrl);
  if (!withImprint) return;
  try {
    const target = withImprint.page.imprintUrl.replace(/#.*$/, '');
    const { data } = await ctx.fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}&output=json&fl=timestamp,original,digest&filter=statuscode:200&collapse=digest&limit=400`, { relay: true, timeout: 30000 });
    const versions = (data || []).slice(1).map(([ts, original, digest]) => ({ ts, original, digest }));
    if (versions.length < 2) return;
    const read = async (v) => {
      const { data: html, evidence } = await ctx.fetch(`https://web.archive.org/web/${v.ts}id_/${v.original}`, { relay: true, text: true, timeout: 30000 });
      return { date: tsToDate(v.ts), href: `https://web.archive.org/web/${v.ts}/${v.original}`, page: extractPage(html, v.original), evidence };
    };
    const [a, b] = await inPairs([versions[0], versions.at(-1)], read);
    const { changes } = diffPages(a.page, b.page);
    const legal = changes.filter((c) => ['orgs', 'emails', 'phones', 'copyright'].includes(c.field));
    ctx.finding({
      title: legal.length ? `Imprint ${a.date} → ${b.date}: ${summariseChanges(legal)}` : `Imprint unchanged in its legal details, ${a.date} to ${b.date}`,
      detail: `${versions.length} archived versions of the imprint. The imprint names who is legally responsible for the site; a different organisation here can mean a change of operator. First and last version compared.`,
      confidence: 'confirmed',
      evidence: b.evidence,
      href: b.href,
      date: legal.length ? b.date : undefined,
      list: legal.map(describeChange),
      listLabel: `${legal.length} change${legal.length === 1 ? '' : 's'}`,
      links: [a, b].map((p) => ({ href: p.href, label: `Imprint on ${p.date}`, meta: p.page.orgs.join(', ') })),
      pivots: newEntities(legal),
      events: legal.slice(0, 5).map((c) => ({ date: b.date, title: `Imprint: ${describeChange(c)}` })),
    });
    for (const o of b.page.orgs.slice(0, 2)) ctx.pivot({ type: 'organisation', value: o }, `named in the archived imprint (${b.date.slice(0, 4)})`);
  } catch (err) {
    ctx.note(`The imprint history could not be read (${err.message || 'archive error'})`);
  }
}
