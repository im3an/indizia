// Case page: everything for one investigation in one place.
// Tabs: Overview · Evidence · Documents · Graph · Timeline · Notes · Tasks · Searches · Report.

import { getCase, mutate, deleteCase, setActiveCase, activeCaseId, uid, parseTags } from './store.js';
import { saveInvestigation, runQuery, runHeadless, runWorkflow, WORKFLOWS, describeDiff, setWatch, markWatchSeen } from './actions.js';
import { canWatch, nextDue, INTERVAL_LABEL } from './watch.js';
import { isDesktop } from './scheduler.js';
import { caseMarkdown, caseJson, mdToHtml, caseModel } from './report.js';
import { buildTimeline, timelineHtml } from '../timeline.js';
import { renderGraph } from '../ui/graph.js';
import { toSnapshot } from '../snapshot.js';
import { CONFIDENCE_LABEL, download } from '../report.js';
import { detect, DISPLAY } from '../detect.js';
import { renderDocuments } from '../docs/view.js';
import { listDocs } from '../docs/store.js';
import { renderMap } from '../ui/map.js';
import { parseCoordinates } from '../geo/geo.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const TABS = ['overview', 'evidence', 'documents', 'graph', 'map', 'timeline', 'notes', 'tasks', 'searches', 'report'];
const TAB_LABEL = { overview: 'Overview', evidence: 'Evidence', documents: 'Documents', map: 'Map', graph: 'Graph', timeline: 'Timeline', notes: 'Notes', tasks: 'Tasks & leads', searches: 'Searches', report: 'Report' };
const KIND_LABEL = { task: 'Task', lead: 'Lead', question: 'Question' };
const pivotQuery = (p) => (p.type === 'organisation' ? `org:${p.value}` : p.type === 'username' ? `user:${p.value}` : p.type === 'hash' ? `hash:${p.value}` : p.value);

let ui = { tab: 'overview', tagFilter: '', tlFilter: 'all', busy: null };

/**
 * @param {HTMLElement} root container
 * @param {string} caseId
 * @param {{ navigate(q:string):void, toast(msg:string):void, print(html:string, title:string):void }} deps
 */
export async function renderCase(root, caseId, deps, tab) {
  if (tab && TABS.includes(tab)) ui.tab = tab;
  const c = await getCase(caseId);
  if (!c) {
    root.innerHTML = `<div class="case-missing"><h1>Case not found</h1><p class="empty-note">It may have been deleted, or it was created in another browser. Cases are stored only in the browser that created them.</p></div>`;
    return;
  }
  const rerender = (t) => renderCase(root, caseId, deps, t);
  let docs = [];
  const active = activeCaseId() === c.id;
  const model = c.investigations.length ? caseModel(c) : null;
  const counts = {
    evidence: c.evidence.length,
    documents: (docs = await listDocs(c.id)).length,
    map: casePoints(c, docs).length,
    graph: model ? model.stats.entities : 0,
    notes: c.notes.length + c.bookmarks.length,
    tasks: c.tasks.filter((t) => t.status !== 'done').length,
    searches: c.investigations.length,
  };
  const unseen = (c.watchLog || []).filter((e) => !e.seen).length;
  root.innerHTML = `
    <header class="case-head">
      <div class="case-title">
        <div class="eyebrow">Case${c.folder ? ` · ${esc(c.folder)}` : ''} · ${c.status === 'closed' ? 'closed' : 'open'}</div>
        <h1 contenteditable="true" spellcheck="false" data-edit="name" aria-label="Case name">${esc(c.name)}</h1>
      </div>
      <div class="case-actions">
        ${active ? '<span class="lk stated">Active case: new pins and searches land here</span>' : '<button type="button" class="btn" data-act="activate">Make active</button>'}
        <button type="button" class="btn" data-act="print">Print / PDF</button>
        <button type="button" class="btn primary" data-act="md">Export report</button>
      </div>
    </header>
    <div class="tabs case-tabs" role="tablist" aria-label="Case sections">
      ${TABS.map((t) => `<button type="button" role="tab" data-tab="${t}" aria-selected="${ui.tab === t}">${TAB_LABEL[t]}${counts[t] ? ` <span class="count">${counts[t]}</span>` : ''}${t === 'searches' && unseen ? ` <span class="count alert" title="Watch changes since you last looked">${unseen} new</span>` : ''}</button>`).join('')}
    </div>
    <section class="case-body" id="case-body"></section>`;

  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    ui.tab = b.dataset.tab;
    history.replaceState({}, '', `/?case=${encodeURIComponent(c.id)}${ui.tab !== 'overview' ? `&tab=${ui.tab}` : ''}`);
    rerender();
  }));
  const h1 = root.querySelector('[data-edit="name"]');
  h1.addEventListener('keydown', (ev) => ev.key === 'Enter' && (ev.preventDefault(), h1.blur()));
  h1.addEventListener('blur', async () => {
    const name = h1.textContent.trim();
    if (name && name !== c.name) {
      await mutate(c.id, (x) => ((x.name = name), `Renamed case to “${name}”`));
      document.title = `${name} · Indizia`;
    } else h1.textContent = c.name;
  });
  root.querySelector('[data-act="activate"]')?.addEventListener('click', () => {
    setActiveCase(c.id);
    deps.toast(`“${c.name}” is now the active case`);
    rerender();
  });
  root.querySelector('[data-act="md"]').addEventListener('click', async () => download(`indizia-case-${slug(c.name)}-${today()}.md`, await caseMarkdown(c)));
  root.querySelector('[data-act="print"]').addEventListener('click', async () => deps.print(mdToHtml(await caseMarkdown(c)), c.name));
  document.title = `${c.name} · Indizia`;

  const body = root.querySelector('#case-body');
  const ctx = { c, model, body, deps, rerender };
  ({ overview, evidence, documents: renderDocuments, graph, map: (x) => caseMap({ ...x, docs }), timeline, notes, tasks, searches, report })[ui.tab](ctx);
}

const slug = (s) => String(s).toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'case';
const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- Overview ---------------- */
function overview({ c, model, body, deps, rerender }) {
  const inferred = model ? model.edges.filter((e) => e.kind === 'inferred').sort((a, b) => b.confidence - a.confidence) : [];
  const name = new Map((model?.nodes || []).map((n) => [n.id, n.label]));
  const open = c.tasks.filter((t) => t.status !== 'done');
  body.innerHTML = `
    <div class="case-grid">
      <div class="case-main">
        ${watchChangesPanel(c, { compact: true })}
        <div class="stats">
          ${stat(c.investigations.length, 'searches')}${stat(c.evidence.length, 'evidence items')}${stat(model?.stats.entities || 0, 'entities')}${stat(inferred.length, 'inferred links')}${stat(open.length, 'open tasks & leads')}
        </div>
        <section class="panel">
          <h2>Description</h2>
          <textarea class="case-desc" data-edit="description" rows="3" placeholder="What is this case about? Scope, client, hypothesis…">${esc(c.description)}</textarea>
        </section>
        <section class="panel">
          <h2>Strongest inferred links</h2>
          <p class="panel-sub">Computed from shared attributes across all searches in this case. Hypotheses, not facts. Open the Graph tab to see why.</p>
          ${inferred.length ? `<ul class="mini-links">${inferred.slice(0, 6).map((e) => `<li><span>${esc(name.get(e.a))} <em>${esc(e.label)}</em> ${esc(name.get(e.b))}</span><b>${Math.round(e.confidence * 100)}%</b><small>${esc(e.reasons[0]?.text || '')}</small></li>`).join('')}</ul>` : '<p class="empty-note">No inferred links yet. Save two or more related searches (for example two domains you suspect share an operator).</p>'}
        </section>
        <section class="panel">
          <h2>Quick note</h2>
          <form class="inline-form" data-form="note"><textarea name="text" rows="2" placeholder="Write a finding, hypothesis or reminder… #tags work"></textarea><button class="btn">Add note</button></form>
        </section>
      </div>
      <aside class="case-side">
        <section class="panel">
          <h2>Details</h2>
          <dl class="kv">
            <dt>Folder</dt><dd><input class="inline-input" data-edit="folder" value="${esc(c.folder)}" placeholder="e.g. Client X / Phishing"></dd>
            <dt>Status</dt><dd><select class="inline-input" data-edit="status"><option value="open" ${c.status === 'open' ? 'selected' : ''}>Open</option><option value="closed" ${c.status === 'closed' ? 'selected' : ''}>Closed</option></select></dd>
            <dt>Created</dt><dd>${esc(when(c.createdAt))}</dd>
            <dt>Changed</dt><dd>${esc(when(c.updatedAt))}</dd>
          </dl>
          <label class="check"><input type="checkbox" data-edit="autoSave" ${c.autoSave ? 'checked' : ''}> Save every search to this case while it is active</label>
        </section>
        <section class="panel">
          <h2>Open tasks & leads</h2>
          ${open.length ? `<ul class="mini-tasks">${open.slice(0, 6).map((t) => `<li><span class="kind ${t.kind}">${KIND_LABEL[t.kind]}</span>${esc(t.text)}</li>`).join('')}</ul>` : '<p class="panel-sub">Nothing open.</p>'}
        </section>
        <section class="panel">
          <h2>Recent activity</h2>
          <ol class="activity">${c.activity.slice(-10).reverse().map((a) => `<li><time>${esc(when(a.at))}</time>${esc(a.text)}</li>`).join('')}</ol>
        </section>
        <section class="panel danger">
          <h2>Delete case</h2>
          <p class="panel-sub">Removes it from this browser. Export the report first if you need a record.</p>
          <button type="button" class="btn" data-act="delete">Delete case</button>
        </section>
      </aside>
    </div>`;
  bindFields(body, c, rerender);
  bindWatchChanges(body, c, rerender);
  body.querySelector('[data-form="note"]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = ev.target.text.value.trim();
    if (!text) return;
    await addNote(c.id, text);
    deps.toast('Note added');
    rerender();
  });
  body.querySelector('[data-act="delete"]').addEventListener('click', async (ev) => {
    if (ev.target.dataset.confirm !== '1') {
      ev.target.dataset.confirm = '1';
      ev.target.textContent = 'Click again to delete permanently';
      return;
    }
    await deleteCase(c.id);
    deps.toast('Case deleted');
    deps.navigate(null);
  });
}

const stat = (n, label) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`;

function bindFields(scope, c, rerender) {
  scope.querySelectorAll('[data-edit]').forEach((input) => {
    const k = input.dataset.edit;
    const ev = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'blur';
    input.addEventListener(ev, async () => {
      const v = input.type === 'checkbox' ? input.checked : input.value.trim();
      if (v === c[k]) return;
      await mutate(c.id, (x) => {
        x[k] = v;
        return k === 'description' ? 'Edited the description' : k === 'autoSave' ? `Auto-save ${v ? 'on' : 'off'}` : `Set ${k} to “${v}”`;
      });
      if (k !== 'description') rerender();
    });
  });
}

async function addNote(caseId, text, extraTags = []) {
  const tags = [...new Set([...(text.match(/#[\w-]+/g) || []).map((t) => t.slice(1).toLowerCase()), ...extraTags])];
  await mutate(caseId, (x) => {
    x.notes.unshift({ id: uid('n'), text, tags, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return `Added a note${tags.length ? ` (${tags.map((t) => '#' + t).join(' ')})` : ''}`;
  });
}

/* ---------------- Evidence ---------------- */
function evidence({ c, body, deps, rerender }) {
  const tags = [...new Set(c.evidence.flatMap((e) => e.tags || []))].sort();
  const list = c.evidence.filter((e) => !ui.tagFilter || e.tags?.includes(ui.tagFilter));
  body.innerHTML = `
    <div class="section-head">
      <h2>Evidence <span class="count">${c.evidence.length}</span></h2>
      ${tags.length ? `<div class="filters" role="radiogroup" aria-label="Filter by tag"><button type="button" role="radio" aria-checked="${!ui.tagFilter}" data-tag="">All</button>${tags.map((t) => `<button type="button" role="radio" aria-checked="${ui.tagFilter === t}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
    </div>
    <p class="panel-sub">Pinned findings with their citation: request, retrieval time and a SHA-256 fingerprint of the response. Pin from any results page with <kbd>p</kbd> or the Pin button.</p>
    ${list.length ? `<ol class="evidence-list">${list.map((e, i) => evidenceRow(e, c.evidence.indexOf(e))).join('')}</ol>` : '<p class="empty-note">No evidence yet. Run a search while this case is active and pin the findings that matter.</p>'}`;
  body.querySelectorAll('[data-tag]').forEach((b) => b.addEventListener('click', () => {
    ui.tagFilter = b.dataset.tag;
    rerender();
  }));
  body.querySelectorAll('.evidence-item').forEach((li) => {
    const id = li.dataset.id;
    li.querySelector('[data-f="tags"]').addEventListener('change', async (ev) => {
      const tags2 = parseTags(ev.target.value);
      await mutate(c.id, (x) => {
        const e = x.evidence.find((y) => y.id === id);
        e.tags = tags2;
        return `Tagged evidence “${e.title.slice(0, 60)}” ${tags2.map((t) => '#' + t).join(' ') || '(no tags)'}`;
      });
      rerender();
    });
    li.querySelector('[data-f="note"]').addEventListener('change', async (ev) => {
      await mutate(c.id, (x) => {
        const e = x.evidence.find((y) => y.id === id);
        e.note = ev.target.value.trim();
        return `Annotated evidence “${e.title.slice(0, 60)}”`;
      });
      deps.toast('Note saved');
    });
    li.querySelector('[data-act="remove"]').addEventListener('click', async () => {
      await mutate(c.id, (x) => {
        const e = x.evidence.find((y) => y.id === id);
        x.evidence = x.evidence.filter((y) => y.id !== id);
        return `Removed evidence “${e.title.slice(0, 60)}”`;
      });
      rerender();
    });
    li.querySelector('[data-act="query"]')?.addEventListener('click', () => deps.navigate(li.dataset.query));
  });
}

function evidenceRow(e, i) {
  const ev = e.evidence || {};
  return `<li class="evidence-item" data-id="${esc(e.id)}" data-query="${esc(e.queryType === 'organisation' ? `org:${e.query}` : e.query)}" data-conf="${esc(e.confidence)}">
    <div class="ev-head"><span class="ev-no">E${i + 1}</span><span class="label ${esc(e.confidence)}">${esc(CONFIDENCE_LABEL[e.confidence] || e.confidence)}</span><p class="f-title">${esc(e.title)}</p></div>
    ${e.detail ? `<p class="f-detail">${esc(e.detail)}</p>` : ''}
    <dl class="kv">
      <dt>Source</dt><dd>${esc(e.source)}${e.provider ? ` · ${esc(e.provider)}` : ''}${e.reliability ? ` · <b class="grade g-${esc(e.reliability)}" title="Source reliability">${esc(e.reliability)}</b>` : ''}</dd>
      ${ev.url ? `<dt>Request</dt><dd class="mono">${ev.local ? esc(ev.url) : `<a href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">${esc(ev.url)}</a>`}${ev.status ? ` · HTTP ${esc(ev.status)}` : ''}</dd>` : ''}
      ${ev.retrievedAt ? `<dt>Retrieved</dt><dd class="mono">${esc(ev.retrievedAt)}</dd>` : ''}
      ${ev.sha256 ? `<dt>SHA-256</dt><dd class="mono">${esc(ev.sha256)}</dd>` : ''}
      <dt>From</dt><dd><button type="button" class="linkish" data-act="query">${esc(e.query)}</button> · pinned ${esc(when(e.pinnedAt))}</dd>
    </dl>
    ${ev.excerpt ? `<details class="more"><summary>Response excerpt</summary><pre class="raw">${esc(ev.excerpt)}</pre></details>` : ''}
    <div class="ev-edit">
      <label>Tags <input data-f="tags" value="${esc((e.tags || []).join(', '))}" placeholder="phishing, infra"></label>
      <label>Analyst note <input data-f="note" value="${esc(e.note || '')}" placeholder="Why this matters…"></label>
      <button type="button" class="btn ghost" data-act="remove">Remove</button>
    </div>
  </li>`;
}

/* ---------------- Map ---------------- */
/** Every point in the case: saved searches (with their stated accuracy), photo GPS and coordinates in documents. */
function casePoints(c, docs) {
  const pts = [];
  const seen = new Set();
  const push = (p) => {
    const k = `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.label}`;
    if (seen.has(k)) return;
    seen.add(k);
    pts.push(p);
  };
  for (const inv of c.investigations) for (const g of inv.snapshot?.geo || []) push({ ...g, source: `${g.source} · search “${inv.query}”`, date: inv.savedAt });
  for (const d of docs) {
    if (d.meta?.gps) push({ lat: d.meta.gps.lat, lon: d.meta.gps.lon, label: `${d.name} (EXIF GPS)`, source: 'Document workspace · embedded GPS', precision: 'exact', kind: 'file', date: d.meta.taken || null });
    for (const e of (d.entities || []).filter((x) => x.type === 'coordinates')) {
      const ll = parseCoordinates(e.value);
      if (ll) push({ ...ll, label: `${d.name}, p. ${(e.pages || []).join(', ')}: ${e.context.slice(0, 80)}`, source: 'Document workspace · coordinates in the text', precision: 'exact', kind: 'doc' });
    }
  }
  return pts;
}

function caseMap({ c, body, deps, docs }) {
  const pts = casePoints(c, docs);
  body.innerHTML = `<p class="panel-sub">Points from the searches saved in this case (with the accuracy each source states), photo GPS and coordinates written in the case documents. Import your own GeoJSON or CSV to put them in context.</p><div class="view geo-case"></div>`;
  renderMap(body.querySelector('.geo-case'), pts, { navigate: deps.navigate }).catch(() => (body.querySelector('.geo-case').innerHTML = '<p class="empty-note">The map library could not be loaded.</p>'));
}

/* ---------------- Graph ---------------- */
function graph({ c, body, deps }) {
  if (!c.investigations.length) {
    body.innerHTML = '<p class="empty-note">The case graph links every search saved in this case. Save at least one search first.</p>';
    return;
  }
  body.innerHTML = `<p class="panel-sub">${c.investigations.length} searches resolved into one graph. Entities found in several searches are merged, so separate leads that share infrastructure, identifiers or tracking IDs connect here.</p><div id="case-graph" class="view"></div>`;
  const box = body.querySelector('#case-graph');
  // Keep positions when the user comes back to the tab.
  const mems = (graph.mems ||= new Map());
  if (mems.has(c.id)) box._graphMem = mems.get(c.id);
  renderGraph(box, { snapshots: c.investigations.map((i) => i.snapshot) }, { onOpen: (n) => deps.navigate(pivotQuery(n)) });
  mems.set(c.id, box._graphMem);
}

/* ---------------- Timeline ---------------- */
function timeline({ c, body, rerender }) {
  const items = buildTimeline(c.investigations.map((i) => i.snapshot), c.activity);
  body.innerHTML = `
    <div class="section-head">
      <h2>Timeline</h2>
      <div class="filters" role="radiogroup" aria-label="Filter timeline">
        ${[['all', 'Everything'], ['event', 'Findings'], ['activity', 'Case changes']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${ui.tlFilter === k}" data-tl="${k}">${l}</button>`).join('')}
      </div>
    </div>
    <p class="panel-sub">Dated facts from every source (registration, certificates, DNS history, scans, archive captures, publications) and the case’s own audit trail.</p>
    ${timelineHtml(items, { multi: c.investigations.length > 1, filter: ui.tlFilter })}`;
  body.querySelectorAll('[data-tl]').forEach((b) => b.addEventListener('click', () => {
    ui.tlFilter = b.dataset.tl;
    rerender();
  }));
}

/* ---------------- Notes & bookmarks ---------------- */
function notes({ c, body, deps, rerender }) {
  const tags = [...new Set([...c.notes, ...c.bookmarks].flatMap((n) => n.tags || []))].sort();
  const flt = (n) => !ui.tagFilter || n.tags?.includes(ui.tagFilter);
  body.innerHTML = `
    <div class="case-grid">
      <div class="case-main">
        <form class="panel inline-form stacked" data-form="note">
          <h2>New note</h2>
          <textarea name="text" rows="4" placeholder="Observations, hypotheses, interview notes… Use #tags to group them."></textarea>
          <div><button class="btn primary">Add note</button></div>
        </form>
        ${tags.length ? `<div class="filters" role="radiogroup" aria-label="Filter by tag"><button type="button" role="radio" aria-checked="${!ui.tagFilter}" data-tag="">All</button>${tags.map((t) => `<button type="button" role="radio" aria-checked="${ui.tagFilter === t}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
        <ol class="notes">${c.notes.filter(flt).map((n) => `<li data-id="${esc(n.id)}"><div class="note-meta"><time>${esc(when(n.createdAt))}</time>${(n.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}<button type="button" class="linkish" data-act="del-note">Delete</button></div><p class="note-text" contenteditable="true" spellcheck="true">${esc(n.text)}</p></li>`).join('') || '<li class="empty-note">No notes yet.</li>'}</ol>
      </div>
      <aside class="case-side">
        <form class="panel inline-form stacked" data-form="bookmark">
          <h2>Bookmarks</h2>
          <p class="panel-sub">Pages you found by hand: profiles, filings, articles.</p>
          <input name="url" type="url" required placeholder="https://…">
          <input name="title" placeholder="Title (optional)">
          <input name="tags" placeholder="Tags, comma separated">
          <div><button class="btn">Add bookmark</button></div>
        </form>
        <ul class="bookmarks">${c.bookmarks.filter(flt).map((b) => `<li data-id="${esc(b.id)}"><a href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${esc(b.title || b.url)} ↗</a><small>${esc(new URL(b.url).hostname)}${(b.tags || []).map((t) => ` #${esc(t)}`).join('')}</small><button type="button" class="linkish" data-act="del-bm">Remove</button></li>`).join('')}</ul>
      </aside>
    </div>`;
  body.querySelector('[data-form="note"]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = ev.target.text.value.trim();
    if (!text) return;
    await addNote(c.id, text);
    rerender();
  });
  body.querySelector('[data-form="bookmark"]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    let url;
    try {
      url = new URL(f.url.value.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error();
    } catch {
      return deps.toast('Enter a web address starting with http:// or https://');
    }
    await mutate(c.id, (x) => {
      x.bookmarks.unshift({ id: uid('b'), url: url.href, title: f.title.value.trim(), tags: parseTags(f.tags.value), createdAt: new Date().toISOString() });
      return `Bookmarked ${url.href}`;
    });
    rerender();
  });
  body.querySelectorAll('[data-tag]').forEach((b) => b.addEventListener('click', () => {
    ui.tagFilter = b.dataset.tag;
    rerender();
  }));
  body.querySelectorAll('.notes li[data-id]').forEach((li) => {
    const id = li.dataset.id;
    li.querySelector('.note-text').addEventListener('blur', async (ev) => {
      const text = ev.target.innerText.trim();
      const n = c.notes.find((x) => x.id === id);
      if (!text || text === n.text) return;
      await mutate(c.id, (x) => {
        const m = x.notes.find((y) => y.id === id);
        m.text = text;
        m.tags = [...new Set((text.match(/#[\w-]+/g) || []).map((t) => t.slice(1).toLowerCase()))];
        m.updatedAt = new Date().toISOString();
        return 'Edited a note';
      });
      deps.toast('Note saved');
    });
    li.querySelector('[data-act="del-note"]').addEventListener('click', async () => {
      await mutate(c.id, (x) => ((x.notes = x.notes.filter((y) => y.id !== id)), 'Deleted a note'));
      rerender();
    });
  });
  body.querySelectorAll('.bookmarks li').forEach((li) =>
    li.querySelector('[data-act="del-bm"]').addEventListener('click', async () => {
      await mutate(c.id, (x) => ((x.bookmarks = x.bookmarks.filter((y) => y.id !== li.dataset.id)), 'Removed a bookmark'));
      rerender();
    }),
  );
}

/* ---------------- Tasks, leads, questions ---------------- */
function tasks({ c, body, deps, rerender }) {
  const open = c.tasks.filter((t) => t.status !== 'done');
  const done = c.tasks.filter((t) => t.status === 'done');
  const row = (t) => `<li class="task ${t.status}" data-id="${esc(t.id)}">
    <input type="checkbox" ${t.status === 'done' ? 'checked' : ''} aria-label="Done">
    <span class="kind ${t.kind}">${KIND_LABEL[t.kind]}</span>
    <span class="task-text">${esc(t.text)}${t.query ? ` <button type="button" class="pivot" data-q="${esc(t.query)}">→ ${esc(t.query)}</button>` : ''}</span>
    <small>${esc(when(t.doneAt || t.createdAt))}</small>
    <button type="button" class="linkish" data-act="del">Delete</button>
  </li>`;
  body.innerHTML = `
    <form class="panel inline-form task-form" data-form="task">
      <select name="kind" aria-label="Kind"><option value="task">Task</option><option value="lead">Lead</option><option value="question">Open question</option></select>
      <input name="text" required placeholder="What needs doing, following up or answering?">
      <input name="query" placeholder="Optional search, e.g. example.com">
      <button class="btn primary">Add</button>
    </form>
    <h2 class="sub-h">Open <span class="count">${open.length}</span></h2>
    <ul class="tasks">${open.map(row).join('') || '<li class="empty-note">Nothing open. Add leads from a results page with “+ Lead” in Next steps.</li>'}</ul>
    ${done.length ? `<h2 class="sub-h">Done <span class="count">${done.length}</span></h2><ul class="tasks">${done.map(row).join('')}</ul>` : ''}`;
  body.querySelector('[data-form="task"]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const text = f.text.value.trim();
    if (!text) return;
    await mutate(c.id, (x) => {
      x.tasks.unshift({ id: uid('t'), kind: f.kind.value, text, query: f.query.value.trim() || null, status: 'open', createdAt: new Date().toISOString(), doneAt: null });
      return `Added ${KIND_LABEL[f.kind.value].toLowerCase()}: ${text}`;
    });
    rerender();
  });
  body.querySelectorAll('.task').forEach((li) => {
    const id = li.dataset.id;
    li.querySelector('input[type=checkbox]').addEventListener('change', async (ev) => {
      await mutate(c.id, (x) => {
        const t = x.tasks.find((y) => y.id === id);
        t.status = ev.target.checked ? 'done' : 'open';
        t.doneAt = ev.target.checked ? new Date().toISOString() : null;
        return `${ev.target.checked ? 'Closed' : 'Reopened'} ${KIND_LABEL[t.kind].toLowerCase()}: ${t.text}`;
      });
      rerender();
    });
    li.querySelector('[data-act="del"]').addEventListener('click', async () => {
      await mutate(c.id, (x) => ((x.tasks = x.tasks.filter((y) => y.id !== id)), 'Deleted a task'));
      rerender();
    });
    li.querySelector('[data-q]')?.addEventListener('click', (ev) => deps.navigate(ev.target.dataset.q));
  });
}

/* ---------------- Saved searches and workflows ---------------- */
function searches({ c, body, deps, rerender }) {
  body.innerHTML = `
    <div class="case-grid">
      <div class="case-main">
        <div class="section-head">
          <h2>Saved searches <span class="count">${c.investigations.length}</span></h2>
          ${c.investigations.length ? `<button type="button" class="btn" data-act="rerun-all" ${ui.busy ? 'disabled' : ''}>Re-run all and compare</button>` : ''}
        </div>
        <p class="panel-sub">Each search keeps its full snapshot. Re-running records what changed: new findings, findings that disappeared, facts with new values. Watch a search to re-run it daily or weekly ${isDesktop() ? 'while Indizia runs, also with its window closed (you get a notification when something changes)' : 'while Indizia is open in a tab'}. Username, email and phone searches are never re-run automatically.</p>
        ${watchChangesPanel(c)}
        <div class="busy" ${ui.busy ? '' : 'hidden'} aria-live="polite">${esc(ui.busy || '')}</div>
        <ol class="saved">${c.investigations.map((inv) => savedRow(inv)).join('') || '<li class="empty-note">No saved searches. Run a search while this case is active, or add one here.</li>'}</ol>
        <form class="panel inline-form" data-form="add">
          <input name="q" required placeholder="Add a search: domain, IP, org:Company, LEI…">
          <button class="btn" ${ui.busy ? 'disabled' : ''}>Run and save</button>
        </form>
      </div>
      <aside class="case-side">
        <section class="panel">
          <h2>Workflows</h2>
          <p class="panel-sub">Repeatable multi-step research: a seed search, then the pivots it finds, all saved to this case.</p>
          <form class="inline-form stacked" data-form="workflow">
            <select name="wf">${WORKFLOWS.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>
            <p class="panel-sub wf-desc">${esc(WORKFLOWS[0].describe)}</p>
            <input name="seed" required placeholder="${esc(WORKFLOWS[0].example)}">
            <div><button class="btn primary" ${ui.busy ? 'disabled' : ''}>Run workflow</button></div>
          </form>
        </section>
      </aside>
    </div>`;
  const setBusy = (text) => {
    ui.busy = text;
    const b = body.querySelector('.busy');
    if (b) {
      b.hidden = !text;
      b.textContent = text || '';
    }
  };
  const wfSel = body.querySelector('[name="wf"]');
  wfSel.addEventListener('change', () => {
    const w = WORKFLOWS.find((x) => x.id === wfSel.value);
    body.querySelector('.wf-desc').textContent = w.describe;
    body.querySelector('[name="seed"]').placeholder = w.example;
  });
  body.querySelector('[data-form="workflow"]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const w = WORKFLOWS.find((x) => x.id === wfSel.value);
    const seed = ev.target.seed.value.trim();
    if (!seed || ui.busy) return;
    try {
      setBusy(`${w.name}: starting…`);
      const steps = await runWorkflow(c.id, w, seed, (p) => setBusy(`${w.name} · step ${p.step} of ${p.total}: ${p.label}`));
      deps.toast(`${w.name}: ${steps.length} searches saved`);
    } catch (err) {
      deps.toast(err.message);
    }
    setBusy(null);
    rerender();
  });
  body.querySelector('[data-form="add"]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const q = ev.target.q.value.trim();
    if (!q || ui.busy) return;
    try {
      setBusy(`Searching ${q}…`);
      const r = await runQuery(c.id, q);
      if (!r) deps.toast('Could not understand that input');
    } catch (err) {
      deps.toast(err.message);
    }
    setBusy(null);
    rerender();
  });
  body.querySelector('[data-act="rerun-all"]')?.addEventListener('click', async () => {
    if (ui.busy) return;
    const list = [...c.investigations];
    const changes = [];
    for (let i = 0; i < list.length; i++) {
      const inv = list[i];
      if (inv.root.type === 'username' || inv.root.type === 'file') continue;
      setBusy(`Re-running ${i + 1} of ${list.length}: ${inv.query}`);
      const state = await runHeadless(detect(inv.query) || inv.root);
      const { diff } = await saveInvestigation(c.id, toSnapshot(state), inv.query);
      if (diff) changes.push(`${inv.query}: ${describeDiff(diff)}`);
    }
    await mutate(c.id, () => `Re-ran all ${list.length} searches${changes.length ? ` — ${changes.join('; ')}` : ''}`);
    setBusy(null);
    deps.toast('All searches re-run. Changes are listed under each search.');
    rerender();
  });
  bindWatchChanges(body, c, rerender);
  body.querySelectorAll('.saved > li[data-id]').forEach((li) => {
    const inv = c.investigations.find((x) => x.id === li.dataset.id);
    li.querySelector('[data-act="watch"]')?.addEventListener('change', async (ev) => {
      try {
        await setWatch(c.id, inv.id, ev.target.value || null);
        deps.toast(ev.target.value ? `Watching “${inv.query}” ${ev.target.value}` : `Stopped watching “${inv.query}”`);
      } catch (err) {
        deps.toast(err.message);
      }
      rerender();
    });
    li.querySelector('[data-act="open"]').addEventListener('click', () => deps.navigate(inv.query));
    li.querySelector('[data-act="rerun"]').addEventListener('click', async () => {
      if (ui.busy) return;
      if (inv.root.type === 'username' || inv.root.type === 'file') return deps.toast('Open it to run it again');
      setBusy(`Re-running ${inv.query}…`);
      const state = await runHeadless(detect(inv.query) || inv.root);
      const { diff } = await saveInvestigation(c.id, toSnapshot(state), inv.query);
      setBusy(null);
      deps.toast(diff ? `${inv.query}: ${describeDiff(diff)}` : 'Saved');
      rerender();
    });
    li.querySelector('[data-act="remove"]').addEventListener('click', async () => {
      await mutate(c.id, (x) => ((x.investigations = x.investigations.filter((y) => y.id !== inv.id)), `Removed saved search “${inv.query}”`));
      rerender();
    });
  });
}

function savedRow(inv) {
  const s = inv.snapshot;
  const real = (s.ledger || []).filter((r) => r.state !== 'not_applicable');
  const d = inv.lastDiff;
  const diffHtml = d && (d.added.length || d.removed.length || d.grown.length || d.changed.length)
    ? `<details class="more diff"><summary>Changes in the last re-run</summary><ul class="hostlist">${[
      ...d.added.map((t) => `<li class="add">+ ${esc(t)}</li>`),
      ...d.removed.map((t) => `<li class="del">− ${esc(t)}</li>`),
      ...d.grown.map((t) => `<li class="chg">~ ${esc(t)}</li>`),
      ...d.changed.map((t) => `<li class="chg">~ ${esc(t)}</li>`),
    ].join('')}</ul></details>`
    : '';
  return `<li data-id="${esc(inv.id)}">
    <div class="saved-head">
      <span class="chip">${esc(DISPLAY[s.root.type] || s.root.type)}</span>
      <b class="mono">${esc(inv.query)}</b>
      <span class="saved-actions">${watchControl(inv)}<button type="button" class="btn ghost" data-act="open">Open</button><button type="button" class="btn ghost" data-act="rerun">Re-run</button><button type="button" class="btn ghost" data-act="remove">Remove</button></span>
    </div>
    <small>${s.findings.length} findings · ${real.filter((r) => r.state === 'done').length}/${real.length} sources answered · last run ${esc(when(s.finishedAt || s.startedAt))}${inv.runs?.length > 1 ? ` · ${inv.runs.length} runs` : ''}${inv.runs?.at(-1)?.change ? ` · ${esc(inv.runs.at(-1).change)}` : ''}</small>
    ${watchStatus(inv)}
    ${diffHtml}
  </li>`;
}

/* ---------------- Watches ---------------- */
function watchControl(inv) {
  const type = inv.snapshot?.root?.type || inv.root?.type;
  if (!canWatch(type)) return `<span class="watch-off" title="Restricted lenses and files need you to run them: they are never re-run automatically">Not watchable</span>`;
  const v = inv.watch?.interval || '';
  return `<label class="watch-sel${v ? ' on' : ''}"><span>Watch</span><select data-act="watch" aria-label="Watch “${esc(inv.query)}”">
    <option value="" ${v ? '' : 'selected'}>Off</option>${Object.entries(INTERVAL_LABEL).map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
}

function watchStatus(inv) {
  const w = inv.watch;
  if (!w) return '';
  const due = nextDue(w);
  const next = due <= Date.now() ? 'due now' : `next ${when(new Date(due).toISOString())}`;
  return `<small class="watch-status">Watching ${esc(INTERVAL_LABEL[w.interval].toLowerCase())} · last check ${esc(when(w.lastCheck))} · ${esc(next)}${w.retryAt ? ' · last check got no answer, retrying' : ''}${w.carry?.length ? ` · ${w.carry.length} finding${w.carry.length === 1 ? '' : 's'} waiting for a source to answer again` : ''}</small>`;
}

const diffList = (e) => `<ul class="hostlist">${[
  ...e.added.map((t) => `<li class="add">+ ${esc(t)}</li>`),
  ...e.removed.map((t) => `<li class="del">− ${esc(t)}</li>`),
  ...e.grown.map((t) => `<li class="chg">~ ${esc(t)}</li>`),
  ...e.changed.map((t) => `<li class="chg">~ ${esc(t)}</li>`),
].join('')}</ul>`;

/** "Changes since you last looked": unseen watch results, newest first. Compact on the overview. */
function watchChangesPanel(c, { compact = false } = {}) {
  const log = c.watchLog || [];
  const unseen = log.filter((e) => !e.seen).reverse();
  const watched = c.investigations.filter((i) => i.watch).length;
  if (compact && !unseen.length) return '';
  if (!unseen.length && !log.length) return '';
  const item = (e, open) => `<li><details class="more diff" ${open ? 'open' : ''}><summary><b class="mono">${esc(e.query)}</b>: ${esc(e.summary)} <time>${esc(when(e.at))}</time></summary>${diffList(e)}${e.unanswered?.length ? `<p class="panel-sub">Did not answer this time: ${esc(e.unanswered.join(', '))}. Their findings are compared on the next check.</p>` : ''}</details></li>`;
  const earlier = log.filter((e) => e.seen).slice(-10).reverse();
  return `<section class="panel watch-changes${unseen.length ? ' has-new' : ''}" data-watch-panel>
    <div class="section-head"><h2>Changes since you last looked ${unseen.length ? `<span class="count alert">${unseen.length}</span>` : ''}</h2>
      ${unseen.length ? `<button type="button" class="btn" data-act="watch-seen">Mark as seen</button>` : ''}</div>
    ${unseen.length ? `<ol class="watch-log">${unseen.slice(0, compact ? 3 : 50).map((e, i) => item(e, !compact && i < 3)).join('')}</ol>${compact && unseen.length > 3 ? `<p class="panel-sub">${unseen.length - 3} more in the Searches tab.</p>` : ''}`
      : `<p class="panel-sub">Nothing new. ${watched} search${watched === 1 ? '' : 'es'} watched.</p>`}
    ${!compact && earlier.length ? `<details class="more"><summary>Earlier changes (${earlier.length})</summary><ol class="watch-log">${earlier.map((e) => item(e, false)).join('')}</ol></details>` : ''}
  </section>`;
}

function bindWatchChanges(body, c, rerender) {
  body.querySelector('[data-act="watch-seen"]')?.addEventListener('click', async () => {
    await markWatchSeen(c.id);
    rerender();
  });
}

/* ---------------- Report ---------------- */
async function report({ c, body, deps }) {
  body.innerHTML = `
    <div class="section-head">
      <h2>Audit-ready report</h2>
      <div class="drawer-actions">
        <button type="button" class="btn primary" data-act="md">Download Markdown</button>
        <button type="button" class="btn" data-act="print">Print / save as PDF</button>
        <button type="button" class="btn" data-act="json">Download JSON bundle</button>
      </div>
    </div>
    <p class="panel-sub">Scope and method, every search with its coverage gaps, evidence with citations and response fingerprints, stated and inferred links with their reasons, timeline, notes, tasks and the full audit trail. The last line is a SHA-256 over the report, so edits after export can be detected.</p>
    <article class="report-preview"><p class="empty-note">Building the report…</p></article>`;
  const md = await caseMarkdown(c);
  body.querySelector('.report-preview').innerHTML = mdToHtml(md);
  body.querySelector('[data-act="md"]').addEventListener('click', () => download(`indizia-case-${slug(c.name)}-${today()}.md`, md));
  body.querySelector('[data-act="json"]').addEventListener('click', () => download(`indizia-case-${slug(c.name)}-${today()}.json`, caseJson(c)));
  body.querySelector('[data-act="print"]').addEventListener('click', () => deps.print(mdToHtml(md), c.name));
}
