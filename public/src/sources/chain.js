// File hashes and public blockchains. No identity attribution: Indizia shows public ledger facts only.

export const hashlookup = {
  id: 'hashlookup',
  name: 'CIRCL hashlookup',
  provider: 'CIRCL (Luxembourg CERT)',
  homepage: 'https://hashlookup.circl.lu/',
  terms: 'https://www.circl.lu/services/hashlookup/',
  licence: 'Free public service. Known-software database (incl. NSRL); unknown ≠ malicious',
  category: 'Files',
  accepts: ['hash'],
  cors: false,

  async run(ctx) {
    const h = ctx.entity.value;
    const algo = { 32: 'md5', 40: 'sha1', 64: 'sha256' }[h.length];
    const { data, evidence } = await ctx.fetch(`https://hashlookup.circl.lu/lookup/${algo}/${h}`, { relay: true, notFoundIsEmpty: true });
    const name = data.FileName || data['FileName'] || '—';
    ctx.fact('File', { label: 'Known file', value: name, evidence });
    if (data.FileSize) ctx.fact('File', { label: 'Size', value: `${Number(data.FileSize).toLocaleString()} bytes`, evidence });
    if (data.source) ctx.fact('File', { label: 'Listed by', value: data.source, evidence });
    if (data['hashlookup:trust'] != null) ctx.fact('File', { label: 'Trust score', value: `${data['hashlookup:trust']} / 100`, evidence });
    ctx.finding({
      title: `Known file: ${name}`,
      detail: `Found in CIRCL's database of known software files${data.source ? ` (${data.source})` : ''}. This usually means a legitimate, distributed file.`,
      confidence: 'confirmed',
      evidence,
    });
  },
};

export const mempool = {
  id: 'mempool',
  name: 'mempool.space',
  provider: 'The Mempool Open Source Project',
  homepage: 'https://mempool.space/docs/api/rest',
  terms: 'https://mempool.space/terms-of-service',
  licence: 'Public Bitcoin ledger data; rate-limited',
  category: 'Blockchain',
  accepts: ['crypto'],
  cors: true,
  when: (e) => e.chain === 'Bitcoin',

  async run(ctx) {
    if (ctx.entity.chain !== 'Bitcoin') return ctx.note('Not a Bitcoin address');
    const { data, evidence } = await ctx.fetch(`https://mempool.space/api/address/${ctx.entity.value}`, { notFoundIsEmpty: true });
    const c = data.chain_stats;
    const btc = (sats) => `${(sats / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 })} BTC`;
    ctx.fact('Address', { label: 'Transactions', value: String(c.tx_count), evidence });
    ctx.fact('Address', { label: 'Received', value: btc(c.funded_txo_sum), evidence });
    ctx.fact('Address', { label: 'Balance', value: btc(c.funded_txo_sum - c.spent_txo_sum), evidence });
    ctx.finding({
      title: `${c.tx_count} transactions · ${btc(c.funded_txo_sum)} received · ${btc(c.funded_txo_sum - c.spent_txo_sum)} balance`,
      detail: 'Public ledger data. Nothing here identifies who controls the address.',
      confidence: 'confirmed',
      evidence,
      href: `https://mempool.space/address/${ctx.entity.value}`,
    });
  },
};

export const blockscout = {
  id: 'blockscout',
  name: 'Blockscout',
  provider: 'Blockscout (Ethereum mainnet)',
  homepage: 'https://docs.blockscout.com/devs/apis',
  terms: 'https://www.blockscout.com/terms',
  licence: 'Public Ethereum ledger data',
  category: 'Blockchain',
  accepts: ['crypto'],
  cors: true,
  when: (e) => e.chain === 'EVM',

  async run(ctx) {
    if (ctx.entity.chain !== 'EVM') return ctx.note('Not an EVM address');
    const base = `https://eth.blockscout.com/api/v2/addresses/${ctx.entity.value}`;
    const { data, evidence } = await ctx.fetch(base, { notFoundIsEmpty: true });
    let counters = null;
    try {
      counters = (await ctx.fetch(`${base}/counters`)).data;
    } catch {
      /* optional */
    }
    const eth = (Number(data.coin_balance || 0) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 6 });
    ctx.fact('Address', { label: 'Type', value: data.is_contract ? `Contract${data.name ? ` · ${data.name}` : ''}` : 'Externally owned account', evidence });
    ctx.fact('Address', { label: 'Balance', value: `${eth} ETH`, evidence });
    if (counters) ctx.fact('Address', { label: 'Transactions', value: Number(counters.transactions_count).toLocaleString(), evidence });
    if (data.ens_domain_name) ctx.fact('Address', { label: 'ENS name', value: data.ens_domain_name, evidence });
    ctx.finding({
      title: `${data.is_contract ? 'Contract' : 'Account'} with ${eth} ETH${data.ens_domain_name ? ` · ENS ${data.ens_domain_name}` : ''}`,
      detail: data.public_tags?.length ? `Public tags: ${data.public_tags.map((t) => t.display_name).join(', ')}.` : 'Public ledger data. Nothing here identifies who controls the address.',
      confidence: 'confirmed',
      evidence,
      href: `https://eth.blockscout.com/address/${ctx.entity.value}`,
    });
  },
};
