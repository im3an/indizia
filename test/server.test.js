import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, RELAY_ALLOWLIST } from '../server/api.mjs';
import { evaluate, profileUrl, siteId } from '../server/username.mjs';

const req = (path, init) => new Request(`http://localhost${path}`, init);

test('non-API paths fall through to static assets', async () => {
  assert.equal(await handleApi(req('/index.html')), null);
});

test('health reports relay hosts and username sites', async () => {
  const res = await handleApi(req('/api/health'));
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.usernameSites > 500);
  assert.deepEqual(body.relay, [...RELAY_ALLOWLIST]);
});

test('relay refuses hosts that are not allowlisted', async () => {
  const res = await handleApi(req(`/api/relay?url=${encodeURIComponent('https://example.com/')}`));
  assert.equal(res.status, 403);
});

test('relay refuses plain http and junk URLs', async () => {
  assert.equal((await handleApi(req(`/api/relay?url=${encodeURIComponent('http://crt.sh/?q=x')}`))).status, 403);
  assert.equal((await handleApi(req('/api/relay?url=not-a-url'))).status, 400);
});

test('relay only allows POST for search APIs that need it', async () => {
  const res = await handleApi(req(`/api/relay?url=${encodeURIComponent('https://crt.sh/?q=x')}`, { method: 'POST', body: '{}' }));
  assert.equal(res.status, 405);
});

test('username check validates input and ignores unknown site ids', async () => {
  const bad = await handleApi(req('/api/username/check', { method: 'POST', body: JSON.stringify({ username: 'a b', sites: [] }) }));
  assert.equal(bad.status, 400);
  const ok = await handleApi(req('/api/username/check', { method: 'POST', body: JSON.stringify({ username: 'someone', sites: ['does-not-exist'] }) }));
  assert.deepEqual((await ok.json()).results, []);
});

test('sensitive categories are excluded from the bundled site list', async () => {
  const res = await handleApi(req('/api/username/sites'));
  const { sites, excludedCategories } = await res.json();
  for (const cat of ['xx NSFW xx', 'dating', 'health', 'political']) {
    assert.ok(excludedCategories.includes(cat));
    assert.ok(!sites.some((s) => s.cat === cat), `found a ${cat} site`);
  }
});

test('WhatsMyName rule: found, missing, unknown', () => {
  const site = { e_code: 200, e_string: 'profile-header', m_code: 404, m_string: 'Not Found' };
  assert.equal(evaluate(site, 200, '<div class="profile-header">'), 'found');
  assert.equal(evaluate(site, 404, '<h1>Not Found</h1>'), 'missing');
  assert.equal(evaluate(site, 403, 'Access denied'), 'unknown');
  assert.equal(evaluate(site, 200, 'a login wall'), 'unknown');
});

test('profile URLs encode the username and strip configured characters', () => {
  const site = { name: 'Example Site', uri_check: 'https://ex.com/u/{account}', uri_pretty: 'https://ex.com/@{account}', strip_bad_char: '.' };
  assert.deepEqual(profileUrl(site, 'jane.doe'), { check: 'https://ex.com/u/janedoe', pretty: 'https://ex.com/@janedoe' });
  assert.equal(siteId(site), 'example-site');
});

test('a platform rate limiter can refuse; one that errors fails open', async () => {
  const path = `/api/relay?url=${encodeURIComponent('https://example.com/')}`;
  const seen = [];
  const refuse = { limit: async ({ key }) => (seen.push(key), { success: false }) };
  const broken = { limit: async () => { throw new Error('binding unavailable'); } };
  const headers = { 'cf-connecting-ip': '203.0.113.7' };
  assert.equal((await handleApi(req(path, { headers }), { limiters: { relay: refuse } })).status, 429);
  assert.deepEqual(seen, ['203.0.113.7']);
  assert.equal((await handleApi(req(path, { headers }), { limiters: { relay: broken } })).status, 403); // reached the allowlist check
});
