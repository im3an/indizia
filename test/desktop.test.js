import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { TOOLS, validateRun, runArgs, localGuard } from '../server/toolbox.mjs';
import { createHandler } from '../server/app.mjs';
import { timesketchJsonl } from '../public/src/timeline.js';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));

test('toolbox runs only accept domains, and host lists stay inside the target', () => {
  assert.match(validateRun({ tool: 'nuclei', target: 'example.com' }).error, /unknown tool/);
  assert.match(validateRun({ tool: 'subfinder', target: '-oJ /etc/passwd' }).error, /domain/);
  assert.match(validateRun({ tool: 'subfinder', target: '10.0.0.1' }).error, /domain/);
  const v = validateRun({ tool: 'httpx', target: 'Example.com', hosts: ['a.example.com', 'evil.com', 'notexample.com', 'example.com', 'a.example.com'] });
  assert.deepEqual(v.hosts, ['a.example.com', 'example.com']);
  assert.match(validateRun({ tool: 'dnsx', target: 'example.com', hosts: ['evil.com'] }).error, /no valid hosts/);
  assert.equal(validateRun({ tool: 'httpx', target: 'example.com', hosts: Array.from({ length: 500 }, (_, i) => `h${i}.example.com`) }).hosts.length, TOOLS.httpx.maxHosts);
});

test('every tool container is unprivileged, read-only, pinned and removed on exit', () => {
  for (const id of Object.keys(TOOLS)) {
    const args = runArgs(id, { target: 'example.com' }, 'n');
    for (const flag of ['--rm', '--read-only', '--cap-drop', 'no-new-privileges', '--pids-limit', '--memory', '--user', '65534:65534']) assert.ok(args.includes(flag), `${id} lacks ${flag}`);
    assert.match(TOOLS[id].image, /:v\d+\.\d+\.\d+$/, `${id} image is not pinned`);
    assert.ok(!args.includes('--privileged') && !args.some((a) => a.includes('docker.sock')));
  }
});

test('tool output parsers keep in-scope hosts and merge sources', () => {
  const sf = TOOLS.subfinder.parse([
    '{"host":"a.example.com","sources":["crtsh"]}',
    '{"host":"a.example.com","sources":["wayback"]}',
    '{"host":"*.b.example.com","sources":["crtsh"]}',
    '{"host":"evil.com","sources":["x"]}',
    '{"host":"trunc',
  ].join('\n'), { target: 'example.com' });
  assert.deepEqual(sf, [{ host: 'a.example.com', sources: ['crtsh', 'wayback'] }, { host: 'b.example.com', sources: ['crtsh'] }]);
  const dx = TOOLS.dnsx.parse('{"host":"a.example.com","status_code":"NOERROR","a":["192.0.2.1"],"cname":["x.cdn.net"]}\n');
  assert.deepEqual(dx, [{ host: 'a.example.com', status: 'NOERROR', a: ['192.0.2.1'], aaaa: [], cname: ['x.cdn.net'] }]);
  const hx = TOOLS.httpx.parse('{"url":"https://a.example.com","input":"a.example.com","status_code":200,"title":"Hi","tech":["nginx"],"host_ip":"192.0.2.1"}\n');
  assert.equal(hx[0].status, 200);
  assert.deepEqual(hx[0].tech, ['nginx']);
});

test('local guard refuses rebinding hosts, other origins and header-less writes', () => {
  const r = (url, init) => new Request(url, init);
  assert.equal(localGuard(r('http://evil.example:5173/api/toolbox')).status, 403);
  assert.equal(localGuard(r('http://127.0.0.1:5173/api/toolbox', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal(localGuard(r('http://127.0.0.1:5173/api/toolbox/run', { method: 'POST', body: '{}' })).status, 403);
  assert.equal(localGuard(r('http://127.0.0.1:5173/api/toolbox/run', { method: 'POST', body: '{}', headers: { 'x-indizia-local': '1', origin: 'http://127.0.0.1:5173' } })), null);
  assert.equal(localGuard(r('http://localhost:5173/api/toolbox')), null);
});

test('handler: toolbox routes exist only when enabled; pages get security headers', async () => {
  const web = createHandler({ root: ROOT });
  assert.equal((await web(new Request('http://localhost/api/toolbox'))).status, 404);
  const page = await web(new Request('http://localhost/'));
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(await page.text(), /data-desktop/);
  const health = await (await web(new Request('http://localhost/api/health'))).json();
  assert.equal(health.toolbox, false);
});

test('handler: desktop pages are marked so the download button never shows in the app', async () => {
  const h = createHandler({ root: ROOT, desktop: { version: '0.3.0', platform: 'darwin' } });
  assert.match(await (await h(new Request('sherlock://app/'))).text(), /<html lang="en" data-desktop="darwin">/);
  assert.equal((await h(new Request('sherlock://app/../server/api.mjs'))).headers.get('content-type'), 'text/html; charset=utf-8'); // app shell, not the file
});

test('handler: network routes wait for a starting container, and fall back when it failed', async () => {
  let state = 'starting';
  let up = null;
  const engine = {
    upstream: () => up,
    status: () => ({ mode: up ? 'container' : 'built-in', preferred: 'container', state }),
    ready: async () => {
      state = 'error'; // the container did not come up
    },
  };
  const h = createHandler({ root: ROOT, engine });
  // Not on the allowlist, so the in-process relay refuses without any network request.
  const r = await h(new Request(`sherlock://app/api/relay?url=${encodeURIComponent('https://example.com/')}`));
  assert.equal(state, 'error', 'waited for the start to finish');
  assert.equal(r.status, 403, 'answered by the built-in engine after the failed start');
  up = 'http://127.0.0.1:9'; // a port nothing listens on: forwarded, and reported as unavailable
  assert.equal((await h(new Request('sherlock://app/api/icon?host=example.com'))).status, 502);
});

test('Timesketch export has the three required fields per line', () => {
  const out = timesketchJsonl([{ kind: 'event', date: '2020-05-01', title: 'Registered', source: 'RDAP' }, { kind: 'event', date: 'bogus', title: 'x' }], 'example.com');
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].message, lines[0].datetime, lines[0].timestamp_desc], ['Registered', '2020-05-01T00:00:00.000Z', 'Date stated by source']);
  assert.equal(lines[0].date_precision, 'day');
});
