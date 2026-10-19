import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listEntries, readEntry } from '../public/src/zip.js';
import { searchTools } from '../public/src/tools.js';

test('ZIP reader lists and inflates Office document parts', async () => {
  const buf = (await readFile(new URL('./fixtures/sample.docx', import.meta.url))).buffer;
  const entries = listEntries(buf);
  const names = entries.map((e) => e.name);
  assert.ok(names.includes('docProps/core.xml'));
  const core = await readEntry(buf, entries.find((e) => e.name === 'docProps/core.xml'));
  assert.match(core, /<dc:creator>Max Muster<\/dc:creator>/);
});

test('ZIP reader rejects non-ZIP data', () => {
  assert.throws(() => listEntries(new TextEncoder().encode('%PDF-1.7 not a zip file at all').buffer), /Not a ZIP/);
});

test('tool search ranks on-topic tools first', async () => {
  const { tools } = JSON.parse(await readFile(new URL('../public/data/tools.json', import.meta.url), 'utf8'));
  const names = (q) => searchTools(tools, q, { limit: 5 }).map((t) => t.n.toLowerCase());
  assert.ok(names('reverse image search').some((n) => /tineye|reverse image|yandex|bing|google/.test(n)));
  assert.ok(names('ship tracking').some((n) => /vessel|ship|marine/.test(n)));
  assert.ok(searchTools(tools, '', { type: 'domain', limit: 10 }).every((t) => t.c[0] === 'Domain Name' || /domain|url/i.test(t.i)));
});
