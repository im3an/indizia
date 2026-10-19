// Document workspace storage: one record per document, keyed to a case, in this browser's IndexedDB
// (database "sherlock", store "documents"). The original file is kept as a Blob so the artifact itself is
// preserved next to everything derived from it. Falls back to memory (this tab only) like the case store.
//
// Record: { id, caseId, name, size, mime, lastModified, addedAt, sha256, sha1, kind, label, signature, meta,
//   pages: [{ n, label?, text, ocr, confidence? }], links, tables, tracked, warnings, ocrPages,
//   entities, dates, simhash, words, status, tags, note, blob, history: [{ at, action, detail }] }

import { openDb, uid } from '../workspace/store.js';

const STORE = 'documents';
const memory = new Map();
const listeners = new Set();
export const onDocsChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (caseId) => listeners.forEach((fn) => fn(caseId));

export const REVIEW = { unreviewed: 'Not reviewed', relevant: 'Relevant', followup: 'Follow up', irrelevant: 'Not relevant' };

async function run(mode, fn) {
  const db = await openDb();
  if (!db || !db.objectStoreNames.contains(STORE)) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    let result;
    Promise.resolve(fn(t.objectStore(STORE))).then((r) => (result = r), reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export async function listDocs(caseId) {
  const all = await run('readonly', (s) => (s ? req(s.index('caseId').getAll(caseId)) : [...memory.values()].filter((d) => d.caseId === caseId)));
  return all.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
}

export async function getDoc(id) {
  return (await run('readonly', (s) => (s ? req(s.get(id)) : memory.get(id)))) || null;
}

export async function putDoc(doc) {
  await run('readwrite', (s) => (s ? req(s.put(doc)) : memory.set(doc.id, doc)));
  emit(doc.caseId);
  return doc;
}

export async function deleteDoc(id) {
  const d = await getDoc(id);
  await run('readwrite', (s) => (s ? req(s.delete(id)) : memory.delete(id)));
  if (d) emit(d.caseId);
}

/** Read-modify-write one document and append to its processing history. */
export async function updateDoc(id, fn, action, detail = '') {
  const d = await getDoc(id);
  if (!d) return null;
  fn(d);
  if (action) d.history = [...(d.history || []), { at: new Date().toISOString(), action, detail }].slice(-200);
  return putDoc(d);
}

export function newDocRecord(caseId, file, extracted, derived) {
  const now = new Date().toISOString();
  return {
    id: uid('D'),
    caseId,
    name: file.name,
    size: file.size,
    mime: file.type || null,
    lastModified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    addedAt: now,
    ...extracted,
    ...derived,
    // Big spreadsheets: keep the first rows as a table, the full text stays searchable.
    tables: (extracted.tables || []).map((t) => ({ ...t, rows: t.rows.slice(0, 2000), truncated: t.rows.length > 2000 })),
    status: 'unreviewed',
    tags: [],
    note: '',
    blob: file,
    history: [
      { at: now, action: 'added', detail: `${file.name} · ${file.size.toLocaleString()} bytes · SHA-256 ${extracted.sha256}` },
      { at: now, action: 'extracted', detail: `${extracted.label}: ${extracted.pages.length} part(s), ${extracted.text.length.toLocaleString()} characters${extracted.ocrPages ? `, OCR on ${extracted.ocrPages}` : ''}` },
    ],
  };
}
