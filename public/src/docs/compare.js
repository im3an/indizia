// Document comparison: exact duplicates (same SHA-256), near-duplicates and versions (SimHash over word
// shingles), and contradictions: statements that read almost the same in two documents but carry a
// different date, amount or number. Pure functions, no DOM.

import { extractDates, extractEntities } from './entities.js';

const words = (text) => (String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu) || []);

// 32-bit FNV-1a; two seeds give a 64-bit fingerprint without BigInt in the hot loop.
function fnv(s, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 64-bit SimHash as a 16-character hex string. Similar texts differ in few bits. */
export function simhash(text, k = 3) {
  const w = words(text);
  const v = new Int32Array(64);
  const n = Math.max(1, w.length - k + 1);
  for (let i = 0; i < n; i++) {
    const sh = w.slice(i, i + k).join(' ');
    const a = fnv(sh, 2166136261);
    const b = fnv(sh, 0x9747b28c);
    for (let bit = 0; bit < 32; bit++) {
      v[bit] += (a >>> bit) & 1 ? 1 : -1;
      v[bit + 32] += (b >>> bit) & 1 ? 1 : -1;
    }
  }
  let hi = 0;
  let lo = 0;
  for (let bit = 0; bit < 32; bit++) {
    if (v[bit] > 0) lo |= 1 << bit;
    if (v[bit + 32] > 0) hi |= 1 << bit;
  }
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}

export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i += 8) {
    let x = (parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0;
    while (x) {
      d += x & 1;
      x >>>= 1;
    }
  }
  return d;
}

/** Share of distinct words two texts have in common (Jaccard). */
export function jaccard(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Group documents into exact duplicates and near-duplicates.
 * @param {{id:string, name:string, sha256:string, simhash:string, words:number}[]} docs
 */
export function findDuplicates(docs, maxBits = 6) {
  const exact = new Map();
  for (const d of docs) exact.set(d.sha256, [...(exact.get(d.sha256) || []), d]);
  const pairs = [];
  const list = docs.filter((d) => d.simhash && d.words >= 30);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.sha256 === b.sha256) continue;
      const bits = hamming(a.simhash, b.simhash);
      if (bits <= maxBits) pairs.push({ a: a.id, b: b.id, bits, similarity: Math.round((1 - bits / 64) * 100) });
    }
  }
  return { exact: [...exact.values()].filter((g) => g.length > 1), near: pairs.sort((x, y) => x.bits - y.bits) };
}

const sentences = (text) =>
  String(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 25 && s.length <= 600);

const numbersIn = (s) => (s.match(/\d[\d.,]*\d|\d/g) || []).map((n) => n.replace(/[.,](?=\d{3}\b)/g, ''));

/**
 * Statements that read nearly the same in both texts but differ in a date or number.
 * @returns {{ a: string, b: string, similarity: number, kind: 'date'|'number', onlyA: string[], onlyB: string[] }[]}
 */
export function contradictions(textA, textB, { minSimilarity = 0.6, limit = 50 } = {}) {
  const sa = sentences(textA);
  const sb = sentences(textB);
  const setB = new Set(sb);
  const out = [];
  for (const a of sa) {
    if (setB.has(a)) continue; // identical in both
    const na = numbersIn(a);
    if (!na.length) continue;
    let best = null;
    for (const b of sb) {
      const nb = numbersIn(b);
      if (!nb.length) continue;
      const sim = jaccard(a.replace(/\d/g, ''), b.replace(/\d/g, ''));
      if (sim >= minSimilarity && (!best || sim > best.sim)) best = { b, sim, nb };
    }
    if (!best) continue;
    const onlyA = na.filter((n) => !best.nb.includes(n));
    const onlyB = best.nb.filter((n) => !na.includes(n));
    if (!onlyA.length && !onlyB.length) continue;
    const da = extractDates(a).map((d) => d.date);
    const db = extractDates(best.b).map((d) => d.date);
    const kind = da.join() !== db.join() && (da.length || db.length) ? 'date' : 'number';
    out.push({ a, b: best.b, similarity: Math.round(best.sim * 100), kind, onlyA: kind === 'date' ? da.filter((d) => !db.includes(d)) : onlyA, onlyB: kind === 'date' ? db.filter((d) => !da.includes(d)) : onlyB });
    if (out.length >= limit) break;
  }
  return out;
}

/** Entities in one document and not the other (organisations, domains, identifiers, amounts). */
export function entityDelta(textA, textB) {
  const key = (e) => `${e.type}:${e.value.toLowerCase()}`;
  const ea = extractEntities(textA);
  const eb = extractEntities(textB);
  const kb = new Set(eb.map(key));
  const ka = new Set(ea.map(key));
  const skip = new Set(['url']);
  return {
    onlyA: ea.filter((e) => !kb.has(key(e)) && !skip.has(e.type)),
    onlyB: eb.filter((e) => !ka.has(key(e)) && !skip.has(e.type)),
    shared: ea.filter((e) => kb.has(key(e)) && !skip.has(e.type)),
  };
}
