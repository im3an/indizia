// Entity resolution and link analysis. Pure functions, no DOM: runs in the browser and under node:test.
//
// Input: one or more investigation snapshots (see snapshot.js). Output: a knowledge graph where
//   - duplicate mentions of the same thing are merged into one entity with aliases (and the reason why),
//   - "stated" edges are links a source asserted (RDAP, DNS, Wikidata, CT …): facts,
//   - "inferred" edges are links Indizia computed from shared attributes, each with a confidence score and
//     the list of reasons that produced it, so a reader can always see why two entities may be connected,
//   - candidates are possible duplicates that were NOT merged because the evidence is too weak.
// Privacy: people never take part in inference. Accounts and author names stay as stated edges only.

import { classifyHosting, isSharedKind, massNameServer, massMailProvider, registrableDomain } from './hosting.js';

/* ---------------- Normalisation ---------------- */

const LEGAL_FORMS = [
  'gmbh & co. kgaa', 'gmbh & co. kg', 'gmbh & co kg', 'ag & co. kg', 'se & co. kgaa', 'mbh & co. kg', 'gmbh', 'mbh', 'ag', 'se', 'kgaa', 'kg', 'ohg', 'gbr', 'ug (haftungsbeschränkt)', 'ug', 'e.v.', 'ev', 'eg', 'e.k.',
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'llc', 'l.l.c.', 'llp', 'lp', 'plc', 'pte', 'pty', 'sa', 's.a.', 'sas', 'sarl', 's.a.r.l.', 'srl', 's.r.l.', 'spa', 's.p.a.',
  'bv', 'b.v.', 'nv', 'n.v.', 'ab', 'as', 'a/s', 'asa', 'oy', 'oyj', 'aps', 'kft', 'zrt', 'sp. z o.o.', 'sp z oo', 's.l.', 'sl', 'a.s.', 's.r.o.', 'sro',
];
const WEAK_TOKENS = new Set(['the', 'der', 'die', 'das', 'und', 'and', 'of', 'group', 'gruppe', 'holding', 'holdings', 'international', 'deutschland', 'germany', 'europe', 'global']);
const LEGAL_RE = new RegExp(`(?:^|[\\s,])(?:${LEGAL_FORMS.map((f) => f.replace(/[.*+?^${}()|[\]\\/&]/g, '\\$&')).join('|')})(?=$|[\\s,.])`, 'gi');

const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

/** "Deutsche Bahn AG" → "deutsche bahn"; "SIEMENS Aktiengesellschaft" → "siemens". */
export function normaliseName(name) {
  let s = fold(name).replace(/aktiengesellschaft/g, ' ag').replace(/gesellschaft mit beschrankter haftung/g, ' gmbh');
  for (let i = 0; i < 2; i++) s = s.replace(LEGAL_RE, ' ');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

const tokens = (name) => normaliseName(name).split(' ').filter((t) => t && !WEAK_TOKENS.has(t));

/** Jaro-Winkler similarity, 0..1. */
export function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      m++;
      break;
    }
  }
  if (!m) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < 4 && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

/** Name similarity for organisations: the better of token overlap and character similarity. */
export function nameSimilarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  const dice = (2 * inter) / (sa.size + sb.size);
  const jw = jaroWinkler(ta.join(' '), tb.join(' '));
  // Penalise a high JW on very short names ("DB" vs "DBS").
  const short = Math.min(ta.join('').length, tb.join('').length) < 5 ? 0.85 : 1;
  return Math.max(dice, jw * short);
}

/** Does an organisation name match a domain's label? bundesdruckerei.de ↔ "Bundesdruckerei GmbH". */
export function domainNameMatch(domain, name) {
  const label = registrableDomain(domain).split('.')[0].replace(/-/g, '');
  const compact = tokens(name).join('');
  const full = normaliseName(name).replace(/\s/g, '');
  if (label.length < 3 || !compact) return 0;
  if (label === compact || label === full) return 0.7;
  if (label.length >= 5 && (compact.startsWith(label) || label.startsWith(compact) || full.includes(label))) return 0.5;
  return 0;
}

/** Canonical key of an entity. Domains drop "www." and the trailing dot; ASNs are upper-case. */
export function canonical(e) {
  const t = e.type === 'person-name' ? 'person' : e.type;
  let v = String(e.value ?? '').trim();
  if (t === 'domain') v = v.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  else if (t === 'ip' || t === 'email' || t === 'hash') v = v.toLowerCase();
  else if (t === 'asn') v = 'AS' + v.replace(/^as\s?/i, '');
  else if (t === 'lei') v = v.toUpperCase();
  else if (t === 'organisation') v = fold(v).replace(/\s+/g, ' ');
  return `${t}:${v}`;
}

/* ---------------- Evidence weights for inferred links ---------------- */

/** How strongly sharing an attribute suggests a common operator. Documented here so the report can cite it. */
export const WEIGHTS = {
  lei: 0.98, // the same legal-entity identifier
  account: 0.9, // both sites link the same social profile
  tracker: 0.85, // the same analytics / advertising account ID
  redirect: 0.85, // one domain redirects to the other
  certificate: 0.75, // named together on one TLS certificate
  officialSite: 0.9, // Wikidata says the domain is the organisation's official website
  nameDomain: 0.7, // organisation name equals the domain label (scaled by match quality)
  sameName: 0.92, // identical normalised organisation name
  similarName: 0.6, // similar name (scaled by similarity)
  nsDedicated: 0.5, // the same dedicated (not mass-market) name server
  mxDedicated: 0.45, // the same dedicated mail server
  ipDedicated: 0.4, // the same address on a dedicated or unknown host
  ipShared: 0.05, // the same address on a CDN / cloud / site builder
  asnSmall: 0.2, // the same, non-hosting autonomous system
  spf: 0.35, // the same non-mass SPF include
};

/** What could make each kind of signal misleading. Shown next to the reason, so nobody reads a hypothesis as a fact. */
export const CAVEATS = {
  lei: 'An LEI identifies exactly one legal entity. Check that both records cite the same LEI, not a parent or subsidiary.',
  account: 'Agencies and resellers sometimes link their own profile from client sites.',
  tracker: 'Agencies sometimes reuse one analytics or ad account across several clients.',
  redirect: 'Redirects can point to a marketplace, parking service or link shortener that serves many owners.',
  certificate: 'Some hosting providers put unrelated customers on one shared certificate.',
  officialSite: 'Wikidata is community-edited. Check the cited reference on the item.',
  nameDomain: 'A matching name is common for unrelated companies and for impersonation sites.',
  sameName: 'Different legal entities can carry the same name in different registers or countries.',
  similarName: 'Similar names are common. A shared LEI or register entry would confirm it.',
  ns: 'A small hosting reseller can run dedicated-looking name servers for many customers.',
  mx: 'A hosting provider’s mail server can serve many unrelated domains.',
  ip: 'Small hosts put unrelated sites on one address; CDN and cloud addresses mean nothing.',
  spf: 'An SPF include names a mail sender, which may be a service shared by many companies.',
};

const SUBJECT_TYPES = new Set(['domain', 'organisation', 'lei']);
const noisyOr = (ws) => 1 - ws.reduce((p, w) => p * (1 - w), 1);

/* ---------------- Graph building ---------------- */

class UnionFind {
  constructor() {
    this.p = new Map();
  }
  find(x) {
    if (!this.p.has(x)) this.p.set(x, x);
    let r = x;
    while (this.p.get(r) !== r) r = this.p.get(r);
    this.p.set(x, r);
    return r;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p.set(rb, ra);
    return ra;
  }
}

/**
 * Resolve snapshots into a knowledge graph.
 * @param {object[]} snapshots investigation snapshots (or live states run through toSnapshot)
 * @param {{ minConfidence?: number }} opts
 */
export function resolveGraph(snapshots, opts = {}) {
  const minConfidence = opts.minConfidence ?? 0.3;
  const raw = new Map(); // canonical key → mention
  const stated = [];
  const mention = (e, snapIdx, extra = {}) => {
    if (!e?.value) return null;
    const k = canonical(e);
    let m = raw.get(k);
    if (!m) {
      m = { key: k, type: e.type === 'person-name' ? 'person' : e.type, value: e.type === 'domain' ? k.slice(7) : e.value, labels: new Set(), snaps: new Set(), root: false };
      raw.set(k, m);
    }
    if (e.label && e.label !== e.value) m.labels.add(e.label);
    m.snaps.add(snapIdx);
    Object.assign(m, extra);
    return m;
  };

  snapshots.forEach((s, i) => {
    const root = mention(s.root, i, { root: true });
    if (s.root.type === 'url' && s.root.host) {
      const host = mention({ type: 'domain', value: s.root.host }, i);
      stated.push({ a: root.key, b: host.key, label: 'host', sources: ['URL'] });
    }
    for (const r of s.relations || []) {
      const a = mention(r.from, i);
      const b = mention(r.to, i);
      if (a && b && a.key !== b.key) stated.push({ a: a.key, b: b.key, label: r.label, sources: [r.source].filter(Boolean), evidence: r.evidence ? [{ ...r.evidence, source: r.source }] : [], pivot: !!r.pivot });
    }
    // The pivot IP's hosting classification travels in shared data.
    if (s.shared?.hosting && s.shared?.['dns.ips']?.[0]) {
      const ip = raw.get(canonical({ type: 'ip', value: s.shared['dns.ips'][0] }));
      if (ip) ip.hosting = s.shared.hosting;
    }
  });

  // Structural facts: a subdomain belongs to its registrable domain when both are present.
  for (const m of [...raw.values()]) {
    if (m.type !== 'domain') continue;
    const apex = registrableDomain(m.value);
    if (apex !== m.value && raw.has(`domain:${apex}`)) stated.push({ a: `domain:${apex}`, b: m.key, label: 'subdomain', sources: ['domain structure'] });
  }
  // AS holder labels tell us whether an address sits on shared infrastructure.
  for (const r of stated) {
    if (r.label !== 'announced by') continue;
    const asn = raw.get(r.b);
    const ip = raw.get(r.a);
    const holder = [...(asn?.labels || [])][0];
    const hosting = classifyHosting(holder);
    if (asn && hosting) asn.hosting = hosting;
    if (ip && hosting && !ip.hosting) ip.hosting = hosting;
  }

  /* ---- Merge duplicates (union-find): strong identifiers and identical normalised names ---- */
  const uf = new UnionFind();
  const merges = [];
  const orgs = [...raw.values()].filter((m) => m.type === 'organisation');
  const byNorm = new Map();
  for (const m of orgs) {
    const n = normaliseName(m.value);
    if (n.length < 2) continue;
    if (byNorm.has(n)) {
      const other = byNorm.get(n);
      uf.union(other.key, m.key);
      merges.push({ keys: [other.key, m.key], reason: `Same name after removing legal form and punctuation (“${other.value}” = “${m.value}”)`, confidence: WEIGHTS.sameName });
    } else byNorm.set(n, m);
  }
  // Two organisation mentions that both carry the same LEI are the same legal entity.
  const leiOf = new Map();
  for (const r of stated) {
    const a = raw.get(r.a);
    const b = raw.get(r.b);
    if (a?.type === 'organisation' && b?.type === 'lei') {
      if (leiOf.has(b.key) && uf.find(leiOf.get(b.key)) !== uf.find(a.key)) {
        merges.push({ keys: [leiOf.get(b.key), a.key], reason: `Both carry LEI ${b.value}`, confidence: WEIGHTS.lei });
        uf.union(leiOf.get(b.key), a.key);
      } else leiOf.set(b.key, a.key);
    }
  }

  /* ---- Nodes ---- */
  const nodes = new Map();
  for (const m of raw.values()) {
    const id = uf.find(m.key);
    let n = nodes.get(id);
    if (!n) {
      const head = raw.get(id);
      n = { id, type: head.type, value: head.value, label: [...head.labels][0] || head.value, aliases: new Set(), keys: [], root: false, snaps: new Set(), hosting: null };
      nodes.set(id, n);
    }
    n.keys.push(m.key);
    if (m.key !== id) n.aliases.add(m.value);
    for (const l of m.labels) if (l !== n.label) n.aliases.add(l);
    for (const s of m.snaps) n.snaps.add(s);
    n.root ||= m.root;
    n.hosting ||= m.hosting || null;
  }
  const idOf = (k) => uf.find(k);

  /* ---- Stated edges (deduplicated, sources merged) ---- */
  const edgeMap = new Map();
  for (const r of stated) {
    const a = idOf(r.a);
    const b = idOf(r.b);
    if (a === b) continue;
    const k = `${a}>${b}>${r.label}`;
    const e = edgeMap.get(k) || { id: `s${edgeMap.size}`, a, b, label: r.label, kind: 'stated', confidence: 1, sources: new Set(), reasons: [], evidence: [], pivot: false };
    for (const s of r.sources) e.sources.add(s);
    for (const ev of r.evidence || []) if (!e.evidence.some((x) => x.url === ev.url && x.source === ev.source)) e.evidence.push(ev);
    e.pivot ||= !!r.pivot;
    edgeMap.set(k, e);
  }
  const statedEdges = [...edgeMap.values()].map((e) => ({ ...e, sources: [...e.sources], reasons: [{ text: `${[...e.sources].join(', ') || 'A source'} states: ${nodes.get(e.a).label} — ${e.label} → ${nodes.get(e.b).label}`, weight: 1 }] }));

  /* ---- Inference: shared attributes between subject entities ---- */
  const adj = new Map();
  for (const e of statedEdges) {
    (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push({ other: e.b, label: e.label, out: true, edge: e });
    (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push({ other: e.a, label: e.label, out: false, edge: e });
  }
  // Subjects: domains collapse to their registrable domain, so www/mail hosts speak for the apex.
  const subjectOf = (id) => {
    const n = nodes.get(id);
    if (!n || !SUBJECT_TYPES.has(n.type)) return null;
    if (n.type !== 'domain') return id;
    const apex = `domain:${registrableDomain(n.value)}`;
    return nodes.has(idOf(apex)) ? idOf(apex) : id;
  };
  const focus = new Set();
  for (const n of nodes.values()) if (n.root) focus.add(subjectOf(n.id) || n.id);
  // One hop of stated links from a root also counts as focus (e.g. the organisation behind the domain).
  for (const f of [...focus]) for (const x of adj.get(f) || []) if (['official website of', 'LEI', 'redirects to'].includes(x.label)) focus.add(subjectOf(x.other) || x.other);

  const evidence = new Map(); // "a|b" → { a, b, reasons: [] }
  // kind: which signal (see CAVEATS) · edges: the stated edges whose evidence supports the reason.
  const addReason = (x, y, text, weight, via, kind = null, edges = []) => {
    if (!x || !y || x === y || weight <= 0) return;
    if (!focus.has(x) && !focus.has(y)) return;
    const [a, b] = x < y ? [x, y] : [y, x];
    const k = `${a}|${b}`;
    const cur = evidence.get(k) || { a, b, reasons: [] };
    if (!cur.reasons.some((r) => r.text === text)) cur.reasons.push({ text, weight, via, kind, caveat: kind ? CAVEATS[kind] : undefined, edges: [...new Set(edges.filter(Boolean))] });
    evidence.set(k, cur);
  };

  // Attribute → which subjects point at it (and how), plus the stated edge that says so.
  const holders = new Map();
  const holderEdge = new Map(); // `${attrId}|${subject}` → stated edge id
  for (const e of statedEdges) {
    const from = nodes.get(e.a);
    const to = nodes.get(e.b);
    const s = subjectOf(e.a);
    if (!s) continue;
    const kind =
      to.type === 'tracker' ? 'tracker'
      : to.type === 'account' && e.label.startsWith('links to profile') ? 'account' // incl. "(archived)"
      : to.type === 'ip' && /resolves to|served from/.test(e.label) ? 'ip'
      : to.type === 'domain' && e.label === 'name server' ? 'ns'
      : to.type === 'domain' && e.label === 'mail server' ? 'mx'
      : null;
    if (!kind || from.type === 'person') continue;
    const list = holders.get(to.id) || [];
    if (!list.includes(s)) list.push(s);
    holders.set(to.id, list);
    if (!holderEdge.has(`${to.id}|${s}`)) holderEdge.set(`${to.id}|${s}`, e.id);
    to.attrKind = kind;
  }
  for (const [attrId, subs] of holders) {
    if (subs.length < 2) continue;
    const attr = nodes.get(attrId);
    let w = 0;
    let text = '';
    if (attr.attrKind === 'tracker') {
      w = WEIGHTS.tracker;
      text = `Both embed the same tracking ID ${attr.label}`;
    } else if (attr.attrKind === 'account') {
      w = WEIGHTS.account;
      text = `Both link the same profile ${attr.label}`;
    } else if (attr.attrKind === 'ns') {
      const mass = massNameServer(attr.value);
      if (mass) continue; // shared by millions of customers: no signal
      w = WEIGHTS.nsDedicated;
      text = `Both use the dedicated name server ${attr.value}`;
    } else if (attr.attrKind === 'mx') {
      if (massMailProvider(attr.value)) continue;
      w = WEIGHTS.mxDedicated;
      text = `Both receive mail on the dedicated server ${attr.value}`;
    } else if (attr.attrKind === 'ip') {
      // Many domains on one address means shared hosting; a CDN address means nothing at all.
      const fanout = (adj.get(attrId) || []).filter((x) => /hosted|served|resolves/.test(x.label)).length;
      const shared = (attr.hosting && isSharedKind(attr.hosting.kind)) || fanout > 25;
      w = shared ? WEIGHTS.ipShared : WEIGHTS.ipDedicated;
      text = `Both resolve to ${attr.value}${attr.hosting ? ` (${attr.hosting.provider}, ${attr.hosting.kind})` : ''}${shared ? ' — shared infrastructure, weak signal' : ''}`;
    }
    for (let i = 0; i < subs.length; i++) for (let j = i + 1; j < subs.length; j++) addReason(subs[i], subs[j], text, w, attrId, attr.attrKind, [holderEdge.get(`${attrId}|${subs[i]}`), holderEdge.get(`${attrId}|${subs[j]}`)]);
  }

  // Direct stated links that also imply a shared operator.
  for (const e of statedEdges) {
    const a = subjectOf(e.a);
    const b = subjectOf(e.b);
    if (!a || !b || a === b) continue;
    const na = nodes.get(a);
    const nb = nodes.get(b);
    if (e.label === 'redirects to') addReason(a, b, `${na.label} redirects to ${nb.label}`, WEIGHTS.redirect, e.id, 'redirect', [e.id]);
    else if (e.label === 'certificate name' && registrableDomain(nb.value) !== registrableDomain(na.value)) addReason(a, b, `${nb.value} appears on a certificate issued for ${na.value}`, WEIGHTS.certificate, e.id, 'certificate', [e.id]);
    else if (e.label === 'official website of') addReason(a, b, `Wikidata lists ${na.label} as the official website of ${nb.label}`, WEIGHTS.officialSite, e.id, 'officialSite', [e.id]);
  }

  // Shared SPF includes and shared non-hosting ASNs, from snapshot data.
  const spfBy = new Map();
  snapshots.forEach((s) => {
    const subj = subjectOf(idOf(canonical(s.root.type === 'url' && s.root.host ? { type: 'domain', value: s.root.host } : s.root)));
    for (const inc of s.shared?.['dns.spf'] || []) {
      if (massMailProvider(inc) || /spf\.protection\.outlook|_spf\.google|mailgun|sendgrid|amazonses|mcsv|mandrill|zendesk|salesforce|hubspot/i.test(inc)) continue;
      spfBy.set(inc, [...new Set([...(spfBy.get(inc) || []), subj])]);
    }
  });
  for (const [inc, subs] of spfBy) for (let i = 0; i < subs.length; i++) for (let j = i + 1; j < subs.length; j++) addReason(subs[i], subs[j], `Both authorise the same mail sender (SPF include:${inc})`, WEIGHTS.spf, null, 'spf');

  // Identity matching: organisations, legal entities and domains whose names line up.
  const subjects = [...nodes.values()].filter((n) => SUBJECT_TYPES.has(n.type) && subjectOf(n.id) === n.id);
  const candidates = [];
  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      const x = subjects[i];
      const y = subjects[j];
      if (!focus.has(x.id) && !focus.has(y.id)) continue;
      const pair = [x.type, y.type].sort().join('+');
      const nameX = x.type === 'lei' ? x.label : x.value;
      const nameY = y.type === 'lei' ? y.label : y.value;
      if (pair === 'domain+organisation' || pair === 'domain+lei') {
        const [d, o] = x.type === 'domain' ? [x, y] : [y, x];
        const q = domainNameMatch(d.value, o.type === 'lei' ? o.label : o.value);
        if (q) addReason(d.id, o.id, `The domain label “${registrableDomain(d.value).split('.')[0]}” matches the name “${o.label}”`, q * (WEIGHTS.nameDomain / 0.7) * 0.85, null, 'nameDomain');
      } else if (pair === 'lei+organisation' || pair === 'organisation+organisation' || pair === 'lei+lei') {
        if (x.type === 'lei' && y.type === 'lei') continue; // two LEIs are two legal entities by definition
        const sim = nameSimilarity(nameX, nameY);
        if (sim >= 0.999 && pair === 'lei+organisation') addReason(x.id, y.id, `Same legal name (“${nameX}” / “${nameY}”)`, WEIGHTS.sameName, null, 'sameName');
        else if (sim >= 0.82) {
          addReason(x.id, y.id, `Similar names (“${nameX}” / “${nameY}”, similarity ${Math.round(sim * 100)}%)`, WEIGHTS.similarName * sim, null, 'similarName');
          if (pair === 'organisation+organisation') candidates.push({ a: x.id, b: y.id, score: sim, reason: 'Similar organisation names; not merged automatically' });
        }
      }
    }
  }

  // Score: independent signals combine with noisy-OR. Stated links between the same pair stay separate edges.
  const inferredEdges = [];
  for (const ev of evidence.values()) {
    const confidence = noisyOr(ev.reasons.map((r) => r.weight));
    if (confidence < minConfidence) continue;
    inferredEdges.push({
      id: `i${inferredEdges.length}`,
      a: ev.a,
      b: ev.b,
      label: label(confidence, nodes.get(ev.a), nodes.get(ev.b)),
      kind: 'inferred',
      confidence: Math.round(confidence * 100) / 100,
      reasons: ev.reasons.sort((p, q) => q.weight - p.weight),
      sources: [],
    });
  }

  const outNodes = [...nodes.values()].map((n) => ({ ...n, aliases: [...n.aliases].filter((a) => a && a !== n.label && a !== n.value).slice(0, 12), snaps: [...n.snaps] }));
  return {
    nodes: outNodes,
    edges: [...statedEdges, ...inferredEdges],
    merges,
    candidates: candidates.sort((a, b) => b.score - a.score).slice(0, 30),
    stats: { mentions: raw.size, entities: outNodes.length, stated: statedEdges.length, inferred: inferredEdges.length, merged: raw.size - outNodes.length },
  };
}

function label(c, a, b) {
  const same = (a.type === 'organisation' || a.type === 'lei') && (b.type === 'organisation' || b.type === 'lei');
  if (same) return c >= 0.85 ? 'likely the same entity' : 'possibly the same entity';
  return c >= 0.85 ? 'likely same operator' : c >= 0.6 ? 'possibly same operator' : 'weakly linked';
}

/** Confidence band for display, consistent with the finding labels. */
export function band(c) {
  if (c >= 0.999) return 'confirmed';
  if (c >= 0.85) return 'corroborated';
  if (c >= 0.6) return 'plausible';
  return 'lead';
}

/**
 * Why may two entities be connected? Up to `max` shortest paths (BFS, at most `depth` hops) over stated and
 * inferred edges. Path confidence is the product of its edge confidences.
 */
export function explainConnection(model, fromId, toId, { max = 3, depth = 4 } = {}) {
  if (fromId === toId) return [];
  const adj = new Map();
  for (const e of model.edges) {
    if (e.kind === 'source') continue;
    (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push({ to: e.b, e });
    (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push({ to: e.a, e });
  }
  const paths = [];
  const queue = [[fromId, []]];
  const bestDepth = new Map([[fromId, 0]]);
  while (queue.length && paths.length < max * 4) {
    const [at, path] = queue.shift();
    if (path.length >= depth) continue;
    for (const { to, e } of adj.get(at) || []) {
      if (path.some((p) => p.from === to) || to === fromId) continue;
      const next = [...path, { from: at, to, edge: e }];
      if (to === toId) {
        paths.push(next);
        continue;
      }
      // Allow equally short alternatives, prune longer revisits.
      if ((bestDepth.get(to) ?? Infinity) < next.length) continue;
      bestDepth.set(to, next.length);
      queue.push([to, next]);
    }
  }
  return paths
    .map((p) => ({ hops: p, confidence: Math.round(p.reduce((c, h) => c * h.edge.confidence, 1) * 100) / 100, inferred: p.some((h) => h.edge.kind === 'inferred') }))
    .sort((a, b) => a.hops.length - b.hops.length || b.confidence - a.confidence)
    .slice(0, max);
}

/**
 * How did Indizia reach an entity? The shortest chain of stated links from a searched entity, preferring
 * pivots the engine followed. Every step is a link a source asserted, so each one opens its evidence.
 */
export function discoveryPath(model, nodeId) {
  const roots = model.nodes.filter((n) => n.root).map((n) => n.id);
  if (roots.includes(nodeId)) return [];
  const adj = new Map();
  for (const e of model.edges) {
    if (e.kind !== 'stated') continue;
    (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push({ to: e.b, e });
    (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push({ to: e.a, e });
  }
  // Pivot links first, so ties resolve to the path the engine actually walked.
  for (const list of adj.values()) list.sort((x, y) => Number(y.e.pivot) - Number(x.e.pivot));
  const prev = new Map(roots.map((r) => [r, null]));
  const queue = [...roots];
  while (queue.length) {
    const at = queue.shift();
    if (at === nodeId) break;
    for (const { to, e } of adj.get(at) || []) {
      if (prev.has(to)) continue;
      prev.set(to, { from: at, edge: e });
      queue.push(to);
    }
  }
  if (!prev.has(nodeId)) return null;
  const hops = [];
  for (let at = nodeId; prev.get(at); at = prev.get(at).from) hops.unshift({ from: prev.get(at).from, to: at, edge: prev.get(at).edge });
  return hops;
}
