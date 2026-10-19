import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPage, diffPages, versionsFromCdx, pickVersions, maskEmail, maskPhone, summariseChanges, describeChange } from '../public/src/history.js';

const OLD = `<!doctype html><html lang="de"><head><title>Muster Shop – Werkzeug</title>
<meta name="generator" content="WordPress 4.9"><meta property="og:site_name" content="Muster Shop">
<link rel="icon" href="/favicon.ico"><link rel="canonical" href="https://muster-shop.de/">
<script>gtag('config', 'UA-1234567-1');</script></head><body>
<img src="/img/logo-2017.png" alt="Muster Logo">
<a href="mailto:info@muster-shop.de">Kontakt</a> <a href="mailto:max.mustermann@muster-shop.de">Max</a>
<a href="tel:+49 30 1234567">Anrufen</a> <a href="/impressum">Impressum</a>
<a href="https://www.facebook.com/mustershop">Facebook</a>
<p>Werkzeug und Zubehör seit 1990</p><footer>© 2017 Muster Handels GmbH</footer></body></html>`;

const NEW = `<!doctype html><html lang="de"><head><title>Muster Shop – Werkzeug online</title>
<meta name="generator" content="Shopify"><meta property="og:site_name" content="Muster Shop">
<link rel="icon" href="/favicon.ico"><link rel="canonical" href="https://muster-shop.de/">
<script>gtag('config', 'G-ABCDEF1234');</script></head><body>
<img src="/assets/logo.svg" class="site-logo">
<a href="mailto:info@muster-shop.de">Kontakt</a> <a href="mailto:support@helpdesk-partner.com">Support</a>
<a href="tel:+49 40 9876543">Anrufen</a> <a href="/impressum">Impressum</a>
<p>Werkzeug und Zubehör online kaufen</p><footer>© 2023 Muster Retail Ltd.</footer></body></html>`;

test('extracts branding, contacts, trackers and organisations from an archived page', () => {
  const p = extractPage(OLD, 'http://muster-shop.de/');
  assert.equal(p.title, 'Muster Shop – Werkzeug');
  assert.equal(p.generator, 'WordPress 4.9');
  assert.equal(p.logo, '/img/logo-2017.png');
  assert.equal(p.favicon, '/favicon.ico');
  assert.deepEqual(p.trackers, [{ type: 'Google Analytics (UA)', id: 'UA-1234567' }]);
  assert.deepEqual(p.social, [{ network: 'Facebook', handle: 'mustershop' }]);
  assert.ok(p.imprint);
  assert.ok(p.orgs.includes('Muster Handels GmbH'), p.orgs.join(' | '));
  // Role address readable, personal address masked, phone masked.
  assert.deepEqual(p.emails.map((e) => e.shown).sort(), ['info@muster-shop.de', 'm•••@muster-shop.de']);
  assert.equal(p.phones[0].shown, '+4930 ••• 67');
  assert.ok(!JSON.stringify(p).includes('Max Mustermann'));
});

test('diffs two captures into readable changes', () => {
  const a = extractPage(OLD, 'http://muster-shop.de/');
  const b = extractPage(NEW, 'https://muster-shop.de/');
  const { changes, similarity } = diffPages(a, b);
  const lines = changes.map(describeChange);
  assert.ok(lines.some((l) => l.startsWith('Page title:')), lines.join('\n'));
  assert.ok(lines.includes('Logo file: “/img/logo-2017.png” → “/assets/logo.svg”'));
  assert.ok(lines.includes('Website software: “WordPress 4.9” → “Shopify”'));
  assert.ok(lines.includes('Contact email added: “s•••@helpdesk-partner.com”') || lines.includes('Contact email added: “support@helpdesk-partner.com”'));
  assert.ok(lines.includes('Tracking ID removed: “Google Analytics (UA) UA-1234567”'));
  assert.ok(lines.some((l) => l.startsWith('Phone number added')));
  assert.ok(lines.includes('Organisation named added: “Muster Retail Ltd.”'), lines.join('\n'));
  assert.ok(!changes.some((c) => c.field === 'siteName'), 'unchanged site name is not reported');
  assert.ok(similarity > 0 && similarity < 1);
  assert.match(summariseChanges(changes), /changed$/);
});

test('a copyright year moving on is not a change', () => {
  const a = extractPage('<footer>© 2019 Beispiel GmbH</footer>', 'https://x.de/');
  const b = extractPage('<footer>© 2020 Beispiel GmbH</footer>', 'https://x.de/');
  assert.ok(!diffPages(a, b).changes.some((c) => c.field === 'copyright'));
});

test('CDX months collapse into content versions, and picks span the history', () => {
  const rows = [
    ['20150101000000', 'http://a.de/', 'A'], ['20150201000000', 'http://a.de/', 'A'], ['20160101000000', 'http://a.de/', 'B'],
    ['20170101000000', 'http://a.de/', 'C'], ['20180101000000', 'http://a.de/', 'D'], ['20190101000000', 'http://a.de/', 'E'],
    ['20200101000000', 'http://a.de/', 'F'], ['20240101000000', 'http://a.de/', 'G'],
  ];
  const v = versionsFromCdx(rows);
  assert.equal(v.length, 7);
  assert.equal(v[0].lastTs, '20150201000000');
  const p = pickVersions(v, 4);
  assert.equal(p.length, 4);
  assert.equal(p[0].digest, 'A');
  assert.equal(p.at(-1).digest, 'G');
  assert.deepEqual([...p].sort((x, y) => x.ts.localeCompare(y.ts)), p);
});

test('masking keeps enough to notice a change', () => {
  assert.equal(maskEmail('kontakt@firma.de'), 'kontakt@firma.de');
  assert.equal(maskEmail('jane.doe@firma.de'), 'j•••@firma.de');
  assert.equal(maskPhone('+493012345678'), '+4930 ••• 78');
});

test('organisation names drop leading years, articles and navigation words', () => {
  const p = extractPage('<footer>Kontakt Deutschlands Die Beispiel Druck GmbH · © 2019–2023 Muster AG</footer><a href="/de/impressum">Impressum</a>', 'https://x.de/start');
  assert.ok(p.orgs.includes('Beispiel Druck GmbH'), p.orgs.join(' | '));
  assert.ok(p.orgs.includes('Muster AG'), p.orgs.join(' | '));
  assert.equal(p.imprintUrl, 'https://x.de/de/impressum');
});

test('footer menu words are not part of a company name; a year added to the copyright is no change', () => {
  const p = extractPage('<footer>Service-Portal Support Kundenportal Muster Druck GmbH</footer>', 'https://x.de/');
  assert.deepEqual(p.orgs, ['Muster Druck GmbH']);
  const a = extractPage('<footer>© Muster GmbH</footer>', 'https://x.de/');
  const b = extractPage('<footer>© 2021 | Muster GmbH</footer>', 'https://x.de/');
  assert.ok(!diffPages(a, b).changes.some((c) => c.field === 'copyright'));
});
