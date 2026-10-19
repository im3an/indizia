import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGraph, discoveryPath } from '../public/src/resolve.js';

const ev = (url) => ({ url, status: 200, retrievedAt: '2026-10-18T10:00:00Z', sha256: 'ab'.repeat(32) });
const snap = (root, relations) => ({ root, relations, shared: {}, ledger: [], findings: [] });

test('stated links keep the request behind them and whether Indizia pivoted along them', () => {
  const m = resolveGraph([
    snap({ type: 'domain', value: 'shop.example' }, [
      { from: { type: 'domain', value: 'shop.example' }, to: { type: 'ip', value: '198.51.100.7' }, label: 'first A record', source: 'DNS', evidence: ev('https://dns.google/resolve?name=shop.example'), pivot: true },
      { from: { type: 'ip', value: '198.51.100.7' }, to: { type: 'asn', value: 'AS64500' }, label: 'announced by', source: 'RIPEstat', evidence: ev('https://stat.ripe.net/x'), pivot: true },
    ]),
  ]);
  const e = m.edges.find((x) => x.label === 'first A record');
  assert.equal(e.pivot, true);
  assert.equal(e.evidence[0].url, 'https://dns.google/resolve?name=shop.example');
  assert.equal(e.evidence[0].source, 'DNS');
  const path = discoveryPath(m, 'asn:AS64500');
  assert.deepEqual(path.map((h) => h.edge.label), ['first A record', 'announced by']);
  assert.deepEqual(discoveryPath(m, 'domain:shop.example'), []);
});

test('an inferred link names its supporting stated links and what could mislead', () => {
  const tracker = { type: 'tracker', value: 'G-ABC123', label: 'GA4 G-ABC123' };
  const m = resolveGraph([
    snap({ type: 'domain', value: 'alpha.example' }, [
      { from: { type: 'domain', value: 'alpha.example' }, to: tracker, label: 'uses tracking ID', source: 'Fingerprint', evidence: ev('https://alpha.example/') },
      { from: { type: 'domain', value: 'beta.example' }, to: tracker, label: 'uses tracking ID', source: 'Fingerprint', evidence: ev('https://beta.example/') },
    ]),
  ]);
  const link = m.edges.find((x) => x.kind === 'inferred');
  assert.ok(link, 'shared tracker infers a link');
  const r = link.reasons[0];
  assert.equal(r.kind, 'tracker');
  assert.match(r.caveat, /agenc/i);
  assert.equal(r.edges.length, 2);
  const support = r.edges.map((id) => m.edges.find((x) => x.id === id));
  assert.deepEqual(support.map((s) => s.evidence[0].url).sort(), ['https://alpha.example/', 'https://beta.example/']);
});
