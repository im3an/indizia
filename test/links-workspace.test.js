import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseName, nameSimilarity, domainNameMatch, resolveGraph, explainConnection, WEIGHTS } from '../public/src/resolve.js';
import { registrableDomain, isPrivateIp, classifyHosting, massNameServer } from '../public/src/hosting.js';
import { diffSnapshots } from '../public/src/snapshot.js';
import { buildTimeline } from '../public/src/timeline.js';
import { analyse } from '../server/fingerprint.mjs';
import { caseMarkdown, mdToHtml, sha256Text } from '../public/src/workspace/report.js';
import { blankCase } from '../public/src/workspace/store.js';

const R = (from, to, label, source = 'test') => ({ from, to, label, source });
const dom = (value) => ({ type: 'domain', value });
const snap = (root, relations, extra = {}) => ({ root, relations, findings: [], facts: {}, ledger: [], shared: {}, startedAt: '2026-10-01T00:00:00Z', finishedAt: '2026-10-01T00:00:05Z', ...extra });

test('organisation names normalise across legal forms, case and diacritics', () => {
  assert.equal(normaliseName('Deutsche Bahn AG'), 'deutsche bahn');
  assert.equal(normaliseName('DEUTSCHE BAHN AKTIENGESELLSCHAFT'), 'deutsche bahn');
  assert.equal(normaliseName('Siemens Energy Global GmbH & Co. KG'), 'siemens energy global');
  assert.equal(normaliseName('Müller Ltd.'), 'muller');
  assert.ok(nameSimilarity('Deutsche Bahn', 'Deutsche Bank') < 1);
  assert.equal(domainNameMatch('bundesdruckerei.de', 'Bundesdruckerei GmbH'), 0.7);
  assert.equal(domainNameMatch('db.de', 'Deutsche Bahn'), 0);
});

test('registrable domains, private addresses and shared infrastructure', () => {
  assert.equal(registrableDomain('www.shop.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('user.github.io'), 'user.github.io');
  assert.ok(isPrivateIp('10.1.2.3') && isPrivateIp('192.168.0.1') && isPrivateIp('::1') && isPrivateIp('fd00::1'));
  assert.ok(!isPrivateIp('8.8.8.8') && !isPrivateIp('2a00:1450::1'));
  assert.equal(classifyHosting('CLOUDFLARENET')?.kind, 'cdn');
  assert.equal(massNameServer('ns1.cloudflare.com'), 'Cloudflare');
  assert.equal(massNameServer('ns1.bdr.de'), null);
});

test('a shared tracking ID links two domains; a shared CDN address barely counts', () => {
  const tracker = { type: 'tracker', value: 'UA-1234', label: 'Google Analytics UA-1234' };
  const asn = { type: 'asn', value: 'AS13335', label: 'AS13335 · CLOUDFLARENET' };
  const ip = { type: 'ip', value: '104.16.1.1' };
  const a = snap(dom('a-shop.de'), [R(dom('a-shop.de'), tracker, 'uses tracking ID'), R(dom('a-shop.de'), ip, 'resolves to'), R(ip, asn, 'announced by')]);
  const b = snap(dom('b-store.com'), [R(dom('b-store.com'), tracker, 'uses tracking ID'), R(dom('b-store.com'), ip, 'resolves to')]);
  const m = resolveGraph([a, b]);
  const link = m.edges.find((e) => e.kind === 'inferred' && [e.a, e.b].sort().join() === 'domain:a-shop.de,domain:b-store.com');
  assert.ok(link, 'expected an inferred link');
  assert.ok(link.confidence >= WEIGHTS.tracker && link.confidence < WEIGHTS.tracker + 0.1, `confidence ${link.confidence}`);
  assert.ok(link.reasons.some((r) => /UA-1234/.test(r.text)));
  assert.ok(link.reasons.some((r) => /shared infrastructure/.test(r.text) && r.weight <= WEIGHTS.ipShared));
  const paths = explainConnection(m, 'domain:a-shop.de', 'domain:b-store.com');
  assert.ok(paths.length >= 1);
  assert.ok(paths.some((p) => !p.inferred), 'a path through the stated tracker edges exists');
});

test('mass-market name servers never create links; identical names merge, similar ones stay candidates', () => {
  const ns = dom('ns1.cloudflare.com');
  const a = snap(dom('one.example'), [R(dom('one.example'), ns, 'name server'), R(dom('one.example'), { type: 'organisation', value: 'Acme GmbH' }, 'official website of')]);
  const b = snap(dom('two.example'), [R(dom('two.example'), ns, 'name server'), R(dom('two.example'), { type: 'organisation', value: 'ACME AG' }, 'official website of'), R(dom('two.example'), { type: 'organisation', value: 'Acme Holdings Europe' }, 'mentions')]);
  const m = resolveGraph([a, b]);
  assert.ok(!m.edges.some((e) => e.kind === 'inferred' && e.reasons.some((r) => /cloudflare/i.test(r.text))));
  assert.equal(m.merges.length, 1, 'Acme GmbH and ACME AG merge');
  assert.ok(m.nodes.some((n) => n.type === 'organisation' && n.aliases.length));
});

test('people never take part in inference', () => {
  const author = { type: 'person-name', value: 'Jane Doe' };
  const m = resolveGraph([snap({ type: 'file', value: 'a.pdf' }, [R({ type: 'file', value: 'a.pdf' }, author, 'author field')]), snap({ type: 'file', value: 'b.pdf' }, [R({ type: 'file', value: 'b.pdf' }, author, 'author field')])]);
  assert.equal(m.edges.filter((e) => e.kind === 'inferred').length, 0);
});

test('re-run diff separates new, gone and changed findings', () => {
  const f = (title, source = 'DNS') => ({ title, source });
  const d = diffSnapshots({ findings: [f('12 certificates', 'CT'), f('Old record')], facts: { Reg: [{ label: 'Registrar', value: 'A' }] } }, { findings: [f('14 certificates', 'CT'), f('New record')], facts: { Reg: [{ label: 'Registrar', value: 'B' }] } });
  assert.deepEqual(d.added.map((x) => x.title), ['New record']);
  assert.deepEqual(d.removed.map((x) => x.title), ['Old record']);
  assert.equal(d.grown.length, 1);
  assert.deepEqual(d.changed, [{ key: 'Reg|Registrar', from: 'A', to: 'B' }]);
});

test('timeline merges dated findings, facts and the audit trail, newest first', () => {
  const s = snap(dom('x.example'), [], { findings: [{ title: 'Registered', source: 'RDAP', date: '2001-05-02T00:00:00Z', events: [{ date: '2019', title: 'First certificate' }] }], facts: { Registration: [{ label: 'Expires', value: '2030-01-01', date: '2030-01-01', sources: ['RDAP'] }] } });
  const t = buildTimeline([s], [{ at: '2026-10-18T10:00:00Z', text: 'Case created' }]);
  assert.deepEqual(t.map((x) => x.date.slice(0, 4)), ['2030', '2026', '2019', '2001']);
  assert.equal(t.find((x) => x.kind === 'activity').title, 'Case created');
});

test('fingerprint analysis finds technologies, tracking IDs, social profiles and security headers', () => {
  const html = `<html><head><title>Shop</title><meta name="generator" content="WordPress 6.5.2">
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEF1234"></script><script>gtag('config','G-ABCDEF1234'); fbq('init', '123456789012345');</script>
    <link rel="stylesheet" href="/wp-content/themes/x/style.css"></head>
    <body><a href="https://www.linkedin.com/company/acme-gmbh/">in</a><a href="https://twitter.com/intent/tweet">share</a><a href="https://partner.example/">p</a></body></html>`;
  const r = analyse({ headers: { Server: 'nginx/1.25.3', 'Strict-Transport-Security': 'max-age=1' }, cookies: ['PHPSESSID'], html, host: 'acme.example' });
  const names = r.technologies.map((t) => t.name);
  for (const n of ['nginx', 'WordPress', 'PHP', 'Google Analytics', 'Meta Pixel']) assert.ok(names.includes(n), `missing ${n}`);
  assert.equal(r.technologies.find((t) => t.name === 'WordPress').version, '6.5.2');
  assert.deepEqual(r.trackers.map((t) => t.id).sort(), ['123456789012345', 'G-ABCDEF1234']);
  assert.deepEqual(r.social.map((s) => s.handle), ['company/acme-gmbh']);
  assert.equal(r.security.hsts, 'max-age=1');
  assert.equal(r.security.csp, null);
  assert.deepEqual(r.linkedDomains.map((d) => d.domain), ['linkedin.com', 'twitter.com', 'partner.example']);
});

test('case report cites evidence and ends with a verifiable SHA-256', async () => {
  const c = blankCase({ name: 'Test case', folder: 'Demo' });
  c.investigations.push({ id: 'i1', query: 'a-shop.de', root: dom('a-shop.de'), savedAt: '2026-10-18T00:00:00Z', snapshot: snap(dom('a-shop.de'), [R(dom('a-shop.de'), { type: 'tracker', value: 'UA-1' }, 'uses tracking ID')]), runs: [] });
  c.evidence.push({ id: 'e1', title: 'Registered 2001-05-02', confidence: 'confirmed', source: 'RDAP', query: 'a-shop.de', pinnedAt: '2026-10-18T00:00:00Z', tags: ['reg'], note: 'old domain', evidence: { url: 'https://rdap.example/domain/a-shop.de', retrievedAt: '2026-10-18T00:00:00Z', sha256: 'ab'.repeat(32), status: 200 } });
  c.tasks.push({ id: 't1', kind: 'lead', text: 'Check the tracker', status: 'open', createdAt: '2026-10-18T00:00:00Z' });
  const md = await caseMarkdown(c);
  assert.match(md, /^# Case report: Test case/);
  assert.match(md, /### E1\. Registered 2001-05-02/);
  assert.match(md, /Response SHA-256:\*\* `a{0}(ab){32}`/);
  assert.match(md, /\*\*Lead:\*\* Check the tracker/);
  const [body, tail] = md.split('\n---\n');
  const digest = /`([0-9a-f]{64})`/.exec(tail)[1];
  assert.equal(digest, await sha256Text(body));
  const html = mdToHtml(md);
  assert.match(html, /<h1>Case report: Test case<\/h1>/);
  assert.match(html, /<table>/);
});
