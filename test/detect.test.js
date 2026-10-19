import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect, isValidLei } from '../public/src/detect.js';

const cases = [
  ['bundesdruckerei.de', 'domain', 'bundesdruckerei.de'],
  ['www.Example.COM', 'domain', 'example.com'],
  ['https://www.gleif.org/en/about', 'url'],
  ['185.12.64.1', 'ip'],
  ['2a01:4f8::1', 'ip'],
  ['AS3320', 'asn', 'AS3320'],
  ['as 24940', 'asn', 'AS24940'],
  ['5299003SM8UFIFLLDS18', 'lei'],
  ['jane@firma.de', 'email'],
  ['@janedoe', 'username', 'janedoe'],
  ['+49 30 2589 0', 'phone'],
  ['52.5163, 13.3777', 'coordinates'],
  ['10.1038/s41586-020-2649-2', 'doi'],
  ['44d88612fea8a8f36de82e1278abb02f', 'hash'],
  ['0x52908400098527886E0F7030069857D2E4169EE7', 'crypto'],
  ['bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'crypto'],
  ['how do I geolocate a photo', 'question'],
  ['who runs bundesdruckerei.de?', 'objective'],
  ['Is 193.28.64.55 linked to bundesdruckerei.de', 'objective'],
  ['brief: Acme GmbH and acme.de', 'objective'],
  ['what is OSINT anyway', 'question'],
  ['IS Holdings GmbH', 'organisation'],
  ['Deutsche Bahn', 'organisation', 'Deutsche Bahn'],
  ['org: bundesdruckerei.de', 'organisation', 'bundesdruckerei.de'],
  ['domain:example.org', 'domain', 'example.org'],
];

for (const [input, type, value] of cases) {
  test(`detects ${input} as ${type}`, () => {
    const e = detect(input);
    assert.equal(e.type, type);
    if (value) assert.equal(e.value, value);
  });
}

test('empty input yields null', () => {
  assert.equal(detect('   '), null);
});

test('LEI checksum (ISO 17442)', () => {
  assert.equal(isValidLei('5299003SM8UFIFLLDS18'), true);
  assert.equal(isValidLei('529900W18LQJJN6SJ336'), true);
  assert.equal(isValidLei('5299003SM8UFIFLLDS19'), false);
});

test('URL keeps its host for the domain pivot', () => {
  assert.equal(detect('https://www.gleif.org/en/about').host, 'gleif.org');
});
