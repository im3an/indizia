import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lookups, summarise } from '../public/src/sources/vulns.js';

test('only mapped products with a real version are looked up, at most three', () => {
  const l = lookups([{ name: 'nginx', version: '1.18.0' }, { name: 'nginx', version: '1.20.1' }, { name: 'PHP', version: '8' }, { name: 'Cloudflare' }, { name: 'WordPress', version: '6.4.3' }, { name: 'jQuery', version: '3.6.0' }, { name: 'Apache', version: '2.4.57' }]);
  assert.deepEqual(l.map((x) => x.match), ['cpe:2.3:a:f5:nginx:1.18.0', 'cpe:2.3:a:wordpress:wordpress:6.4.3', 'cpe:2.3:a:jquery:jquery:3.6.0']);
});

test('NVD response (recorded, nginx 1.18.0): KEV first, then by CVSS', async () => {
  const nvd = JSON.parse(await readFile(new URL('./fixtures/nvd-nginx-1.18.0.json', import.meta.url), 'utf8'));
  const list = summarise(nvd, new Set(['CVE-2023-44487']));
  assert.equal(list.length, nvd.totalResults);
  assert.equal(list[0].id, 'CVE-2023-44487');
  assert.equal(list[0].kev, true);
  const rest = list.slice(1).map((c) => c.score ?? -1);
  assert.deepEqual(rest, [...rest].sort((a, b) => b - a));
  assert.ok(list.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.published) && c.text.length > 10));
});
