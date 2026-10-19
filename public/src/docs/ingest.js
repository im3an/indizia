// Batch intake for the document workspace: extract → entities and dated statements per page → fingerprints
// → category → store. Files are processed one at a time (OCR is heavy), a failure stops only that file,
// and the batch can be cancelled between files. Nothing is uploaded.

import { extractDocument } from './extract.js';
import { extractEntities, extractDates } from './entities.js';
import { simhash } from './compare.js';
import { newDocRecord, putDoc, listDocs } from './store.js';

const CATEGORIES = [
  ['Contract', /\b(agreement|contract|vertrag|vereinbarung|parties|vertragspartner|hereby agree|kündigung)\b/gi],
  ['Invoice / financial', /\b(invoice|rechnung|amount due|betrag|iban|vat|ust-?id|balance sheet|bilanz|jahresabschluss|revenue|umsatz)\b/gi],
  ['Legal / court', /\b(court|gericht|judgment|urteil|beschluss|plaintiff|kläger|beklagte|defendant|az\.|aktenzeichen|case no)\b/gi],
  ['Corporate register', /\b(handelsregister|commercial register|hrb|hra|registered office|sitz der gesellschaft|geschäftsführer|director|articles of association|satzung)\b/gi],
  ['Procurement', /\b(tender|ausschreibung|vergabe|procurement|lot|los|award|zuschlag|bidder|bieter)\b/gi],
  ['Report / publication', /\b(report|bericht|abstract|introduction|einleitung|conclusion|fazit|methodology|references|quellen)\b/gi],
  ['Correspondence', /\b(dear|sehr geehrte|regards|grüßen|subject:|betreff|from:|to:)\b/gi],
  ['Technical', /\b(server|dns|ip address|api|config|stack trace|http|tls|certificate|log)\b/gi],
];

/** The most likely category, with the words that decided it. */
export function categorise(text, label) {
  if (/Email/.test(label)) return { category: 'Correspondence', because: 'email message' };
  if (/Excel|CSV/.test(label)) return { category: 'Spreadsheet / data', because: label };
  const sample = text.slice(0, 60_000);
  let best = null;
  for (const [name, re] of CATEGORIES) {
    const hits = sample.match(re) || [];
    if (hits.length >= 3 && (!best || hits.length > best.n)) best = { name, n: hits.length, words: [...new Set(hits.map((h) => h.toLowerCase()))].slice(0, 4) };
  }
  return best ? { category: best.name, because: best.words.join(', ') } : { category: 'Uncategorised', because: '' };
}

/** Values a case's searches already found (roots and graph entities), lower-cased, for relevance scoring. */
export function caseEntityValues(c) {
  const set = new Set();
  for (const inv of c?.investigations || []) {
    if (inv.root?.value) set.add(String(inv.root.value).toLowerCase());
    for (const r of inv.snapshot?.relations || []) for (const e of [r.from, r.to]) if (e?.value && e.type !== 'person-name') set.add(String(e.value).toLowerCase());
  }
  return set;
}

/** How strongly a document ties into the case: shared entities with the case's own searches. */
export function relevance(entities, known) {
  const shared = entities.filter((e) => known.has(e.value.toLowerCase()) || (e.type === 'org' && [...known].some((k) => k.length > 4 && e.value.toLowerCase().startsWith(k))));
  const score = Math.min(100, shared.reduce((n, e) => n + Math.min(5, e.count) * (['lei', 'domain', 'ipv4', 'vat', 'register'].includes(e.type) ? 8 : 5), 0));
  return { score, shared: shared.slice(0, 12).map((e) => e.value) };
}

/** Entities and dated statements with page references. */
export function derive(extracted, known = new Set()) {
  const entities = extractEntities(extracted.text);
  const pageOf = new Map();
  for (const p of extracted.pages) for (const e of extractEntities(p.text)) pageOf.set(`${e.type}:${e.value}`, [...(pageOf.get(`${e.type}:${e.value}`) || []), p.n]);
  for (const e of entities) e.pages = [...new Set(pageOf.get(`${e.type}:${e.value}`) || [])].slice(0, 30);
  const dates = extracted.pages.flatMap((p) => extractDates(p.text).map((d) => ({ ...d, page: p.n, pageLabel: p.label || null }))).slice(0, 2000);
  const words = (extracted.text.match(/[\p{L}\p{N}]+/gu) || []).length;
  return { entities: entities.slice(0, 1500), dates, simhash: simhash(extracted.text), words, ...categorise(extracted.text, extracted.label), relevance: relevance(entities, known) };
}

/**
 * Process files into a case. Progress callback receives the per-file state list after every change.
 * @returns {{ promise: Promise<object[]>, cancel(): void }}
 */
export function ingest(caseId, files, { ocr = true, known = new Set(), onUpdate = () => {} } = {}) {
  let cancelled = false;
  const jobs = [...files].map((f) => ({ file: f, name: f.name, state: 'queued', detail: '', docId: null }));
  const update = () => onUpdate(jobs.map(({ file, ...j }) => j));
  const promise = (async () => {
    const existing = await listDocs(caseId);
    update();
    for (const job of jobs) {
      if (cancelled) {
        job.state = 'cancelled';
        continue;
      }
      job.state = 'reading';
      update();
      try {
        const extracted = await extractDocument(job.file, { ocr, onProgress: (t) => ((job.detail = t), update()) });
        const dup = existing.find((d) => d.sha256 === extracted.sha256);
        const record = newDocRecord(caseId, job.file, extracted, derive(extracted, known));
        if (dup) record.history.push({ at: record.addedAt, action: 'duplicate', detail: `Same SHA-256 as “${dup.name}”, added ${dup.addedAt.slice(0, 10)}` });
        await putDoc(record);
        existing.push(record);
        job.state = 'done';
        job.docId = record.id;
        job.detail = `${record.label} · ${record.pages.length} part(s)${record.ocrPages ? ` · OCR ${record.ocrPages}` : ''}${dup ? ' · duplicate' : ''}`;
      } catch (err) {
        job.state = 'failed';
        job.detail = err?.message || String(err);
      }
      update();
    }
    return jobs;
  })();
  return { promise, cancel: () => (cancelled = true), jobs };
}
