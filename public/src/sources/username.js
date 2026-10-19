// Username lens: presence signals only. A matching username on two sites does not prove one person.

import { SourceError, apiHealth } from '../http.js';
import { getSetting } from '../settings.js';

const PRESENCE_NOTE = 'Presence signal only: the same username can belong to different people.';
const BATCH = 25;
const PARALLEL = 8; // each batch waits for its slowest site, so more in flight = sooner results

export const whatsMyName = {
  id: 'whatsmyname',
  name: 'WhatsMyName',
  provider: 'WhatsMyName community dataset, checked by the Indizia API',
  homepage: 'https://github.com/WebBreacher/WhatsMyName',
  terms: 'https://github.com/WebBreacher/WhatsMyName/blob/main/LICENSE',
  licence: 'Site definitions CC BY-SA 4.0 (© Micah Hoffman). Adult, dating, health and political sites excluded',
  category: 'Username',
  accepts: ['username'],
  cors: false,

  async run(ctx) {
    const health = await apiHealth();
    if (!health.ok) throw new SourceError('needs_relay', 'Username checks run on the Indizia API, which this deployment does not have.');
    const username = ctx.entity.value;
    const { data } = await ctx.fetch('/api/username/sites', { timeout: 10000 });
    const sites = data.sites;
    const found = [];
    let checked = 0;
    let unknown = 0;
    ctx.progress(`0 of ${sites.length} sites checked`);

    const batches = [];
    for (let i = 0; i < sites.length; i += BATCH) batches.push(sites.slice(i, i + BATCH).map((s) => s.id));
    let next = 0;
    let firstEvidence = null;
    let finding = null;
    // Publish on the first hit and grow the finding with every batch, so results show while the sweep runs.
    const publish = (done) => {
      if (!found.length) return;
      const byCat = {};
      for (const f of found) (byCat[f.cat] ||= []).push(f);
      const patch = {
        title: done ? `“${username}” exists on ${found.length} sites` : `“${username}” found on ${found.length} sites so far`,
        detail: `${done ? '' : `Checking… ${checked} of ${sites.length} sites. `}${PRESENCE_NOTE} Categories: ${Object.entries(byCat).map(([c, l]) => `${c} ${l.length}`).join(', ')}.`,
        evidence: firstEvidence,
        links: [...found].sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ href: f.url, label: f.name, meta: f.cat })),
      };
      if (finding) ctx.update(finding, patch);
      else finding = ctx.finding({ ...patch, confidence: 'plausible', confidenceNote: PRESENCE_NOTE });
    };
    async function worker() {
      while (next < batches.length && !ctx.signal.aborted) {
        const ids = batches[next++];
        try {
          const { data: res, evidence } = await ctx.fetch('/api/username/check', { method: 'POST', body: { username, sites: ids }, timeout: 30000 });
          firstEvidence ||= evidence;
          for (const r of res.results) {
            if (r.status === 'found') found.push(r);
            if (r.status === 'unknown') unknown++;
          }
        } catch (err) {
          if (err.state === 'rate_limited') throw err;
          unknown += ids.length;
        }
        checked += ids.length;
        ctx.progress(`${checked} of ${sites.length} checked · ${found.length} found`);
        publish(false);
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    ctx.progress('');

    ctx.fact('Accounts', { label: 'Sites checked', value: `${sites.length}`, evidence: firstEvidence });
    ctx.fact('Accounts', { label: 'Username found on', value: `${found.length} sites`, evidence: firstEvidence });
    ctx.fact('Accounts', { label: 'Could not verify', value: `${unknown} sites (blocked, changed or timed out)`, evidence: firstEvidence, muted: true });
    if (!found.length) {
      ctx.note(`Not found on any of the ${sites.length - unknown} sites that answered clearly`);
      return;
    }
    publish(true);
    for (const f of found.slice(0, 40)) {
      ctx.relate(ctx.entity, { type: 'account', value: f.url, label: f.name }, 'username on');
    }
  },
};

export const github = {
  id: 'github',
  name: 'GitHub',
  provider: 'GitHub REST API',
  homepage: 'https://docs.github.com/en/rest/users/users',
  terms: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
  licence: '60 requests/hour without a token; add your own token in Settings for 5,000/hour',
  category: 'Username',
  accepts: ['username'],
  cors: true,

  async run(ctx) {
    const token = getSetting('githubToken');
    const { data, evidence } = await ctx.fetch(`https://api.github.com/users/${encodeURIComponent(ctx.entity.value)}`, {
      notFoundIsEmpty: true,
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const site = data.blog ? data.blog.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase() : null;
    ctx.fact('Accounts', { label: 'GitHub', value: `${data.type} · since ${data.created_at?.slice(0, 10)} · ${data.public_repos} public repos`, evidence, href: data.html_url });
    ctx.finding({
      title: `GitHub ${data.type === 'Organization' ? 'organisation' : 'account'} “${data.login}” since ${data.created_at?.slice(0, 10)}`,
      detail: [`${data.public_repos} public repositories`, `${data.followers} followers`, site && `website ${site}`, data.company && `company field “${data.company}”`].filter(Boolean).join(' · ') + '. Self-published profile fields; location and email are not shown.',
      confidence: 'plausible',
      confidenceNote: PRESENCE_NOTE,
      evidence,
      href: data.html_url,
      date: data.created_at,
      pivots: [site && { type: 'domain', value: site }, data.company && { type: 'organisation', value: data.company.replace(/^@/, '') }].filter(Boolean),
    });
    ctx.relate(ctx.entity, { type: 'account', value: data.html_url, label: 'GitHub' }, 'username on');
    if (site) ctx.relate({ type: 'account', value: data.html_url, label: 'GitHub' }, { type: 'domain', value: site }, 'links to');
  },
};

export const bluesky = {
  id: 'bluesky',
  name: 'Bluesky',
  provider: 'AT Protocol public AppView',
  homepage: 'https://docs.bsky.app/',
  terms: 'https://bsky.social/about/support/tos',
  licence: 'Public profile data via the open AT Protocol API',
  category: 'Username',
  accepts: ['username'],
  cors: true,

  async run(ctx) {
    const u = ctx.entity.value.toLowerCase();
    const actor = u.includes('.') ? u : `${u}.bsky.social`;
    let res;
    try {
      res = await ctx.fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`, { notFoundIsEmpty: true });
    } catch (err) {
      if (err.evidence?.status === 400) throw new SourceError('empty', `No Bluesky account ${actor}`, err.evidence);
      throw err;
    }
    const { data, evidence } = res;
    const href = `https://bsky.app/profile/${data.handle}`;
    ctx.fact('Accounts', { label: 'Bluesky', value: `@${data.handle} · since ${data.createdAt?.slice(0, 10)} · ${data.postsCount ?? 0} posts`, evidence, href });
    ctx.finding({
      title: `Bluesky account @${data.handle}${data.displayName ? ` (“${data.displayName}”)` : ''}`,
      detail: `${data.followersCount ?? 0} followers · ${data.postsCount ?? 0} posts. Handles that are domains are verified by DNS.`,
      confidence: data.handle.includes('.') && !data.handle.endsWith('.bsky.social') ? 'confirmed' : 'plausible',
      confidenceNote: PRESENCE_NOTE,
      evidence,
      href,
      date: data.createdAt,
      pivots: !data.handle.endsWith('.bsky.social') ? [{ type: 'domain', value: data.handle }] : [],
    });
    ctx.relate(ctx.entity, { type: 'account', value: href, label: 'Bluesky' }, 'username on');
  },
};
