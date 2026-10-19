// Launch pads: prepared searches on external sites that Indizia does not (or may not) query itself.
// They are never counted as searched. `copy` means the site has no deep link: the query is copied, then the site opens.

const enc = encodeURIComponent;

export const LAUNCH_PADS = [
  // Web search
  { id: 'google-site', name: 'Google · site:', accepts: ['domain'], build: (e) => ({ href: `https://www.google.com/search?q=${enc('site:' + e.value)}` }) },
  { id: 'google-mentions', name: 'Google · mentions', accepts: ['domain', 'organisation'], build: (e) => ({ href: `https://www.google.com/search?q=${enc(e.type === 'domain' ? `"${e.value}" -site:${e.value}` : `"${e.value}"`)}` }) },
  { id: 'google-docs', name: 'Google · documents', accepts: ['domain'], build: (e) => ({ href: `https://www.google.com/search?q=${enc(`site:${e.value} (filetype:pdf OR filetype:docx OR filetype:xlsx)`)}` }) },
  { id: 'ddg', name: 'DuckDuckGo', accepts: ['domain', 'organisation', 'ip'], build: (e) => ({ href: `https://duckduckgo.com/?q=${enc(`"${e.value}"`)}` }) },
  { id: 'gnews', name: 'Google News', accepts: ['organisation'], build: (e) => ({ href: `https://news.google.com/search?q=${enc(`"${e.value}"`)}` }) },

  // Archives
  { id: 'wayback-ui', name: 'Wayback calendar', accepts: ['domain', 'url'], build: (e) => ({ href: `https://web.archive.org/web/*/${e.value}` }) },
  { id: 'archive-today', name: 'archive.today', accepts: ['domain', 'url'], build: (e) => ({ href: `https://archive.ph/${e.value}` }) },

  // Web & threat intel
  { id: 'urlscan', name: 'urlscan.io search', accepts: ['domain', 'ip'], build: (e) => ({ href: `https://urlscan.io/search/#${e.type === 'ip' ? 'ip' : 'domain'}:${enc(e.value)}` }) },
  { id: 'vt', name: 'VirusTotal', accepts: ['domain', 'ip', 'hash'], build: (e) => ({ href: `https://www.virustotal.com/gui/${{ domain: 'domain', ip: 'ip-address', hash: 'file' }[e.type]}/${enc(e.value)}` }) },
  { id: 'securitytrails', name: 'SecurityTrails', accepts: ['domain'], build: (e) => ({ href: `https://securitytrails.com/domain/${enc(e.value)}/dns` }) },
  { id: 'shodan', name: 'Shodan host', accepts: ['ip'], build: (e) => ({ href: `https://www.shodan.io/host/${enc(e.value)}` }) },
  { id: 'abuseipdb', name: 'AbuseIPDB', accepts: ['ip'], build: (e) => ({ href: `https://www.abuseipdb.com/check/${enc(e.value)}` }) },
  { id: 'greynoise', name: 'GreyNoise', accepts: ['ip'], build: (e) => ({ href: `https://viz.greynoise.io/ip/${enc(e.value)}` }) },
  { id: 'bgphe-ip', name: 'Hurricane Electric BGP', accepts: ['ip', 'asn'], build: (e) => ({ href: e.type === 'asn' ? `https://bgp.he.net/${e.value.toUpperCase()}` : `https://bgp.he.net/ip/${enc(e.value)}` }) },
  { id: 'bgptools', name: 'bgp.tools', accepts: ['asn'], build: (e) => ({ href: `https://bgp.tools/as/${e.value.replace(/^AS/i, '')}` }) },
  { id: 'peeringdb', name: 'PeeringDB', accepts: ['asn'], build: (e) => ({ href: `https://www.peeringdb.com/asn/${e.value.replace(/^AS/i, '')}` }) },

  // Companies
  { id: 'handelsregister', name: 'Handelsregister', note: 'No API; ≤ 60 retrievals/hour', accepts: ['organisation', 'lei'], build: (e, s) => ({ href: 'https://www.handelsregister.de/', copy: s?.registerNumber || e.label || e.value }) },
  { id: 'unternehmensregister', name: 'Unternehmensregister', accepts: ['organisation', 'lei'], build: (e, s) => ({ href: 'https://www.unternehmensregister.de/', copy: s?.legalName || e.value }) },
  { id: 'northdata', name: 'North Data', accepts: ['organisation', 'lei'], build: (e, s) => ({ href: 'https://www.northdata.com/', copy: s?.legalName || e.value }) },
  { id: 'opencorporates', name: 'OpenCorporates', accepts: ['organisation', 'lei'], build: (e, s) => ({ href: `https://opencorporates.com/companies?q=${enc(s?.legalName || e.value)}` }) },
  { id: 'gleif-search', name: 'GLEIF search', accepts: ['organisation'], build: (e) => ({ href: `https://search.gleif.org/#/search/simpleSearch=${enc(e.value)}` }) },
  { id: 'gleif-record', name: 'GLEIF record', accepts: ['lei'], build: (e) => ({ href: `https://search.gleif.org/#/record/${e.value}` }) },
  { id: 'icij', name: 'ICIJ Offshore Leaks', accepts: ['organisation'], build: (e) => ({ href: `https://offshoreleaks.icij.org/search?q=${enc(e.value)}` }) },
  { id: 'opensanctions', name: 'OpenSanctions', accepts: ['organisation', 'lei'], build: (e, s) => ({ href: `https://www.opensanctions.org/search/?q=${enc(s?.legalName || e.value)}` }) },
  { id: 'wikipedia', name: 'Wikipedia', accepts: ['organisation'], build: (e) => ({ href: `https://en.wikipedia.org/w/index.php?search=${enc(e.value)}` }) },

  // Usernames
  { id: 'wmn-web', name: 'WhatsMyName web', accepts: ['username'], build: (e) => ({ href: `https://whatsmyname.app/?q=${enc(e.value)}` }) },
  { id: 'instantusername', name: 'Instant Username', accepts: ['username'], build: (e) => ({ href: `https://instantusername.com/?q=${enc(e.value)}` }) },
  { id: 'google-user', name: 'Google · exact handle', accepts: ['username'], build: (e) => ({ href: `https://www.google.com/search?q=${enc(`"${e.value}"`)}` }) },
  { id: 'crtsh-web', name: 'crt.sh', accepts: ['domain'], build: (e) => ({ href: `https://crt.sh/?q=${enc('%.' + e.value)}` }) },

  // Images (upload there yourself; Indizia never uploads your file)
  { id: 'lens', name: 'Google Lens', note: 'upload the image there', accepts: ['file'], when: (e) => /^image\//.test(e.file?.type || ''), build: () => ({ href: 'https://lens.google.com/' }) },
  { id: 'tineye', name: 'TinEye', note: 'upload the image there', accepts: ['file'], when: (e) => /^image\//.test(e.file?.type || ''), build: () => ({ href: 'https://tineye.com/' }) },
  { id: 'bing-visual', name: 'Bing Visual Search', note: 'upload the image there', accepts: ['file'], when: (e) => /^image\//.test(e.file?.type || ''), build: () => ({ href: 'https://www.bing.com/visualsearch' }) },
  { id: 'yandex-img', name: 'Yandex Images', note: 'upload the image there', accepts: ['file'], when: (e) => /^image\//.test(e.file?.type || ''), build: () => ({ href: 'https://yandex.com/images/' }) },
  { id: 'fotoforensics', name: 'FotoForensics', note: 'error-level analysis', accepts: ['file'], when: (e) => /^image\//.test(e.file?.type || ''), build: () => ({ href: 'https://fotoforensics.com/' }) },

  // Other types
  { id: 'doi', name: 'doi.org', accepts: ['doi'], build: (e) => ({ href: `https://doi.org/${e.value}` }) },
  { id: 'openalex-doi', name: 'OpenAlex', accepts: ['doi'], build: (e) => ({ href: `https://api.openalex.org/works/doi:${e.value}` }) },
  { id: 'malwarebazaar', name: 'MalwareBazaar', accepts: ['hash'], build: (e) => ({ href: `https://bazaar.abuse.ch/browse.php?search=${enc(`${{ 32: 'md5', 40: 'sha1', 64: 'sha256' }[e.value.length]}:${e.value}`)}` }) },
  { id: 'mempool', name: 'mempool.space', accepts: ['crypto'], when: (e) => e.chain === 'Bitcoin', build: (e) => ({ href: `https://mempool.space/address/${e.value}` }) },
  { id: 'etherscan', name: 'Etherscan', accepts: ['crypto'], when: (e) => e.chain === 'EVM', build: (e) => ({ href: `https://etherscan.io/address/${e.value}` }) },
  { id: 'osm', name: 'OpenStreetMap', accepts: ['coordinates'], build: (e) => { const [lat, lon] = e.value.split(/,\s*/); return { href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}` }; } },
  { id: 'gmaps', name: 'Google Maps', accepts: ['coordinates'], build: (e) => ({ href: `https://www.google.com/maps/search/?api=1&query=${enc(e.value.replace(/\s/g, ''))}` }) },
  { id: 'bellingcat', name: 'Bellingcat toolkit', accepts: ['question'], build: () => ({ href: 'https://bellingcat.gitbook.io/toolkit' }) },
  { id: 'osintframework', name: 'OSINT Framework', accepts: ['question'], build: () => ({ href: 'https://osintframework.com/' }) },
];

export function launchPadsFor(entity, shared = {}) {
  return LAUNCH_PADS.filter((p) => p.accepts.includes(entity.type) && (!p.when || p.when(entity))).map((p) => ({
    id: p.id,
    name: p.name,
    note: p.note,
    ...p.build(entity, shared),
  }));
}
