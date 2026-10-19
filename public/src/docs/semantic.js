// Search by meaning: pages are split into chunks and embedded with a local model (Ollama, through
// /api/ai/embed on this computer). A query is embedded the same way and pages are ranked by cosine
// similarity, fused with the word ranking. Only available where the local AI bridge exists.

import { updateDoc } from './store.js';

const LOCAL = { 'X-Indizia-Local': '1', 'Content-Type': 'application/json' };
const CHUNK = 900;
let status = null;

export async function aiStatus(refresh = false) {
  if (status && !refresh) return status;
  status = (async () => {
    try {
      const h = await (await fetch('/api/health', { cache: 'no-store' })).json();
      if (!h.ai) return { available: false, reason: 'This deployment has no local AI bridge' };
      const s = await (await fetch('/api/ai/status', { cache: 'no-store', headers: { 'X-Indizia-Local': '1' } })).json();
      return s;
    } catch {
      return { available: false, reason: 'Local AI unavailable' };
    }
  })();
  return status;
}

export async function semanticStatus() {
  const s = await aiStatus();
  return { available: !!s.embedModel, model: s.embedModel || null };
}

async function embed(texts) {
  const r = await fetch('/api/ai/embed', { method: 'POST', headers: LOCAL, body: JSON.stringify({ input: texts }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

export function chunks(pages) {
  const out = [];
  for (const p of pages) {
    const t = p.text || '';
    for (let i = 0; i < t.length; i += CHUNK) {
      const s = t.slice(i, i + CHUNK + 100).trim();
      if (s.length > 40) out.push({ n: p.n, start: i, text: s });
    }
  }
  return out;
}

const norm = (v) => {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  return Float32Array.from(v, (x) => x / s);
};
export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Embed every chunk of a document (once per model) and store the vectors with it. */
export async function embedDoc(doc) {
  const { model } = await semanticStatus();
  if (!model) throw new Error('no embedding model');
  if (doc.embeddings?.model === model) return doc;
  const list = chunks(doc.pages).slice(0, 600);
  const vectors = [];
  for (let i = 0; i < list.length; i += 16) {
    const r = await embed(list.slice(i, i + 16).map((c) => c.text));
    vectors.push(...r.embeddings.map(norm));
  }
  return updateDoc(doc.id, (d) => (d.embeddings = { model, chunks: list.map((c, i) => ({ n: c.n, start: c.start, vec: vectors[i] })) }), 'embedded', `${list.length} chunks with ${model}`);
}

/**
 * A ranker for searchDocs(): adds pages that are close in meaning and fuses both rankings
 * (reciprocal rank fusion, k = 60). Documents without embeddings keep their word ranking.
 */
export function semanticRanker(docs, q) {
  return async (hits, parsed) => {
    const text = [...parsed.any.flat(), ...parsed.phrases].join(' ') || q;
    if (!text.trim()) return hits;
    let qv;
    try {
      qv = norm((await embed([text])).embeddings[0]);
    } catch {
      return hits;
    }
    const best = new Map();
    for (const d of docs) {
      for (const c of d.embeddings?.chunks || []) {
        const s = cosine(qv, c.vec);
        const id = `${d.id}#${c.n}`;
        if (!best.has(id) || best.get(id) < s) best.set(id, s);
      }
    }
    const semRank = [...best.entries()].filter(([, s]) => s > 0.45).sort((a, b) => b[1] - a[1]).slice(0, 100);
    const fused = new Map();
    hits.forEach((h, i) => fused.set(h.id, { ...h, score: 1 / (60 + i) }));
    semRank.forEach(([id, s], i) => {
      const cur = fused.get(id) || { id, score: 0, match: {}, terms: [], queryTerms: [] };
      cur.score += 1 / (60 + i);
      cur.semantic = s;
      fused.set(id, cur);
    });
    return [...fused.values()].sort((a, b) => b.score - a.score);
  };
}
