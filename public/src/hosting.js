// Infrastructure classification: who runs an IP block or a name server, and how widely it is shared.
// Link analysis uses this to discount shared infrastructure: two sites behind Cloudflare prove nothing,
// two sites on the same small dedicated server are a real lead.

/** [pattern on the AS holder / org name, provider, kind]. Kind: cdn, cloud, hosting, saas, isp. */
const PROVIDERS = [
  [/cloudflare/i, 'Cloudflare', 'cdn'],
  [/akamai|linode/i, 'Akamai', 'cdn'],
  [/fastly/i, 'Fastly', 'cdn'],
  [/incapsula|imperva/i, 'Imperva', 'cdn'],
  [/sucuri/i, 'Sucuri', 'cdn'],
  [/cdn77|datacamp/i, 'CDN77 / DataCamp', 'cdn'],
  [/bunny/i, 'bunny.net', 'cdn'],
  [/edgecast|edgio|limelight/i, 'Edgio', 'cdn'],
  [/vercel/i, 'Vercel', 'cdn'],
  [/netlify/i, 'Netlify', 'cdn'],
  [/github/i, 'GitHub', 'cdn'],
  [/amazon|aws\b/i, 'Amazon Web Services', 'cloud'],
  [/google/i, 'Google Cloud', 'cloud'],
  [/microsoft|azure/i, 'Microsoft Azure', 'cloud'],
  [/oracle/i, 'Oracle Cloud', 'cloud'],
  [/alibaba|aliyun/i, 'Alibaba Cloud', 'cloud'],
  [/tencent/i, 'Tencent Cloud', 'cloud'],
  [/digitalocean/i, 'DigitalOcean', 'cloud'],
  [/vultr|choopa/i, 'Vultr', 'cloud'],
  [/scaleway|online s\.?a\.?s/i, 'Scaleway', 'cloud'],
  [/hetzner/i, 'Hetzner', 'hosting'],
  [/\bovh/i, 'OVHcloud', 'hosting'],
  [/contabo/i, 'Contabo', 'hosting'],
  [/ionos|1&1|1and1/i, 'IONOS', 'hosting'],
  [/strato/i, 'STRATO', 'hosting'],
  [/hosteurope|host europe/i, 'Host Europe', 'hosting'],
  [/netcup/i, 'netcup', 'hosting'],
  [/all-inkl|neue medien muennich/i, 'ALL-INKL', 'hosting'],
  [/leaseweb/i, 'Leaseweb', 'hosting'],
  [/godaddy|go daddy/i, 'GoDaddy', 'hosting'],
  [/namecheap/i, 'Namecheap', 'hosting'],
  [/hostinger/i, 'Hostinger', 'hosting'],
  [/bluehost|unified layer|newfold|endurance/i, 'Newfold Digital', 'hosting'],
  [/automattic/i, 'Automattic (WordPress.com)', 'saas'],
  [/shopify/i, 'Shopify', 'saas'],
  [/squarespace/i, 'Squarespace', 'saas'],
  [/wix\.com|\bwix\b/i, 'Wix', 'saas'],
  [/hubspot/i, 'HubSpot', 'saas'],
  [/deutsche telekom|telekom deutschland/i, 'Deutsche Telekom', 'isp'],
  [/vodafone/i, 'Vodafone', 'isp'],
  [/telefonica|o2 /i, 'Telefónica', 'isp'],
  [/comcast/i, 'Comcast', 'isp'],
];

/** Name-server domains used by very many unrelated customers. */
const MASS_NS = [
  ['cloudflare.com', 'Cloudflare'], ['awsdns', 'Amazon Route 53'], ['azure-dns', 'Azure DNS'], ['googledomains.com', 'Google Domains'],
  ['google.com', 'Google'], ['domaincontrol.com', 'GoDaddy'], ['registrar-servers.com', 'Namecheap'], ['ui-dns', 'IONOS'],
  ['hetzner.com', 'Hetzner'], ['hetzner.de', 'Hetzner'], ['second-ns', 'Hetzner'], ['ovh.net', 'OVHcloud'], ['ovh.ca', 'OVHcloud'],
  ['nsone.net', 'NS1'], ['dynect.net', 'Oracle Dyn'], ['ultradns', 'UltraDNS'], ['akam.net', 'Akamai'], ['netlify', 'Netlify'],
  ['vercel-dns.com', 'Vercel'], ['wixdns.net', 'Wix'], ['squarespacedns.com', 'Squarespace'], ['shopify.com', 'Shopify'],
  ['wordpress.com', 'WordPress.com'], ['digitalocean.com', 'DigitalOcean'], ['linode.com', 'Akamai'], ['strato.de', 'STRATO'],
  ['kasserver.com', 'ALL-INKL'], ['inwx', 'INWX'], ['netcup.net', 'netcup'], ['hostinger', 'Hostinger'], ['bluehost.com', 'Bluehost'],
  ['dnsmadeeasy.com', 'DNS Made Easy'], ['he.net', 'Hurricane Electric'], ['afraid.org', 'FreeDNS'], ['namebrightdns.com', 'NameBright'],
  ['name-services.com', 'Enom'], ['worldnic.com', 'Network Solutions'], ['gandi.net', 'Gandi'], ['dns.jp', 'JPRS'],
];

/** Mail exchangers run for many unrelated customers. */
const MASS_MX = [
  ['google.com', 'Google Workspace'], ['googlemail.com', 'Google Workspace'], ['outlook.com', 'Microsoft 365'], ['protection.outlook.com', 'Microsoft 365'],
  ['pphosted.com', 'Proofpoint'], ['mimecast', 'Mimecast'], ['messagelabs.com', 'Broadcom'], ['zoho', 'Zoho Mail'],
  ['protonmail.ch', 'Proton Mail'], ['icloud.com', 'iCloud'], ['yandex', 'Yandex'], ['ionos', 'IONOS'], ['kundenserver.de', 'IONOS'],
  ['secureserver.net', 'GoDaddy'], ['mailgun.org', 'Mailgun'], ['sendgrid.net', 'SendGrid'], ['amazonaws.com', 'Amazon SES'],
  ['strato.de', 'STRATO'], ['hornetsecurity.com', 'Hornetsecurity'], ['web.de', 'WEB.DE'], ['gmx.net', 'GMX'], ['kasserver.com', 'ALL-INKL'],
];

/** Classify an AS holder or organisation name. */
export function classifyHosting(name) {
  if (!name) return null;
  for (const [re, provider, kind] of PROVIDERS) if (re.test(name)) return { provider, kind };
  return null;
}

/** True when the kind of provider puts unrelated customers on the same addresses. */
export const isSharedKind = (kind) => kind === 'cdn' || kind === 'saas' || kind === 'cloud';

const matchList = (list, host) => {
  const h = String(host || '').toLowerCase();
  const hit = list.find(([needle]) => h.includes(needle));
  return hit ? hit[1] : null;
};

/** The managed DNS provider behind a name server host, or null for a dedicated / self-run one. */
export const massNameServer = (host) => matchList(MASS_NS, host);
/** The hosted mail provider behind an MX host, or null. */
export const massMailProvider = (host) => matchList(MASS_MX, host);

// Common two-label public suffixes. Enough to get the registrable domain right for the sites Indizia sees most.
const TWO_LABEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au', 'co.nz', 'org.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'co.kr', 'or.kr', 'com.br', 'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'com.tw', 'com.hk', 'com.sg',
  'co.in', 'net.in', 'org.in', 'co.za', 'com.mx', 'com.ar', 'com.tr', 'com.ua', 'co.il', 'gv.at', 'co.at', 'or.at', 'com.pl', 'com.es',
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'azurewebsites.net', 'cloudfront.net',
  'blogspot.com', 'wordpress.com', 'appspot.com', 'firebaseapp.com', 'web.app', 'myshopify.com', 'wixsite.com', 'squarespace.com',
]);

/** example.co.uk for www.shop.example.co.uk. Hosting suffixes (github.io, …) count as public suffixes. */
export function registrableDomain(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '').replace(/^\*\./, '');
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  const last2 = labels.slice(-2).join('.');
  return TWO_LABEL.has(last2) ? labels.slice(-3).join('.') : last2;
}

/** True for addresses that are not on the public internet (RFC 1918, loopback, link-local, CGNAT, ULA …). */
export function isPrivateIp(ip) {
  const v = String(ip || '').toLowerCase();
  if (v.includes(':')) {
    return v === '::1' || v === '::' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('::ffff:') || v.startsWith('64:ff9b:') || v.startsWith('2001:db8');
  }
  const p = v.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}
