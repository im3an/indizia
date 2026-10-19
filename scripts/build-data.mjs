// Rebuilds the bundled datasets from their upstream sources.
//  - WhatsMyName (CC BY-SA 4.0): username-check definitions → server/data/wmn-data.json
//  - OSINT Framework (MIT): tool registry → public/data/tools.json
// Run with `npm run data`. The outputs are committed so deployments never depend on GitHub.
import { writeFile, mkdir } from 'node:fs/promises';

const WMN_URL = 'https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json';
const ARF_URL = 'https://raw.githubusercontent.com/lockfale/OSINT-Framework/master/public/arf.json';

// Categories excluded on purpose: special-category data under GDPR Art. 9 (sex life, health, political
// opinions) and adult sites. A username hit there would itself reveal sensitive information.
const EXCLUDED_CATEGORIES = new Set(['xx NSFW xx', 'dating', 'health', 'political']);

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Indizia-data-build/0.2' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const wmn = await json(WMN_URL);
const sites = wmn.sites
  .filter((s) => !EXCLUDED_CATEGORIES.has(s.cat) && s.uri_check && !s.post_body)
  .map((s) => ({
    name: s.name,
    cat: s.cat,
    uri_check: s.uri_check,
    uri_pretty: s.uri_pretty,
    e_code: s.e_code,
    e_string: s.e_string,
    m_code: s.m_code,
    m_string: s.m_string,
    strip_bad_char: s.strip_bad_char,
    headers: s.headers,
    protection: s.protection,
  }));
await mkdir('server/data', { recursive: true });
await writeFile(
  'server/data/wmn-data.json',
  JSON.stringify({ license: wmn.license, source: WMN_URL, builtAt: new Date().toISOString(), excludedCategories: [...EXCLUDED_CATEGORIES], sites }),
);
console.log(`WhatsMyName: kept ${sites.length} of ${wmn.sites.length} sites`);

const arf = await json(ARF_URL);
const tools = [];
(function walk(node, path) {
  if (node.type === 'url' && node.url && !node.deprecated) {
    tools.push({
      n: node.name.replace(/\s*\((T|D|R|M)\)\s*/g, ' ').trim(),
      u: node.url,
      c: path.slice(1),
      d: node.description || '',
      b: node.bestFor || '',
      i: node.input || '',
      o: node.output || '',
      p: node.pricing || '',
      s: node.status || '',
      op: node.opsec || '',
      reg: !!node.registration,
      api: !!node.api,
      local: !!node.localInstall,
    });
  }
  for (const child of node.children || []) walk(child, [...path, node.name]);
})(arf, []);
await mkdir('public/data', { recursive: true });
await writeFile('public/data/tools.json', JSON.stringify({ source: 'OSINT Framework (MIT) — https://github.com/lockfale/OSINT-Framework', builtAt: new Date().toISOString(), tools }));
console.log(`OSINT Framework: ${tools.length} tools`);
