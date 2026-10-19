import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startInvestigation, PIVOT_RULES } from '../public/src/engine.js';

// Fake sources: no network. Each records local evidence so relations carry it.
const dnsF = {
  id: 'dnsF', name: 'Fake DNS', accepts: ['domain'],
  async run(ctx) {
    const evidence = ctx.local('dns', { a: ['192.0.2.1', '192.0.2.2'] });
    ctx.finding({ title: `${ctx.entity.value} resolves to 2 addresses`, confidence: 'confirmed', evidence, pivots: [{ type: 'ip', value: '192.0.2.1' }, { type: 'ip', value: '192.0.2.2' }] });
    ctx.pivot({ type: 'ip', value: '192.0.2.1' }, 'first A record');
  },
};
const ipF = {
  id: 'ipF', name: 'Fake RIPEstat', accepts: ['ip', 'asn'],
  async run(ctx) {
    const evidence = ctx.local('ip', {});
    if (ctx.entity.type === 'asn') return ctx.finding({ title: `${ctx.entity.value} is a network`, confidence: 'confirmed', evidence });
    ctx.finding({ title: `${ctx.entity.value} is announced by AS64500`, confidence: 'confirmed', evidence, pivots: [{ type: 'asn', value: 'AS64500' }] });
    ctx.pivot({ type: 'asn', value: 'AS64500' }, 'announced by');
  },
};
const rdapF = { id: 'rdapF', name: 'Fake RDAP', accepts: ['asn'], async run(ctx) { ctx.finding({ title: 'AS holder', confidence: 'confirmed', evidence: ctx.local('rdap', {}) }); } };
const wikiF = {
  id: 'wikiF', name: 'Fake Wikidata', accepts: ['domain'],
  async run(ctx) {
    const evidence = ctx.local('wiki', {});
    ctx.finding({ title: 'Official website of Example AG', confidence: 'confirmed', evidence, pivots: [{ type: 'lei', value: 'L1' }] });
    ctx.pivot({ type: 'lei', value: 'L1', label: 'Example AG' }, 'LEI listed');
  },
};
// LEI chain: L1 → L2 → L3 → … each reports its direct parent.
const leiF = {
  id: 'leiF', name: 'Fake GLEIF', accepts: ['lei'],
  async run(ctx) {
    const evidence = ctx.local('lei', {});
    const n = Number(ctx.entity.value.slice(1)) + 1;
    ctx.share('gleif.record', { lei: ctx.entity.value });
    ctx.finding({ title: `Direct parent: Holding ${n}`, confidence: 'confirmed', evidence, pivots: [{ type: 'lei', value: `L${n}` }] });
    ctx.pivot({ type: 'lei', value: `L${n}`, label: `Holding ${n}` }, 'direct parent', { again: true });
  },
};
const SOURCES = [dnsF, ipF, rdapF, wikiF, leiF];

async function settle(inv) {
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setImmediate(r));
    if (inv.state.finishedAt && !inv.state.runs.some((r) => ['queued', 'running'].includes(r.state))) return inv.state;
  }
  throw new Error('investigation did not settle');
}
const ran = (state, source, value) => state.runs.some((r) => r.source.id === source && r.entity.value === value && r.state === 'done');

test('pivots are followed up to the depth limit and held beyond it', async () => {
  const inv = startInvestigation({ type: 'domain', value: 'example.org' }, () => {}, { sources: SOURCES, depth: 2, budget: 50 });
  const s = await settle(inv);
  assert.ok(ran(s, 'ipF', '192.0.2.1'), 'step 1: the IP');
  assert.ok(ran(s, 'ipF', 'AS64500') || ran(s, 'rdapF', 'AS64500'), 'step 2: the ASN');
  assert.ok(ran(s, 'leiF', 'L1'), 'step 1: the LEI');
  assert.ok(ran(s, 'leiF', 'L2'), 'step 2: the parent, by the same source (again)');
  assert.ok(!ran(s, 'leiF', 'L3'), 'step 3 is beyond the limit');
  const held = s.pivots.find((p) => p.entity.value === 'L3');
  assert.equal(held.status, 'held');
  assert.equal(held.held, 'depth');
  assert.equal(held.hop, 3);
  // Shared data describes the subject: the step-2 parent did not overwrite the step-1 record.
  assert.equal(s.shared['gleif.record'].lei, 'L1');
  // Rows remember how far out they are.
  assert.equal(s.runs.find((r) => r.source.id === 'leiF' && r.entity.value === 'L2').hop, 2);
});

test('depth 1 restores the one-step behaviour', async () => {
  const s = await settle(startInvestigation({ type: 'domain', value: 'example.org' }, () => {}, { sources: SOURCES, depth: 1, budget: 50 }));
  assert.ok(ran(s, 'ipF', '192.0.2.1'));
  assert.ok(!s.runs.some((r) => r.entity.value === 'AS64500'));
  assert.equal(s.pivots.find((p) => p.entity.value === 'AS64500').held, 'depth');
});

test('the budget caps source runs started by pivots', async () => {
  const s = await settle(startInvestigation({ type: 'domain', value: 'example.org' }, () => {}, { sources: SOURCES, depth: 3, budget: 2 }));
  assert.ok(s.budget.spent <= 2);
  assert.ok(s.pivots.some((p) => p.held === 'budget'));
  const pivotRuns = s.runs.filter((r) => r.via && !r.manual && r.state !== 'not_applicable' && r.state !== 'standby').length;
  assert.equal(pivotRuns, s.budget.spent);
});

test('pivots outside the policy are held, never followed', async () => {
  const odd = { id: 'odd', name: 'Odd', accepts: ['domain'], async run(ctx) { ctx.pivot({ type: 'username', value: 'someone' }, 'mentions'); } };
  const s = await settle(startInvestigation({ type: 'domain', value: 'example.org' }, () => {}, { sources: [odd] }));
  assert.equal(s.pivots[0].held, 'policy');
  assert.ok(!s.runs.some((r) => r.entity.type === 'username'));
  assert.ok(!PIVOT_RULES['domain>username']);
});

test('held pivots and unfollowed leads become runnable questions', async () => {
  const inv = startInvestigation({ type: 'domain', value: 'example.org' }, () => {}, { sources: SOURCES, depth: 2, budget: 50 });
  const s = await settle(inv);
  const parent = s.questions.find((q) => q.entity?.value === 'L3');
  assert.ok(parent, 'held parent asked about');
  assert.equal(parent.kind, 'follow');
  assert.match(parent.why, /Direct parent of Holding 2/);
  assert.ok(parent.findingId, 'attached to the finding that raised it');
  const second = s.questions.find((q) => q.entity?.value === '192.0.2.2');
  assert.ok(second, 'second address from the DNS finding');
  assert.match(second.text, /Who operates the server at 192\.0\.2\.2/);
  // Followed entities are not asked about again.
  assert.ok(!s.questions.some((q) => q.entity?.value === '192.0.2.1'));
});

test('following a question runs it in place and closes it', async () => {
  const inv = startInvestigation({ type: 'domain', value: 'example.org' }, () => {}, { sources: SOURCES, depth: 2, budget: 50 });
  await settle(inv);
  const n = inv.follow({ type: 'lei', value: 'L3', label: 'Holding 3' });
  assert.equal(n, 1);
  const s = await settle(inv);
  assert.ok(ran(s, 'leiF', 'L3'));
  const p = s.pivots.find((x) => x.entity.value === 'L3');
  assert.equal(p.status, 'followed');
  assert.equal(p.manual, true);
  assert.ok(!s.questions.some((q) => q.entity?.value === 'L3'));
  // Its own parent is one step further and held again.
  assert.equal(s.pivots.find((x) => x.entity.value === 'L4').held, 'depth');
  // Cross-checks are not duplicated when the investigation settles a second time.
  const titles = s.findings.map((f) => f.title);
  assert.equal(new Set(titles.filter((t, i) => s.findings[i].crossCheck)).size, titles.filter((t, i) => s.findings[i].crossCheck).length);
});

test('relations carry the request that produced them', async () => {
  const s = await settle(startInvestigation({ type: 'domain', value: 'example.org' }, () => {}, { sources: SOURCES }));
  const r = s.relations.find((x) => x.label === 'first A record');
  assert.equal(r.pivot, true);
  assert.equal(r.evidence.url, 'local:dns');
});

test('every source has a reliability grade with a reason', async () => {
  const { SOURCES } = await import('../public/src/sources/index.js');
  const { GRADES } = await import('../public/src/sources/reliability.js');
  for (const s of SOURCES) {
    assert.ok(GRADES[s.reliability], `${s.id} has no grade`);
    assert.notEqual(s.reliabilityWhy, 'Not graded', `${s.id} is not graded`);
  }
});
