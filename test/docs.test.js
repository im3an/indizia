import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEntities, extractDates, validLei, validIban, maskIban, entityQuery } from '../public/src/docs/entities.js';
import { simhash, hamming, findDuplicates, contradictions, entityDelta, jaccard } from '../public/src/docs/compare.js';

const TEXT = `Vertrag zwischen der Bundesdruckerei GmbH (HRB 63218, USt-IdNr. DE814236234) und Acme Holdings Ltd.
Unterzeichnet am 05.03.2021 in Berlin. Kontakt: info@bundesdruckerei.de, siehe https://www.bundesdruckerei.de/impressum.
The agreement starts on 1 April 2021 and the fee is EUR 1.250.000,00. Payment to DE89 3704 0044 0532 0130 00.
LEI 529900T8BM49AURSDO55 (GLEIF). Server 193.28.64.55, hash d2a84f4b8b650937ec8f73cd8be2c74add5a911ba64df27458ed8229da804a26.
Location 52.5163, 13.3777. Ref CVE-2021-44228. Invalid date 31.02.2021 and invalid LEI 529900T8BM49AURSDO56.`;

test('entities: validated identifiers, organisations by legal form, derived domains', () => {
  const es = extractEntities(TEXT);
  const has = (type, value) => es.some((e) => e.type === type && e.value === value);
  assert.ok(has('org', 'Bundesdruckerei GmbH'), 'German GmbH');
  assert.ok(has('org', 'Acme Holdings Ltd.'), 'English Ltd.');
  assert.ok(has('register', 'HRB 63218'));
  assert.ok(has('vat', 'DE814236234'));
  assert.ok(has('email', 'info@bundesdruckerei.de'));
  assert.ok(has('domain', 'bundesdruckerei.de'));
  assert.ok(has('lei', '529900T8BM49AURSDO55'));
  assert.ok(!has('lei', '529900T8BM49AURSDO56'), 'bad check digits are rejected');
  assert.ok(has('iban', 'DE89370400440532013000'));
  assert.equal(es.find((e) => e.type === 'iban').display, 'DE89 •••• 3000');
  assert.ok(has('ipv4', '193.28.64.55'));
  assert.ok(has('sha256', 'd2a84f4b8b650937ec8f73cd8be2c74add5a911ba64df27458ed8229da804a26'));
  assert.ok(!es.some((e) => e.type === 'sha1' || e.type === 'md5'), 'no partial hashes inside the SHA-256');
  assert.ok(has('coordinates', '52.5163, 13.3777'));
  assert.ok(has('cve', 'CVE-2021-44228'));
  assert.ok(es.some((e) => e.type === 'money' && e.value.startsWith('EUR 1.250.000')));
  assert.match(es.find((e) => e.type === 'register').context, /Bundesdruckerei GmbH/);
});

test('entities: no person names, and searchable types map to queries', () => {
  const es = extractEntities('Geschäftsführer: Max Mustermann. Contact Jane Doe for details.');
  assert.deepEqual(es, []);
  assert.equal(entityQuery({ type: 'org', value: 'Acme Ltd' }), 'org:Acme Ltd');
  assert.equal(entityQuery({ type: 'iban', value: 'DE89…' }), null);
  assert.equal(entityQuery({ type: 'email', value: 'a@b.de' }), null);
});

test('checksums: LEI and IBAN mod 97', () => {
  assert.ok(validLei('529900T8BM49AURSDO55'));
  assert.ok(!validLei('529900T8BM49AURSDO50'));
  assert.ok(validIban('GB82 WEST 1234 5698 7654 32'));
  assert.ok(!validIban('GB82 WEST 1234 5698 7654 33'));
  assert.equal(maskIban('GB82WEST12345698765432'), 'GB82 •••• 5432');
});

test('dates: ISO, German, English long forms, month-year; impossible dates dropped', () => {
  const ds = extractDates('Am 05.03.2021 und am 5. März 2021, then March 7, 2021, on 2020-12-31, in Oktober 2019, never on 31.02.2021.');
  assert.deepEqual(ds.map((d) => d.date), ['2021-03-05', '2021-03-05', '2021-03-07', '2020-12-31', '2019-10']);
  assert.match(ds[0].context, /^Am 05\.03\.2021/);
});

test('simhash: near-identical texts are close, unrelated ones far apart', () => {
  const a = 'The company was founded in 1998 in Berlin and moved its headquarters to Munich in 2012 after a merger with a regional printer. '.repeat(3);
  const b = a.replace('Munich', 'Hamburg');
  const c = 'Quarterly revenue grew by twelve percent while operating costs fell, according to the annual report published on the investor site. '.repeat(3);
  assert.ok(hamming(simhash(a), simhash(b)) <= 12);
  assert.ok(hamming(simhash(a), simhash(c)) > 16);
  assert.equal(hamming(simhash(a), simhash(a)), 0);
  const words = a.split(/\s+/).length;
  const d = findDuplicates([
    { id: '1', name: 'a', sha256: 'x', simhash: simhash(a), words },
    { id: '2', name: 'a copy', sha256: 'x', simhash: simhash(a), words },
    { id: '3', name: 'b', sha256: 'y', simhash: simhash(b), words },
    { id: '4', name: 'c', sha256: 'z', simhash: simhash(c), words },
  ], 12);
  assert.equal(d.exact.length, 1);
  assert.ok(d.near.some((p) => p.a === '1' && p.b === '3'));
  assert.ok(!d.near.some((p) => p.b === '4'));
});

test('contradictions: same statement, different date or amount', () => {
  const A = 'The supplier contract was signed on 05.03.2021 by both parties in Berlin. The total fee is EUR 250,000 payable in two instalments.';
  const B = 'The supplier contract was signed on 12.04.2021 by both parties in Berlin. The total fee is EUR 275,000 payable in two instalments.';
  const c = contradictions(A, B);
  assert.equal(c.length, 2);
  assert.equal(c[0].kind, 'date');
  assert.deepEqual([c[0].onlyA, c[0].onlyB], [['2021-03-05'], ['2021-04-12']]);
  assert.equal(c[1].kind, 'number');
  assert.deepEqual([c[1].onlyA, c[1].onlyB], [['250000'], ['275000']]);
  assert.deepEqual(contradictions(A, A), []);
  assert.ok(jaccard('a b c', 'a b d') > 0.4);
});

test('entity delta between two documents', () => {
  const d = entityDelta('Acme Holdings Ltd. at acme.example.com', 'Acme Holdings Ltd. and Beta Systems GmbH');
  assert.ok(d.shared.some((e) => e.value === 'Acme Holdings Ltd.'));
  assert.ok(d.onlyB.some((e) => e.value === 'Beta Systems GmbH'));
});

test('organisations: headings and reference numbers are not part of the name', () => {
  const v = (t) => extractEntities(t).filter((e) => e.type === 'org').map((e) => e.value);
  assert.deepEqual(v('INVOICE 2021-117 Bundesdruckerei GmbH'), ['Bundesdruckerei GmbH']);
  assert.deepEqual(v('Supply agreement between Acme Holdings Ltd. and 3M Deutschland GmbH'), ['Acme Holdings Ltd.', '3M Deutschland GmbH']);
  assert.deepEqual(v('Vertrag zwischen der Muster Druck GmbH'), ['Muster Druck GmbH']);
});

test('organisations: joined runs are split, compound legal forms are kept whole', () => {
  const v = extractEntities('Acme Holdings Ltd. and Beta Systems GmbH, Gamma Druck AG & Co. KG und Delta Logistik GmbH & Co. KG').filter((e) => e.type === 'org').map((e) => e.value);
  assert.deepEqual(v, ['Acme Holdings Ltd.', 'Beta Systems GmbH', 'Gamma Druck AG & Co. KG', 'Delta Logistik GmbH & Co. KG']);
});

test('media: dHash/aHash from grayscale grids, subtitles', async () => {
  const { dhashFromGray, ahashFromGray, parseSubtitles } = await import('../public/src/docs/media.js');
  const ramp = Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 20); // every pixel brighter than its right neighbour
  assert.equal(dhashFromGray(ramp), 'ffffffffffffffff');
  assert.equal(dhashFromGray(ramp.map((v, i) => (i % 9) * 20)), '0000000000000000');
  const half = Array.from({ length: 64 }, (_, i) => (i < 32 ? 10 : 200));
  assert.equal(ahashFromGray(half), 'ffffffff00000000');
  const cues = parseSubtitles('1\n00:00:01,500 --> 00:00:03,000\nHello <i>there</i>\n\n2\n00:01:02,000 --> 00:01:04,250\nSecond line\nwraps');
  assert.deepEqual(cues, [{ start: 1.5, end: 3, text: 'Hello there' }, { start: 62, end: 64.25, text: 'Second line wraps' }]);
  assert.equal(parseSubtitles('WEBVTT\n\n00:05.000 --> 00:07.000\nVTT cue').length, 1);
});
