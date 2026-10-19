// Investigation workspace storage. Local-first: cases live in this browser's IndexedDB and never leave it,
// except when the user exports a report. Falls back to memory (this tab only) when storage is blocked.
//
// Case shape:
// { id, name, folder, description, status: 'open'|'closed', createdAt, updatedAt, autoSave,
//   investigations: [{ id, query, root, savedAt, snapshot, runs: [{ at, findings, sources, change, watch? }],
//                      watch?: { interval: 'daily'|'weekly', since, lastCheck, retryAt, carry } }],
//   watchLog:  [{ id, at, invId, query, summary, added, removed, grown, changed, unanswered, seen }]  — watch changes
//   evidence:  [{ id, pinnedAt, tags, note, ...evidenceItem }],
//   notes:     [{ id, text, tags, createdAt, updatedAt }],
//   bookmarks: [{ id, url, title, tags, createdAt }],
//   tasks:     [{ id, kind: 'task'|'lead'|'question', text, status: 'open'|'done', query, createdAt, doneAt }],
//   activity:  [{ at, kind, text }]  — the audit trail, append-only }

// Storage ids keep the pre-rename "sherlock" prefix (database, localStorage keys, export format) so saved data survives.
const DB = 'sherlock';
const STORE = 'cases';
const ACTIVE_KEY = 'sherlock.activeCase';
const LEGACY_PINS = 'sherlock.case.v1';
const MAX_ACTIVITY = 2000;

let dbPromise = null;
const memory = new Map();
let useMemory = false;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      // v2 adds the document workspace (docs/store.js). Upgrades only create what is missing, so cases survive.
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' }).createIndex('caseId', 'caseId');
      };
      let blockedTimer = null;
      req.onsuccess = () => {
        clearTimeout(blockedTimer);
        // Let a newer Indizia tab upgrade the database instead of blocking it.
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      };
      req.onerror = () => {
        useMemory = true;
        resolve(null);
      };
      // Another tab still holds the old version open. Wait for it briefly; only then fall back to memory.
      req.onblocked = () => {
        blockedTimer = setTimeout(() => {
          useMemory = true;
          resolve(null);
        }, 5000);
      };
    } catch {
      useMemory = true;
      resolve(null);
    }
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  if (!db || useMemory) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => (result = r));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export const uid = (p = '') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const isPersistent = async () => !!(await openDb()) && !useMemory;

export async function listCases() {
  const all = await tx('readonly', (s) => (s ? req(s.getAll()) : [...memory.values()]));
  return (all || []).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getCase(id) {
  if (!id) return null;
  return (await tx('readonly', (s) => (s ? req(s.get(id)) : memory.get(id)))) || null;
}

export async function putCase(c) {
  c.updatedAt = new Date().toISOString();
  if (c.activity.length > MAX_ACTIVITY) c.activity = c.activity.slice(-MAX_ACTIVITY);
  // Structured clone keeps the record plain (no prototypes, no functions).
  const plain = JSON.parse(JSON.stringify(c));
  await tx('readwrite', (s) => (s ? req(s.put(plain)) : memory.set(c.id, plain)));
  notify(c.id);
  return plain;
}

export async function deleteCase(id) {
  await tx('readwrite', (s) => (s ? req(s.delete(id)) : memory.delete(id)));
  if (activeCaseId() === id) setActiveCase(null);
  notify(id);
}

export function blankCase({ name, folder = '', description = '' }) {
  const now = new Date().toISOString();
  return {
    id: uid('c'), name: name || 'Untitled case', folder, description, status: 'open', createdAt: now, updatedAt: now, autoSave: true,
    investigations: [], evidence: [], notes: [], bookmarks: [], tasks: [],
    activity: [{ at: now, kind: 'case', text: `Case created${folder ? ` in folder “${folder}”` : ''}` }],
  };
}

export async function createCase(fields) {
  const c = blankCase(fields);
  await putCase(c);
  return c;
}

/** Load, change, log, save. fn may return a string to append to the audit trail. */
export async function mutate(id, fn) {
  const c = await getCase(id);
  if (!c) return null;
  const log = await fn(c);
  for (const text of [].concat(log || [])) if (text) c.activity.push({ at: new Date().toISOString(), kind: 'change', text });
  return putCase(c);
}

export function activeCaseId() {
  try {
    return localStorage.getItem(ACTIVE_KEY) || null;
  } catch {
    return memoryActive;
  }
}
let memoryActive = null;
export function setActiveCase(id) {
  memoryActive = id;
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* private mode */
  }
  notify(id);
}

const listeners = new Set();
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = (id) => listeners.forEach((fn) => fn(id));

/** One-time move of the old flat "pinned findings" list into a case, so nothing pinned earlier is lost. */
export async function migrateLegacyPins() {
  let items;
  try {
    items = JSON.parse(localStorage.getItem(LEGACY_PINS) || '[]');
  } catch {
    return;
  }
  if (!items.length) return;
  const c = blankCase({ name: 'Pinned findings', description: 'Findings pinned before cases existed.' });
  c.evidence = items.map((it) => ({
    id: uid('e'), pinnedAt: it.pinnedAt || c.createdAt, tags: [], note: '', title: it.title, detail: it.detail || '', confidence: it.confidence, source: it.source,
    query: it.query, queryType: null, entity: null, date: null, evidence: it.url ? { url: it.url, retrievedAt: it.retrievedAt, sha256: it.sha256 } : null,
  }));
  c.activity.push({ at: new Date().toISOString(), kind: 'case', text: `Imported ${items.length} earlier pinned findings` });
  await putCase(c);
  if (!activeCaseId()) setActiveCase(c.id);
  try {
    localStorage.removeItem(LEGACY_PINS);
  } catch {
    /* ignore */
  }
}

export const parseTags = (s) => [...new Set(String(s || '').split(/[,\s]+/).map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))].slice(0, 12);
