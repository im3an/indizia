import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canWatch, newWatch, nextDue, isDue, dueWatches, countWatches, coolingDown, updateCooldowns, watchDiff, hasChange, noAnswer, describeDiff, INTERVALS, RETRY_AFTER, COOLDOWN } from '../public/src/workspace/watch.js';

const T0 = Date.parse('2026-10-01T08:00:00Z');
const iso = (t) => new Date(t).toISOString();
const DAY = INTERVALS.daily;
const F = (source, title) => ({ source, title });
const L = (source, state, sourceId = source.toLowerCase()) => ({ source, sourceId, state });
const snap = (findings, ledger) => ({ root: { type: 'domain', value: 'example.com' }, findings, ledger, facts: {}, startedAt: iso(T0), finishedAt: iso(T0 + 5000) });

test('restricted lenses, files and questions can never be watched', () => {
  for (const t of ['username', 'email', 'phone', 'file', 'question', 'objective', undefined]) assert.equal(canWatch(t), false, t);
  for (const t of ['domain', 'ip', 'asn', 'lei', 'organisation', 'url']) assert.equal(canWatch(t), true, t);
});

test('a new watch counts the saved snapshot as its first check', () => {
  const w = newWatch({ snapshot: { finishedAt: iso(T0) } }, 'weekly', T0 + 1000);
  assert.equal(w.interval, 'weekly');
  assert.equal(w.lastCheck, iso(T0));
  assert.equal(nextDue(w), T0 + INTERVALS.weekly);
  assert.equal(newWatch({ snapshot: {} }, 'hourly', T0).interval, 'daily', 'unknown intervals fall back to daily');
});

test('due dates: one interval after the last check, retry wins only after a failed run', () => {
  const w = { interval: 'daily', since: iso(T0), lastCheck: iso(T0) };
  assert.equal(nextDue(w), T0 + DAY);
  assert.equal(isDue(w, T0 + DAY - 1), false);
  assert.equal(isDue(w, T0 + DAY), true);
  // Missed several days (app closed): due once, not once per missed day.
  assert.equal(isDue(w, T0 + 5 * DAY), true);
  // Failed run at T0+DAY: retry in an hour, not immediately on the next tick.
  const failed = { ...w, retryAt: iso(T0 + DAY + RETRY_AFTER) };
  assert.equal(isDue(failed, T0 + DAY + 60_000), false);
  assert.equal(isDue(failed, T0 + DAY + RETRY_AFTER), true);
  // No lastCheck yet: counts from when the watch started.
  assert.equal(nextDue({ interval: 'weekly', since: iso(T0) }), T0 + INTERVALS.weekly);
  assert.ok(Number.isNaN(nextDue(null)) && Number.isNaN(nextDue({ interval: 'hourly', since: iso(T0) })));
});

test('dueWatches lists due watches oldest first and skips closed cases and restricted lenses', () => {
  const inv = (id, type, lastCheck, interval = 'daily') => ({ id, query: id, snapshot: { root: { type, value: id } }, watch: { interval, since: lastCheck, lastCheck } });
  const cases = [
    { id: 'c1', name: 'A', status: 'open', investigations: [inv('a.com', 'domain', iso(T0)), inv('b.com', 'domain', iso(T0 - DAY)), inv('weekly.com', 'domain', iso(T0), 'weekly'), { id: 'x', query: 'x', snapshot: { root: { type: 'domain' } } }] },
    { id: 'c2', name: 'B', status: 'open', investigations: [inv('alice@example.com', 'email', iso(T0 - 9 * DAY)), inv('jdoe', 'username', iso(T0 - 9 * DAY))] },
    { id: 'c3', name: 'C', status: 'closed', investigations: [inv('closed.com', 'domain', iso(T0 - 9 * DAY))] },
  ];
  const due = dueWatches(cases, T0 + DAY);
  assert.deepEqual(due.map((d) => d.query), ['b.com', 'a.com']);
  assert.equal(due[0].caseId, 'c1');
  assert.equal(countWatches(cases), 3, 'restricted and closed ones do not count');
});

test('source cooldowns: a rate-limited source sits out, expired ones drop off', () => {
  let map = updateCooldowns({}, [L('Shodan', 'rate_limited', 'shodan'), L('RDAP', 'done', 'rdap')], T0);
  assert.deepEqual([...coolingDown(map, T0 + 1000)], ['shodan']);
  assert.equal(coolingDown(map, T0 + COOLDOWN + 1).size, 0);
  map = updateCooldowns(map, [L('OTX', 'rate_limited', 'otx')], T0 + COOLDOWN + 1);
  assert.deepEqual(Object.keys(map), ['otx']);
});

test('watch diff: new and gone findings when every source answered', () => {
  const before = snap([F('RDAP', 'Registered 2001'), F('crt.sh', '12 certificates'), F('DNS', 'MX mail.example.com')], [L('RDAP', 'done'), L('crt.sh', 'done'), L('DNS', 'done')]);
  const after = snap([F('RDAP', 'Registered 2001'), F('crt.sh', '14 certificates'), F('DNS', 'MX mx2.example.com')], [L('RDAP', 'done'), L('crt.sh', 'done'), L('DNS', 'done')]);
  const d = watchDiff(before, after);
  assert.equal(d.grown.length, 1);
  assert.deepEqual(d.added.map((f) => f.title), ['MX mx2.example.com']);
  assert.deepEqual(d.removed.map((f) => f.title), ['MX mail.example.com']);
  assert.equal(d.carry.length, 0);
  assert.ok(hasChange(d));
  assert.equal(describeDiff(d), '1 new, 1 gone, 1 changed');
});

test('watch diff: a source that failed or sat out does not make its findings "gone"', () => {
  const before = snap([F('RDAP', 'Registered 2001'), F('Shodan', 'Port 443 open'), F('Cross-check', 'Two sources agree')], [L('RDAP', 'done'), L('Shodan', 'done')]);
  // Shodan rate-limited; next time it is left out of the run entirely (cooldown).
  const rateLimited = snap([F('RDAP', 'Registered 2001')], [L('RDAP', 'done'), L('Shodan', 'rate_limited')]);
  const d1 = watchDiff(before, rateLimited);
  assert.equal(d1.removed.length, 0, 'a cross-check that lost one of its sources is not "gone" either');
  assert.deepEqual(d1.carry.map((f) => f.title), ['Port 443 open', 'Two sources agree']);
  assert.deepEqual(d1.unanswered, ['Shodan']);
  const skipped = snap([F('RDAP', 'Registered 2001')], [L('RDAP', 'done')]);
  const d2 = watchDiff(rateLimited, skipped, d1.carry);
  assert.ok(!hasChange(d2));
  assert.equal(d2.carry.length, 2, 'still carried while the source sits out');
  // Shodan answers again with the same finding: no false "new".
  const back = snap([F('RDAP', 'Registered 2001'), F('Shodan', 'Port 443 open'), F('Cross-check', 'Two sources agree')], [L('RDAP', 'done'), L('Shodan', 'done')]);
  const d3 = watchDiff(skipped, back, d2.carry);
  assert.ok(!hasChange(d3));
  assert.equal(d3.carry.length, 0);
  // Shodan answers with nothing: now the finding is really gone.
  const empty = snap([F('RDAP', 'Registered 2001')], [L('RDAP', 'done'), L('Shodan', 'empty')]);
  assert.deepEqual(watchDiff(skipped, empty, d2.carry).removed.map((f) => f.title), ['Port 443 open', 'Two sources agree']);
});

test('a run where no source answered says nothing', () => {
  assert.ok(noAnswer(snap([], [L('RDAP', 'failed'), L('DNS', 'timeout')])));
  assert.ok(!noAnswer(snap([], [L('RDAP', 'empty')])));
});
