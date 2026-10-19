import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, matchText, inRange, fieldOk, tokenize } from '../public/src/query.js';
import { parseCsv, parseEmail } from '../public/src/docs/extract.js';
import { identify } from '../public/src/docs/signature.js';
import { tokenize as indexTokens, snippet } from '../public/src/docs/search.js';

test('query language: terms, phrases, exclusions, OR groups, filters, dates', () => {
  const p = parse('acme "supply agreement" -draft invoice OR rechnung type:pdf -status:irrelevant after:2020-01 before:2021');
  assert.deepEqual(p.any, [['acme'], ['invoice', 'rechnung']]);
  assert.deepEqual(p.phrases, ['supply agreement']);
  assert.deepEqual(p.not, ['draft']);
  assert.deepEqual(p.filters, { type: ['pdf'], '-status': ['irrelevant'] });
  assert.equal(p.after, '2020-01');
  assert.equal(p.before, '2021');
  assert.deepEqual(tokenize('a "b c" -"d e"'), ['a', '"b c"', '-"d e"']);
  assert.equal(parse('https://example.com/x').any[0][0], 'https://example.com/x', 'URLs are terms, not filters');
});

test('query language: matching text, ranges and fields', () => {
  const p = parse('acme "two instalments" -draft fee OR betrag');
  assert.ok(matchText(p, 'ACME pays the fee in two instalments'));
  assert.ok(!matchText(p, 'ACME draft: fee in two instalments'));
  assert.ok(!matchText(p, 'ACME fee in three instalments'));
  assert.ok(matchText(parse('münchen'), 'Sitz in Munchen'), 'diacritics are folded');
  assert.ok(inRange(parse('after:2020-01 before:2021'), '2021-12-31'));
  assert.ok(!inRange(parse('after:2020-01'), '2019-12-31'));
  assert.ok(!inRange(parse('after:2020'), null), 'a range excludes undated records');
  assert.ok(fieldOk(parse('type:pdf'), 'type', ['PDF document']));
  assert.ok(!fieldOk(parse('-status:irrelevant'), 'status', 'irrelevant'));
});

test('CSV: quotes, embedded delimiters and newlines, delimiter detection', () => {
  const { delim, rows } = parseCsv('name;city\n"Acme; Ltd";"Berlin\nMitte"\n"He said ""hi""";Köln\n');
  assert.equal(delim, ';');
  assert.deepEqual(rows, [['name', 'city'], ['Acme; Ltd', 'Berlin\nMitte'], ['He said "hi"', 'Köln']]);
});

test('email: headers, folded lines, multipart, quoted-printable, attachments', () => {
  const raw = [
    'From: "A" <a@example.org>', 'To: b@example.net', 'Subject: Hello', ' world', 'Date: Tue, 13 Apr 2021 09:12:00 +0200',
    'Received: from x', 'Received: from y', 'Content-Type: multipart/mixed; boundary="XX"', '',
    '--XX', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', 'Gr=C3=BC=C3=9Fe aus K=C3=B6ln =', 'nach Berlin',
    '--XX', 'Content-Type: application/pdf; name="offer.pdf"', 'Content-Disposition: attachment; filename="offer.pdf"', 'Content-Transfer-Encoding: base64', '', 'JVBERi0=',
    '--XX--', '',
  ].join('\r\n');
  const m = parseEmail(raw);
  assert.equal(m.headers.subject, 'Hello world');
  assert.equal(m.headers.received, 2);
  assert.equal(m.text.trim(), 'Grüße aus Köln nach Berlin');
  assert.deepEqual(m.attachments, ['offer.pdf']);
});

test('file signatures: real type wins over the name; executables in disguise are flagged', () => {
  const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  assert.equal(identify(bytes('%PDF-1.7'), 'a.pdf').matches, true);
  const exe = identify(bytes('MZ\x90\x00'), 'invoice.pdf');
  assert.equal(exe.kind, 'exe');
  assert.match(exe.warning, /disguise/);
  assert.equal(identify(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'photo.jpg').warning, 'The name ends in .jpg, but the content is a PNG image.');
  assert.equal(identify(bytes('plain words here'), 'notes.txt').kind, 'text');
  assert.equal(identify(bytes('\x00\x00\x00\x18ftypmp42'), 'clip.mp4').kind, 'mp4');
});

test('search tokens: compounds are indexed whole and in parts; snippets are escaped', () => {
  assert.deepEqual(indexTokens('Mail procurement@bundesdruckerei.de now'), ['mail', 'procurement@bundesdruckerei.de', 'procurement', 'bundesdruckerei', 'de', 'now']);
  assert.ok(indexTokens('Grüße aus München').includes('münchen'));
  const s = snippet('<b>Acme</b> pays the fee', ['fee']);
  assert.ok(s.includes('&lt;b&gt;') && s.includes('<mark>fee</mark>'));
});

test('findings filter: fields, grades, dates and text', async () => {
  const { parse, findingMatches } = await import('../public/src/findquery.js');
  const f = { title: '34 subdomains resolve to 12 addresses', detail: 'From HackerTarget', confidence: 'confirmed', date: '2021-05-01', source: { id: 'hackertarget', name: 'HackerTarget host search', reliability: 'C' }, entity: { type: 'domain', value: 'acme.de' }, list: ['mail.acme.de → 192.0.2.1'] };
  const m = (q) => findingMatches(f, parse(q));
  assert.ok(m(''));
  assert.ok(m('mail.acme.de source:hackertarget conf:confirmed'));
  assert.ok(m('grade:abc') && !m('grade:ab') && !m('-grade:c'));
  assert.ok(m('type:domain entity:acme after:2021') && !m('before:2020'));
  assert.ok(!m('-subdomains') && m('certificates OR subdomains') && !m('"12 subdomains"'));
});
