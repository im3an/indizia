// Documents tab of a case: intake, library, reader, full-text search, entities, dated statements, compare,
// duplicates and a review report. Everything runs in the browser; documents stay in this browser's storage.

import { listDocs, getDoc, updateDoc, deleteDoc, REVIEW } from './store.js';
import { ingest, caseEntityValues, derive } from './ingest.js';
import { searchDocs, snippet, invalidate } from './search.js';
import { findDuplicates, contradictions, entityDelta, hamming } from './compare.js';
import { ENTITY_LABEL, entityQuery } from './entities.js';
import { mutate, uid, parseTags } from '../workspace/store.js';
import { download } from '../report.js';
import { loadScript } from '../loader.js';
import { semanticRanker, semanticStatus, embedDoc } from './semantic.js';
import { SEARCH_ICON } from '../ui/icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (s) => (s ? String(s).slice(0, 10) : '');
const VIEWS = [['library', 'Library'], ['search', 'Search'], ['entities', 'Entities'], ['timeline', 'Dated statements'], ['compare', 'Compare'], ['duplicates', 'Duplicates']];

const ui = { view: 'library', q: '', open: null, a: null, b: null, ocr: true, jobs: null, run: null, semantic: false, entityType: 'all' };

export async function renderDocuments({ c, body, deps, rerender }) {
  const docs = await listDocs(c.id);
  const sem = await semanticStatus();
  body.innerHTML = `
    <div class="docs">
      <div class="docs-intake" id="docs-drop">
        <div>
          <h2>Documents <span class="count">${docs.length}</span></h2>
          <p class="panel-sub">PDF, Word, Excel, PowerPoint, OpenDocument, CSV, text, HTML, XML, JSON, email and images. Read, OCR'd and indexed in this browser; nothing is uploaded. Originals are kept with their SHA-256.</p>
        </div>
        <div class="docs-intake-actions">
          <label class="check"><input type="checkbox" id="docs-ocr" ${ui.ocr ? 'checked' : ''}> OCR scans and images</label>
          <button type="button" class="btn primary" id="docs-add">Add documents</button>
          <input type="file" id="docs-file" multiple hidden>
        </div>
      </div>
      <div id="docs-jobs"></div>
      <form class="docs-search" id="docs-search" role="search">
        <label class="field grow big">${SEARCH_ICON}<input type="search" id="docs-q" value="${esc(ui.q)}" placeholder='Search all documents: words, "exact phrase", -exclude, a OR b, type:pdf status:relevant entity:… after:2020' aria-label="Search documents" spellcheck="false" autocomplete="off"></label>
        ${sem.available ? `<label class="check" title="Ranks pages by meaning with ${esc(sem.model)} on this computer"><input type="checkbox" id="docs-sem" ${ui.semantic ? 'checked' : ''}> By meaning</label>` : ''}
        <button type="submit" class="btn">Search</button>
      </form>
      <div class="filters docs-views" role="tablist" aria-label="Document views">
        ${VIEWS.map(([v, l]) => `<button type="button" role="tab" data-dv="${v}" aria-selected="${ui.view === v}">${l}</button>`).join('')}
      </div>
      <div class="docs-body" id="docs-body"></div>
      <div class="docs-foot">
        <button type="button" class="btn" id="docs-report" ${docs.length ? '' : 'disabled'}>Review report (Markdown)</button>
        <button type="button" class="btn" id="docs-print" ${docs.length ? '' : 'disabled'}>Review report (print / PDF)</button>
        ${sem.available && docs.length ? `<button type="button" class="btn ghost" id="docs-embed">Build meaning index (${esc(sem.model)})</button>` : ''}
      </div>
    </div>`;

  const $ = (id) => body.querySelector(`#${id}`);
  const fileInput = $('docs-file');
  $('docs-add').addEventListener('click', () => fileInput.click());
  $('docs-ocr').addEventListener('change', (ev) => (ui.ocr = ev.target.checked));
  fileInput.addEventListener('change', () => fileInput.files.length && start(fileInput.files));
  const drop = $('docs-drop');
  drop.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    drop.classList.remove('is-over');
    if (ev.dataTransfer.files.length) start(ev.dataTransfer.files);
  });

  function start(files) {
    if (ui.run) return deps.toast('Wait for the current batch to finish, or cancel it');
    ui.run = ingest(c.id, files, { ocr: ui.ocr, known: caseEntityValues(c), onUpdate: (jobs) => ((ui.jobs = jobs), paintJobs()) });
    ui.run.promise.then(async (jobs) => {
      const done = jobs.filter((j) => j.state === 'done');
      if (done.length) await mutate(c.id, () => `Added ${done.length} document${done.length > 1 ? 's' : ''}: ${done.slice(0, 5).map((j) => j.name).join(', ')}${done.length > 5 ? ' …' : ''}`);
      // With a local embedding model, new documents join the meaning index in the background.
      if ((await semanticStatus()).available) for (const j of done) getDoc(j.docId).then((d) => d && embedDoc(d)).catch(() => {});
      ui.run = null;
      invalidate(c.id);
      rerender();
    });
  }
  function paintJobs() {
    const box = $('docs-jobs');
    if (!box || !ui.jobs) return;
    const left = ui.jobs.filter((j) => ['queued', 'reading'].includes(j.state)).length;
    box.innerHTML = `<div class="docs-jobs">
      <div class="docs-jobs-head"><b>${left ? `Processing ${ui.jobs.length - left + 1} of ${ui.jobs.length}` : `Processed ${ui.jobs.length}`}</b>${left && ui.run ? '<button type="button" class="btn ghost" id="docs-cancel">Cancel after this file</button>' : '<button type="button" class="btn ghost" id="docs-jobs-close">Dismiss</button>'}</div>
      <ol>${ui.jobs.map((j) => `<li class="job-${j.state}"><span class="dot"></span><b>${esc(j.name)}</b> <small>${esc(j.state === 'queued' ? 'waiting' : j.state === 'reading' ? j.detail || 'reading' : j.detail || j.state)}</small></li>`).join('')}</ol>
    </div>`;
    box.querySelector('#docs-cancel')?.addEventListener('click', () => (ui.run?.cancel(), deps.toast('The batch stops after the current file')));
    box.querySelector('#docs-jobs-close')?.addEventListener('click', () => ((ui.jobs = null), (box.innerHTML = '')));
  }
  paintJobs();

  $('docs-search').addEventListener('submit', (ev) => {
    ev.preventDefault();
    ui.q = $('docs-q').value.trim();
    ui.view = 'search';
    paint();
  });
  $('docs-sem')?.addEventListener('change', (ev) => {
    ui.semantic = ev.target.checked;
    if (ui.view === 'search') paint();
  });
  body.querySelectorAll('[data-dv]').forEach((b) => b.addEventListener('click', () => {
    ui.view = b.dataset.dv;
    ui.open = null;
    paint();
  }));
  $('docs-report').addEventListener('click', async () => download(`indizia-documents-${c.name.replace(/[^\w]+/g, '-').slice(0, 40)}.md`, reviewReport(c, await listDocs(c.id))));
  $('docs-print').addEventListener('click', async () => deps.print(mdToBasicHtml(reviewReport(c, await listDocs(c.id))), `${c.name} · documents`));
  $('docs-embed')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    let n = 0;
    for (const d of docs) {
      btn.textContent = `Indexing ${++n} of ${docs.length}…`;
      try {
        await embedDoc(d);
      } catch (err) {
        deps.toast(`Meaning index stopped: ${err.message}`);
        break;
      }
    }
    btn.textContent = 'Meaning index ready';
    invalidate(c.id);
  });

  const out = $('docs-body');
  async function paint() {
    body.querySelectorAll('[data-dv]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.dv === ui.view)));
    const all = await listDocs(c.id);
    if (ui.open) return reader(out, c, ui.open, deps, paint);
    if (!all.length) {
      out.innerHTML = '<p class="empty-note">No documents in this case yet. Add files or drop them on the box above. Try a contract, an annual report, a scanned letter or a spreadsheet: Indizia extracts the text, finds organisations, identifiers and dates, and lets you search and compare everything.</p>';
      return;
    }
    const v = { library, search, entities, timeline, compare, duplicates }[ui.view];
    await v(out, c, all, deps, paint);
  }
  paint();
}

/* ---------------- Library ---------------- */
function library(out, c, docs, deps, paint) {
  out.innerHTML = `<div class="tw"><table class="docs-table">
    <thead><tr><th>Document</th><th>Type</th><th>Parts</th><th>Date</th><th>Category</th><th>Ties to case</th><th>Review</th></tr></thead>
    <tbody>${docs.map((d) => `<tr data-id="${esc(d.id)}">
      <td><button type="button" class="linkish" data-open="${esc(d.id)}">${esc(d.name)}</button>${d.warnings?.length ? ` <span class="badge warn" title="${esc(d.warnings.join(' '))}">${d.warnings.length} note${d.warnings.length > 1 ? 's' : ''}</span>` : ''}${d.ocrPages ? ' <span class="badge">OCR</span>' : ''}<br><small class="mono">${esc(kb(d.size))} · ${esc(d.sha256.slice(0, 12))}…</small></td>
      <td>${esc(d.label)}</td>
      <td>${d.pages.length}</td>
      <td class="mono">${esc(day(d.meta?.created || d.meta?.date || d.dates?.[0]?.date))}</td>
      <td title="${esc(d.because || '')}">${esc(d.category || '')}</td>
      <td>${d.relevance?.score ? `<span class="meter" title="Mentions ${esc(d.relevance.shared.join(', '))}"><i style="width:${d.relevance.score}%"></i></span> ${d.relevance.shared.length}` : '<small class="muted">—</small>'}</td>
      <td><select data-status="${esc(d.id)}" aria-label="Review status of ${esc(d.name)}">${Object.entries(REVIEW).map(([k, l]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    </tr>`).join('')}</tbody></table></div>
    <p class="panel-sub">“Ties to case” counts identifiers and organisations this case's own searches also found (hover for the list).</p>`;
  out.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    ui.open = b.dataset.open;
    paint();
  }));
  out.querySelectorAll('[data-status]').forEach((s) => s.addEventListener('change', async () => {
    const d = await updateDoc(s.dataset.status, (x) => (x.status = s.value), 'review', REVIEW[s.value]);
    await mutate(c.id, () => `Marked document “${d.name}” as ${REVIEW[s.value].toLowerCase()}`);
    deps.toast(`${d.name}: ${REVIEW[s.value]}`);
  }));
}

/* ---------------- Reader ---------------- */
async function reader(out, c, id, deps, paint) {
  const d = await getDoc(id);
  if (!d) {
    ui.open = null;
    return paint();
  }
  const m = d.meta || {};
  const metaRows = [
    ['Detected type', `${d.label}${d.signature?.matches === false ? ' (does not match the file name)' : ''}`], ['Title', m.title], ['Author field', m.author], ['Last saved by', m.lastModifiedBy], ['Company field', m.company],
    ['Application', m.application || m.creator], ['Producer', m.producer], ['Created', m.created], ['Modified', m.modified], ['Revision', m.revision],
    ['From', m.from], ['To', m.to], ['Subject', m.subject], ['Date', m.date], ['Message-ID', m.messageId], ['Received hops', m.received],
    ['Camera', m.camera], ['Taken', m.taken], ['GPS', m.gps ? `${m.gps.lat.toFixed(6)}, ${m.gps.lon.toFixed(6)}` : null], ['Size', m.width ? `${m.width} × ${m.height}` : null],
    ['Pages', m.pageCount], ['Duration', m.duration ? `${m.duration} s` : null], ['Keyframes', m.keyframes], ['Subtitle cues', m.cues], ['Comments', m.comments], ['Attachments', Array.isArray(m.attachments) && m.attachments.length ? m.attachments.join(', ') : null],
    ['SHA-256', d.sha256], ['SHA-1', d.sha1], ['File size', `${d.size.toLocaleString()} bytes`], ['File date (from your system)', d.lastModified], ['Added', d.addedAt],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
  const terms = ui.q ? ui.q.split(/\s+/).filter((t) => t.length > 1 && !t.includes(':') && !t.startsWith('-')).map((t) => t.replace(/"/g, '')) : [];
  const groups = {};
  for (const e of d.entities || []) (groups[e.type] ||= []).push(e);
  out.innerHTML = `<article class="doc-reader">
    <header class="doc-head">
      <button type="button" class="btn ghost" id="doc-back">← All documents</button>
      <h3>${esc(d.name)}</h3>
      <div class="doc-actions">
        <select id="doc-status" aria-label="Review status">${Object.entries(REVIEW).map(([k, l]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button type="button" class="btn" id="doc-pin">Pin to evidence</button>
        <button type="button" class="btn" id="doc-orig">Download original</button>
        <button type="button" class="btn ghost" id="doc-reprocess">Re-run extraction</button>
        <button type="button" class="btn ghost" id="doc-del">Delete</button>
      </div>
    </header>
    ${d.warnings?.length ? `<ul class="doc-warn">${d.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <div class="doc-grid">
      <div class="doc-text">
        ${d.media?.thumb ? `<figure class="doc-media"><img src="${esc(d.media.thumb)}" alt="Preview of ${esc(d.name)}"><figcaption class="mono">dHash ${esc(d.media.dhash)} · aHash ${esc(d.media.ahash)}</figcaption></figure>` : ''}
        ${d.media?.frames?.length ? `<div class="doc-frames">${d.media.frames.map((f) => `<figure><img src="${esc(f.thumb)}" alt="${esc(f.label)}"><figcaption>${esc(f.label)}<br><span class="mono">${esc(f.dhash)}</span></figcaption></figure>`).join('')}</div>` : ''}
        ${d.pages.map((p) => `<section class="doc-page" id="page-${p.n}"><h4>${esc(p.label || `Page ${p.n}`)}${p.ocr ? ` <span class="badge" title="Text recognised from the image; check against the original">OCR ${p.confidence ?? ''}%</span>` : ''}</h4><pre>${terms.length ? highlightAll(p.text, terms) : esc(p.text) || '<em class="muted">No text on this part.</em>'}</pre></section>`).join('')}
        ${d.tracked?.deleted?.length ? `<section class="doc-page"><h4>Deleted in tracked changes (hidden in a normal view)</h4><pre>${esc(d.tracked.deleted.join('\n— '))}</pre></section>` : ''}
        ${d.tables?.length ? d.tables.map((t) => `<details class="more"><summary>Table “${esc(t.name)}”: ${t.rows.length}${t.truncated ? '+' : ''} rows</summary><div class="tw"><table class="docs-table">${t.rows.slice(0, 50).map((r) => `<tr>${r.slice(0, 20).map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table></div></details>`).join('') : ''}
      </div>
      <aside class="doc-side">
        <section><h4>Properties</h4><dl class="kv">${metaRows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="${/SHA|ID/.test(k) ? 'mono' : ''}">${esc(v)}</dd>`).join('')}</dl>
          <p class="panel-sub">Embedded properties are claims made by the file and can be edited by anyone.</p></section>
        <section><h4>Review</h4>
          <label class="stack">Tags <input id="doc-tags" value="${esc((d.tags || []).join(', '))}" placeholder="contract, key"></label>
          <label class="stack">Analyst note <textarea id="doc-note" rows="3" placeholder="Why this document matters…">${esc(d.note || '')}</textarea></label>
          <p class="panel-sub">Category: ${esc(d.category || '—')}${d.because ? ` (words: ${esc(d.because)})` : ''}</p></section>
        <section><h4>Entities <span class="count">${(d.entities || []).length}</span></h4>
          ${Object.entries(groups).map(([type, list]) => `<div class="ent-group"><b>${esc(ENTITY_LABEL[type] || type)}</b><ul>${list.slice(0, 30).map((e) => {
            const q = entityQuery(e);
            return `<li><span class="${['org'].includes(type) ? '' : 'mono'}">${esc(e.display)}</span> <small>${e.count}× · p. ${esc((e.pages || []).slice(0, 6).join(', '))}</small>${q ? ` <button type="button" class="linkish" data-q="${esc(q)}" title="Investigate in Indizia">search</button>` : ''}</li>`;
          }).join('')}</ul></div>`).join('') || '<p class="empty-note">No organisations, identifiers or amounts found.</p>'}
          <p class="panel-sub">Person names are not extracted.</p></section>
        <section><h4>Dated statements <span class="count">${(d.dates || []).length}</span></h4>
          <ol class="doc-dates">${(d.dates || []).slice(0, 40).map((x) => `<li><b class="mono">${esc(x.date)}</b> <a href="#page-${x.page}" data-page="${x.page}">p. ${x.page}</a><br><small>${esc(x.context)}</small></li>`).join('')}</ol></section>
        ${d.links?.length ? `<section><h4>Links <span class="count">${d.links.length}</span></h4><ul class="doc-links">${d.links.slice(0, 60).map((u) => `<li class="mono"><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a></li>`).join('')}</ul></section>` : ''}
        <section><h4>Processing history</h4><ol class="doc-hist">${(d.history || []).map((h) => `<li><span class="mono">${esc(h.at.replace('T', ' ').slice(0, 19))}</span> <b>${esc(h.action)}</b> ${esc(h.detail)}</li>`).join('')}</ol></section>
      </aside>
    </div>
  </article>`;
  const q = (s) => out.querySelector(s);
  q('#doc-back').addEventListener('click', () => {
    ui.open = null;
    paint();
  });
  q('#doc-status').addEventListener('change', async (ev) => {
    await updateDoc(d.id, (x) => (x.status = ev.target.value), 'review', REVIEW[ev.target.value]);
    await mutate(c.id, () => `Marked document “${d.name}” as ${REVIEW[ev.target.value].toLowerCase()}`);
  });
  q('#doc-tags').addEventListener('change', async (ev) => {
    const tags = parseTags(ev.target.value);
    await updateDoc(d.id, (x) => (x.tags = tags), 'tagged', tags.map((t) => `#${t}`).join(' '));
    deps.toast('Tags saved');
  });
  q('#doc-note').addEventListener('change', async (ev) => {
    await updateDoc(d.id, (x) => (x.note = ev.target.value.trim()), 'annotated');
    deps.toast('Note saved');
  });
  q('#doc-orig').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(d.blob);
    a.download = d.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  q('#doc-del').addEventListener('click', async () => {
    if (!confirm(`Delete “${d.name}” and everything extracted from it from this case? This cannot be undone.`)) return;
    await deleteDoc(d.id);
    await mutate(c.id, () => `Deleted document “${d.name}” (SHA-256 ${d.sha256})`);
    invalidate(c.id);
    ui.open = null;
    paint();
  });
  q('#doc-reprocess').addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    ev.currentTarget.textContent = 'Re-reading…';
    const { extractDocument } = await import('./extract.js');
    const extracted = await extractDocument(new File([d.blob], d.name, { lastModified: d.blob.lastModified }), { ocr: ui.ocr });
    if (extracted.sha256 !== d.sha256) return deps.toast('The stored original no longer matches its SHA-256. Nothing was changed.');
    await updateDoc(d.id, (x) => Object.assign(x, { embeddings: null, pages: extracted.pages, text: extracted.text, meta: extracted.meta, links: extracted.links, tables: extracted.tables, tracked: extracted.tracked, warnings: extracted.warnings, ocrPages: extracted.ocrPages }, derive(extracted, caseEntityValues(c))), 're-extracted', `SHA-256 verified; ${extracted.pages.length} part(s)`);
    invalidate(c.id);
    paint();
  });
  q('#doc-pin').addEventListener('click', async () => {
    const page = d.pages.find((p) => p.text.trim()) || d.pages[0];
    const excerpt = (page?.text || '').slice(0, 1500);
    await mutate(c.id, (x) => {
      x.evidence.push({
        id: uid('e'), pinnedAt: new Date().toISOString(), tags: d.tags || [], note: d.note || '',
        title: `Document: ${d.name}`, detail: `${d.label}${m.title ? ` “${m.title}”` : ''}${m.author ? ` · author field ${m.author}` : ''}${m.created ? ` · created ${m.created}` : ''}`,
        confidence: 'confirmed', source: 'Document workspace', provider: 'Analysed in this browser', query: d.name, queryType: 'file', date: m.created || null,
        evidence: { url: `local:document/${d.id}`, method: 'LOCAL', status: 200, retrievedAt: d.addedAt, sha256: d.sha256, excerpt, local: true },
      });
      return `Pinned document “${d.name}” (SHA-256 ${d.sha256})`;
    });
    deps.toast('Pinned to the case evidence');
  });
  out.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => deps.navigate(b.dataset.q)));
  out.querySelectorAll('[data-page]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    out.querySelector(`#page-${a.dataset.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function highlightAll(text, terms) {
  const words = [...new Set(terms)].sort((a, b) => b.length - a.length).map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return esc(text).replace(new RegExp(`(${words.join('|')})`, 'gi'), '<mark>$1</mark>');
}

/* ---------------- Search ---------------- */
async function search(out, c, docs, deps, paint) {
  if (!ui.q) {
    out.innerHTML = `<div class="docs-help"><p>Search every page of every document in this case.</p>
      <ul><li><code>gmbh vertrag</code> both words (typos tolerated)</li><li><code>"supply agreement"</code> exact phrase</li><li><code>invoice -draft</code> exclude a word</li><li><code>bundesdruckerei OR "federal printing"</code> either</li>
      <li><code>type:pdf</code> <code>status:relevant</code> <code>tag:key</code> <code>entity:DE814236234</code> <code>page:3</code> <code>ocr:yes</code></li><li><code>after:2020-01 before:2021-12-31</code> by document date</li></ul></div>`;
    return;
  }
  out.innerHTML = '<p class="empty-note">Searching…</p>';
  const t0 = performance.now();
  const ranker = ui.semantic ? semanticRanker(docs, ui.q) : null;
  const { results, total } = await searchDocs(c.id, docs, ui.q, { semantic: ranker });
  const ms = Math.round(performance.now() - t0);
  out.innerHTML = `<p class="panel-sub">${total} matching page${total === 1 ? '' : 's'} in ${new Set(results.map((r) => r.doc.id)).size} document(s) · ${ms} ms${ui.semantic ? ' · ranked by meaning and words' : ''}</p>
    ${results.length ? `<ol class="docs-results">${results.map((r) => `<li>
      <div class="dr-head"><button type="button" class="linkish" data-open="${esc(r.doc.id)}" data-page="${r.page.n}">${esc(r.doc.name)}</button> <span class="mono">${esc(r.page.label || `p. ${r.page.n}`)}</span>${r.page.ocr ? ' <span class="badge">OCR</span>' : ''} <span class="badge">${esc(REVIEW[r.doc.status])}</span></div>
      <p class="dr-snip">${r.snippet}</p>
      <small class="dr-why">Matched: ${esc(r.why.join(' · ') || 'filters')}</small></li>`).join('')}</ol>` : '<p class="empty-note">No page matches. Check the spelling, drop a filter, or try fewer words.</p>'}`;
  out.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
    ui.open = b.dataset.open;
    await paint();
    document.getElementById(`page-${b.dataset.page}`)?.scrollIntoView({ block: 'start' });
  }));
}

/* ---------------- Entities across documents ---------------- */
function entities(out, c, docs, deps, paint) {
  const agg = new Map();
  for (const d of docs) for (const e of d.entities || []) {
    const k = `${e.type}:${e.type === 'org' ? e.value.toLowerCase() : e.value}`;
    const cur = agg.get(k) || { ...e, count: 0, docs: [] };
    cur.count += e.count;
    cur.docs.push({ id: d.id, name: d.name, pages: e.pages });
    agg.set(k, cur);
  }
  const types = [...new Set([...agg.values()].map((e) => e.type))];
  const list = [...agg.values()].filter((e) => ui.entityType === 'all' || e.type === ui.entityType).sort((a, b) => b.docs.length - a.docs.length || b.count - a.count);
  out.innerHTML = `<div class="filters" role="radiogroup" aria-label="Entity type"><button type="button" role="radio" data-et="all" aria-checked="${ui.entityType === 'all'}">All</button>${types.map((t) => `<button type="button" role="radio" data-et="${t}" aria-checked="${ui.entityType === t}">${esc(ENTITY_LABEL[t] || t)}</button>`).join('')}</div>
    <p class="panel-sub">Entities that appear in more than one document come first: they are what connects the collection.</p>
    <div class="tw"><table class="docs-table"><thead><tr><th>Entity</th><th>Type</th><th>Documents</th><th>Mentions</th><th></th></tr></thead><tbody>
    ${list.slice(0, 400).map((e) => {
      const q = entityQuery(e);
      return `<tr><td class="${e.type === 'org' ? '' : 'mono'}">${esc(e.display)}</td><td>${esc(ENTITY_LABEL[e.type] || e.type)}</td><td>${e.docs.map((x) => `<button type="button" class="linkish" data-open="${esc(x.id)}">${esc(x.name)}</button>`).join(', ')}</td><td>${e.count}</td>
        <td><button type="button" class="linkish" data-find="${esc(`entity:${e.value}`)}">pages</button>${q ? ` · <button type="button" class="linkish" data-q="${esc(q)}">investigate</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  out.querySelectorAll('[data-et]').forEach((b) => b.addEventListener('click', () => ((ui.entityType = b.dataset.et), paint())));
  out.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => ((ui.open = b.dataset.open), paint())));
  out.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => deps.navigate(b.dataset.q)));
  out.querySelectorAll('[data-find]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.find.slice(7);
    ui.q = `"${v}"`;
    ui.view = 'search';
    document.getElementById('docs-q').value = ui.q;
    paint();
  }));
}

/* ---------------- Dated statements ---------------- */
function timeline(out, c, docs, deps, paint) {
  const rows = docs.flatMap((d) => [
    ...(d.meta?.created ? [{ date: day(d.meta.created), context: 'Document created (embedded property)', d, page: null, kind: 'property' }] : []),
    ...(d.meta?.modified ? [{ date: day(d.meta.modified), context: 'Document last modified (embedded property)', d, page: null, kind: 'property' }] : []),
    ...(d.dates || []).map((x) => ({ ...x, d, kind: 'statement' })),
  ]).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  out.innerHTML = `<p class="panel-sub">Dates written in the documents, with the sentence around them, plus embedded creation and modification dates (claims made by the files). ${rows.length} entries.</p>
    <div class="drawer-actions"><button type="button" class="btn" id="dt-ts">Export as Timesketch JSONL</button></div>
    <ol class="doc-timeline">${rows.slice(0, 1500).map((r) => `<li class="k-${r.kind}"><b class="mono">${esc(r.date)}</b><div><p>${esc(r.context)}</p><small><button type="button" class="linkish" data-open="${esc(r.d.id)}" data-page="${r.page ?? ''}">${esc(r.d.name)}</button>${r.page ? ` · ${esc(r.pageLabel || `p. ${r.page}`)}` : ''}</small></div></li>`).join('')}</ol>`;
  out.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
    ui.open = b.dataset.open;
    await paint();
    if (b.dataset.page) document.getElementById(`page-${b.dataset.page}`)?.scrollIntoView({ block: 'start' });
  }));
  out.querySelector('#dt-ts').addEventListener('click', () => {
    const lines = rows.map((r) => JSON.stringify({ message: r.context, datetime: `${r.date.length === 7 ? `${r.date}-01` : r.date}T00:00:00Z`, timestamp_desc: r.kind === 'property' ? 'Embedded document property' : 'Date stated in document', data_type: 'sherlock:document', source_name: r.d.name, sha256: r.d.sha256, page: r.page, date_precision: r.date.length === 7 ? 'month' : 'day' }));
    download(`indizia-documents-${c.id}.timesketch.jsonl`, `${lines.join('\n')}\n`);
  });
}

/* ---------------- Compare ---------------- */
async function compare(out, c, docs, deps, paint) {
  if (docs.length < 2) {
    out.innerHTML = '<p class="empty-note">Add at least two documents to compare them.</p>';
    return;
  }
  ui.a = docs.some((d) => d.id === ui.a) ? ui.a : docs[1].id;
  ui.b = docs.some((d) => d.id === ui.b) ? ui.b : docs[0].id;
  const opt = (sel) => docs.map((d) => `<option value="${esc(d.id)}" ${d.id === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  out.innerHTML = `<div class="cmp-pick"><label>Earlier / A <select id="cmp-a">${opt(ui.a)}</select></label><button type="button" class="btn ghost" id="cmp-swap" aria-label="Swap">⇄</button><label>Later / B <select id="cmp-b">${opt(ui.b)}</select></label></div><div id="cmp-out"><p class="empty-note">Comparing…</p></div>`;
  out.querySelector('#cmp-a').addEventListener('change', (ev) => ((ui.a = ev.target.value), paint()));
  out.querySelector('#cmp-b').addEventListener('change', (ev) => ((ui.b = ev.target.value), paint()));
  out.querySelector('#cmp-swap').addEventListener('click', () => (([ui.a, ui.b] = [ui.b, ui.a]), paint()));
  const [A, B] = await Promise.all([getDoc(ui.a), getDoc(ui.b)]);
  const box = out.querySelector('#cmp-out');
  if (A.id === B.id) {
    box.innerHTML = '<p class="empty-note">Pick two different documents.</p>';
    return;
  }
  const props = ['title', 'author', 'lastModifiedBy', 'company', 'application', 'creator', 'producer', 'created', 'modified', 'revision', 'pageCount'];
  const propRows = props.filter((k) => A.meta?.[k] || B.meta?.[k]).map((k) => `<tr class="${String(A.meta?.[k] ?? '') !== String(B.meta?.[k] ?? '') ? 'diff' : ''}"><th>${esc(k)}</th><td>${esc(A.meta?.[k] ?? '—')}</td><td>${esc(B.meta?.[k] ?? '—')}</td></tr>`).join('');
  const conflicts = contradictions(A.text, B.text);
  const delta = entityDelta(A.text, B.text);
  await loadScript('/vendor/diff/diff.min.js');
  const big = A.text.length + B.text.length > 400_000;
  // Tokens keep numbers, dates and amounts whole ("05.03.2021" → one token), so changes read as changes.
  const toks = (t) => t.match(/\s+|[\p{L}\p{N}][\p{L}\p{N}.,:/@-]*[\p{L}\p{N}]|[\p{L}\p{N}]|[^\s\p{L}\p{N}]/gu) || [];
  const parts = big ? window.Diff.diffLines(A.text, B.text) : window.Diff.diffArrays(toks(A.text), toks(B.text)).map((p) => ({ ...p, value: p.value.join('') }));
  const added = parts.filter((p) => p.added).reduce((n, p) => n + p.value.length, 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + p.value.length, 0);
  box.innerHTML = `
    <div class="cmp-stats">${A.sha256 === B.sha256 ? '<b>Identical files</b> (same SHA-256).' : `<b>${removed.toLocaleString()}</b> characters only in A · <b>${added.toLocaleString()}</b> only in B · ${conflicts.length} possible contradiction${conflicts.length === 1 ? '' : 's'}`}</div>
    ${propRows ? `<h4>Properties</h4><div class="tw"><table class="docs-table cmp-props"><thead><tr><th></th><th>${esc(A.name)}</th><th>${esc(B.name)}</th></tr></thead><tbody>${propRows}</tbody></table></div>` : ''}
    <h4>Possible contradictions</h4>
    ${conflicts.length ? `<ol class="cmp-conflicts">${conflicts.map((x) => `<li><span class="label conflict">${x.kind === 'date' ? 'Different date' : 'Different number'}</span> <small>${x.similarity}% same wording</small>
      <p><b>A:</b> ${esc(x.a)}</p><p><b>B:</b> ${esc(x.b)}</p><small>A says ${esc(x.onlyA.join(', ') || '—')} · B says ${esc(x.onlyB.join(', ') || '—')}</small></li>`).join('')}</ol>` : '<p class="empty-note">No statements that read the same but carry different dates or numbers.</p>'}
    <h4>Entities</h4>
    <div class="cmp-ent"><div><b>Only in A</b><ul>${delta.onlyA.slice(0, 60).map((e) => `<li>${esc(e.display)} <small>${esc(ENTITY_LABEL[e.type] || e.type)}</small></li>`).join('') || '<li class="muted">none</li>'}</ul></div>
      <div><b>Only in B</b><ul>${delta.onlyB.slice(0, 60).map((e) => `<li>${esc(e.display)} <small>${esc(ENTITY_LABEL[e.type] || e.type)}</small></li>`).join('') || '<li class="muted">none</li>'}</ul></div>
      <div><b>In both</b><ul>${delta.shared.slice(0, 60).map((e) => `<li>${esc(e.display)}</li>`).join('') || '<li class="muted">none</li>'}</ul></div></div>
    <h4>Text changes${big ? ' (by line: the documents are long)' : ''}</h4>
    <pre class="cmp-diff">${parts.map((p) => (p.added ? `<ins>${esc(p.value)}</ins>` : p.removed ? `<del>${esc(p.value)}</del>` : esc(p.value.length > 600 ? `${p.value.slice(0, 280)} … ${p.value.slice(-280)}` : p.value))).join('')}</pre>`;
}

/* ---------------- Duplicates ---------------- */
function duplicates(out, c, docs, deps, paint) {
  const { exact, near } = findDuplicates(docs.map((d) => ({ id: d.id, name: d.name, sha256: d.sha256, simhash: d.simhash, words: d.words })));
  const name = (id) => docs.find((d) => d.id === id)?.name || id;
  const shots = docs.flatMap((d) => [
    ...(d.media?.dhash ? [{ doc: d.id, where: d.name, dhash: d.media.dhash, thumb: d.media.thumb }] : []),
    ...(d.media?.frames || []).map((f) => ({ doc: d.id, where: `${d.name}, ${f.label}`, dhash: f.dhash, thumb: f.thumb })),
  ]);
  const visual = [];
  for (let i = 0; i < shots.length && visual.length < 60; i++) for (let j = i + 1; j < shots.length; j++) {
    if (shots[i].doc === shots[j].doc) continue;
    const bits = hamming(shots[i].dhash, shots[j].dhash);
    if (bits <= 10) visual.push({ a: shots[i], b: shots[j], bits });
  }
  visual.sort((x, y) => x.bits - y.bits);
  out.innerHTML = `<h4>Exact duplicates (same SHA-256)</h4>
    ${exact.length ? `<ul>${exact.map((g) => `<li>${g.map((d) => esc(d.name)).join(' = ')} <small class="mono">${esc(g[0].sha256.slice(0, 16))}…</small></li>`).join('')}</ul>` : '<p class="empty-note">None.</p>'}
    <h4>Near-duplicates and versions (similar text)</h4>
    ${near.length ? `<ul>${near.map((p) => `<li><b>${p.similarity}%</b> ${esc(name(p.a))} ↔ ${esc(name(p.b))} <button type="button" class="linkish" data-cmp="${esc(p.a)}|${esc(p.b)}">compare</button></li>`).join('')}</ul>` : '<p class="empty-note">None. Documents with at least 30 words whose text fingerprints (SimHash) are within 6 of 64 bits are listed here.</p>'}
    <h4>Visually similar images and video frames (perceptual hash)</h4>
    ${visual.length ? `<ul class="vis-pairs">${visual.map((v) => `<li><img src="${esc(v.a.thumb)}" alt=""><img src="${esc(v.b.thumb)}" alt=""><span><b>${v.bits} of 64 bits differ</b><br>${esc(v.a.where)} ↔ ${esc(v.b.where)}</span></li>`).join('')}</ul><p class="panel-sub">Similar hashes survive resizing and recompression. They suggest the same picture, not the same origin: check both files.</p>` : '<p class="empty-note">None found (images and keyframes whose dHash differs in at most 10 of 64 bits).</p>'}`;
  out.querySelectorAll('[data-cmp]').forEach((b) => b.addEventListener('click', () => {
    [ui.a, ui.b] = b.dataset.cmp.split('|');
    ui.view = 'compare';
    paint();
  }));
}

/* ---------------- Review report ---------------- */
export function reviewReport(c, docs) {
  const lines = [`# Document review: ${c.name}`, '', `Generated ${new Date().toISOString()} by Indizia. ${docs.length} documents, analysed in the browser. Embedded properties are claims made by the files; OCR text is machine-recognised and must be checked against the original.`, ''];
  const order = ['relevant', 'followup', 'unreviewed', 'irrelevant'];
  const sorted = [...docs].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  lines.push('| # | Document | Review | Type | Created | SHA-256 |', '|---|---|---|---|---|---|');
  sorted.forEach((d, i) => lines.push(`| D${i + 1} | ${d.name.replace(/\|/g, '\\|')} | ${REVIEW[d.status]} | ${d.label} | ${day(d.meta?.created)} | \`${d.sha256}\` |`));
  lines.push('');
  sorted.forEach((d, i) => {
    lines.push(`## D${i + 1}. ${d.name}`, '');
    lines.push(`- Review: **${REVIEW[d.status]}**${d.tags?.length ? ` · ${d.tags.map((t) => `#${t}`).join(' ')}` : ''}`);
    lines.push(`- Type: ${d.label}${d.signature?.warning ? ` — ${d.signature.warning}` : ''} · ${d.pages.length} part(s)${d.ocrPages ? ` · OCR on ${d.ocrPages}` : ''} · category ${d.category || '—'}`);
    for (const [k, l] of [['title', 'Title'], ['author', 'Author field'], ['company', 'Company field'], ['created', 'Created'], ['modified', 'Modified'], ['application', 'Application']]) if (d.meta?.[k]) lines.push(`- ${l}: ${d.meta[k]}`);
    lines.push(`- SHA-256 \`${d.sha256}\` · added ${d.addedAt}`);
    if (d.note) lines.push(`- Analyst note: ${d.note}`);
    if (d.warnings?.length) lines.push(`- Notes: ${d.warnings.join(' ')}`);
    const ents = (d.entities || []).filter((e) => !['url', 'money'].includes(e.type)).slice(0, 15);
    if (ents.length) lines.push(`- Key entities: ${ents.map((e) => `${e.display} (${ENTITY_LABEL[e.type] || e.type}, p. ${(e.pages || []).slice(0, 4).join(', ')})`).join('; ')}`);
    const dated = (d.dates || []).slice(0, 12);
    if (dated.length) {
      lines.push('', 'Dated statements:', '');
      for (const x of dated) lines.push(`- **${x.date}** (p. ${x.page}): “${x.context}”`);
    }
    lines.push('');
  });
  const pairs = [];
  const rel = sorted.filter((d) => d.status !== 'irrelevant').slice(0, 12);
  for (let i = 0; i < rel.length; i++) for (let j = i + 1; j < rel.length; j++) for (const x of contradictions(rel[i].text, rel[j].text, { limit: 5 })) pairs.push({ a: rel[i], b: rel[j], x });
  if (pairs.length) {
    lines.push('## Possible contradictions', '');
    for (const { a, b, x } of pairs.slice(0, 40)) lines.push(`- **${x.kind === 'date' ? 'Date' : 'Number'}** — ${a.name}: “${x.a}” / ${b.name}: “${x.b}”`);
    lines.push('');
  }
  return lines.join('\n');
}

function mdToBasicHtml(md) {
  return md.split('\n').map((l) => {
    if (l.startsWith('## ')) return `<h2>${esc(l.slice(3))}</h2>`;
    if (l.startsWith('# ')) return `<h1>${esc(l.slice(2))}</h1>`;
    if (l.startsWith('- ')) return `<p>• ${esc(l.slice(2)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>')}</p>`;
    if (l.startsWith('|')) return l.includes('---') ? '' : `<p class="mono">${esc(l)}</p>`;
    return l ? `<p>${esc(l)}</p>` : '';
  }).join('\n');
}

export { snippet };
