import { detect, DISPLAY, RESTRICTED, LENS_HINT } from './detect.js';
import { startInvestigation, FINAL_STATES } from './engine.js';
import { budgetSummary } from './questions.js';
import { apiHealth } from './http.js';
import { investigationMarkdown, download, STATE_LABEL, CONFIDENCE_LABEL } from './report.js';
import { getSettings, setSetting } from './settings.js';
import { fav, sourceFav, hostOf, setIconApi, SEARCH_ICON, paintRange } from './ui/icons.js';
import { renderGraph, countEntities } from './ui/graph.js';
import { toSnapshot, evidenceItem } from './snapshot.js';
import { buildTimeline, timelineHtml, timesketchJsonl } from './timeline.js';
import { listCases, getCase, createCase, mutate, activeCaseId, setActiveCase, onChange as onCasesChange, migrateLegacyPins, uid, isPersistent } from './workspace/store.js';
import { saveInvestigation } from './workspace/actions.js';
import { renderCase } from './workspace/view.js';
import { startWatchScheduler, desktopPost } from './workspace/scheduler.js';
import { renderMap } from './ui/map.js';
import { localSuggestions, remoteSuggestions, highlight, pushHistory, clearHistory } from './ui/suggest.js';
import { loadTools, searchTools } from './tools.js';
import { toolboxStatus, installTool, cleanToolbox } from './sources/toolbox.js';
import { renderAgent, stopAgent } from './agent/view.js';
import { parse as parseQuery, findingMatches } from './findquery.js';

const $ = (id) => document.getElementById(id);
const el = {
  body: document.body, root: document.documentElement, topbar: $('topbar'), q: $('q'), form: $('search'), detect: $('detect'), suggest: $('suggest'),
  home: $('home'), main: $('main'), entity: $('entity'), coverage: $('coverage'), restricted: $('restricted'), gate: $('gate'), layout: $('layout'),
  cards: $('cards'), findings: $('findings'), findingsCount: $('findings-count'), findingsEmpty: $('findings-empty'),
  ledger: $('ledger'), next: $('next'), nextPanel: $('next-panel'), launch: $('launch'),
  drawer: $('drawer'), drawerBody: $('drawer-body'), drawerTitle: $('drawer-title'), scrim: $('scrim'),
  caseBtn: $('case-btn'), caseCount: $('case-count'), exportBtn: $('export-btn'), exportMenu: $('export-menu'), themeBtn: $('theme-btn'),
  settingsBtn: $('settings-btn'), toast: $('toast'), fileInput: $('file-input'), dropzone: $('dropzone'), printHead: $('print-head'),
  caseView: $('case-view'), agentView: $('agent-view'), caseName: $('case-name'), printReport: $('print-report'),
};

const CARD_ORDER = ['Organisation', 'Publication', 'Registration', 'Infrastructure', 'Website', 'Network', 'Hosting', 'Reputation', 'Certificates', 'Subdomains', 'DNS history', 'Web history', 'Archive', 'Accounts', 'Number', 'Mail', 'Place', 'Address', 'File', 'Document', 'Image', 'Content', 'Public records'];
const REVIEW = new Set(['plausible', 'conflict', 'lead']);
const RANK = { conflict: 0, confirmed: 1, corroborated: 1, plausible: 2, lead: 3 };
const GATE_KEY = 'sherlock.gate.username';
// The username purpose check is asked once per browser, then remembered (in memory too, if storage is blocked).
let gatePassed = false;
const gateDone = () => {
  if (gatePassed) return true;
  try {
    return (gatePassed = !!localStorage.getItem(GATE_KEY));
  } catch {
    return false;
  }
};

let current = null; // { state, abort }
let rendered = new Map();
let selected = -1;
let filter = 'all';
let view = 'findings';
let frame = 0;
let graphDirty = true;
let mapDirty = true;
let activeCase = null; // the case new pins and searches land in
let savedFor = null; // the investigation state already auto-saved

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/* ---------------- Layout: keep sticky panels below the real header height ---------------- */
new ResizeObserver(() => el.root.style.setProperty('--topbar-h', `${el.topbar.offsetHeight}px`)).observe(el.topbar);

/* ---------------- Theme ---------------- */
const THEMES = ['system', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'system') el.root.removeAttribute('data-theme');
  else el.root.setAttribute('data-theme', t);
  el.themeBtn.setAttribute('aria-label', `Theme: ${t}`);
  el.themeBtn.title = `Theme: ${t}`;
}
applyTheme(store.get('sherlock.theme', 'system'));
el.themeBtn.addEventListener('click', () => {
  const next = THEMES[(THEMES.indexOf(store.get('sherlock.theme', 'system')) + 1) % THEMES.length];
  store.set('sherlock.theme', next);
  applyTheme(next);
  toast(`Theme: ${next}`);
});

/* ---------------- Prompt input: autosize, detection chip, suggestions ---------------- */
function autosize() {
  el.q.style.height = '';
  if (!el.q.value || !el.q.offsetWidth) return; // empty: CSS min-height decides
  el.q.style.height = 'auto';
  el.q.style.height = `${Math.min(el.q.scrollHeight, 160)}px`;
}
new ResizeObserver(() => autosize()).observe(el.form);

function renderDetect() {
  const e = detect(el.q.value);
  if (!e) {
    el.detect.innerHTML = el.body.dataset.view === 'home' ? '<span class="hint">Type anything, or attach a PDF, photo or Office file</span>' : '';
    return;
  }
  const invalid = e.type === 'lei' && e.valid === false;
  const cls = RESTRICTED[e.type] ? 'is-restricted' : invalid ? 'is-invalid' : '';
  const hint = invalid ? 'Checksum fails: not a valid LEI' : LENS_HINT[e.type] || '';
  el.detect.innerHTML = `<span class="chip ${cls}">${esc(e.display || DISPLAY[e.type])}</span><span class="hint">${esc(hint)}</span>`;
}

let suggestItems = [];
let activeSuggest = -1;
let suggestSeq = 0;
const SUG_ICON = (d) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const SUG_ICONS = {
  primary: SUG_ICON('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  history: SUG_ICON('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  prefix: SUG_ICON('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1"/>'),
  tool: SUG_ICON('<path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L4 12l8-8 2.7 2.3Z"/>'),
  remote: SUG_ICON('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/>'),
};
const SUG_GROUP = { history: 'Recent', remote: 'Matching organisations', chip: 'Search by type' };
function showSuggest(items, needle) {
  suggestItems = items;
  activeSuggest = -1;
  if (!items.length || document.activeElement !== el.q) return hideSuggest();
  // With an empty box, the type prefixes render as a compact row of chips instead of a long list.
  const chips = !needle;
  let html = '';
  let lastGroup = '';
  let inChips = false;
  items.forEach((it, i) => {
    const asChip = chips && it.kind === 'prefix';
    const group = asChip ? 'chip' : it.kind;
    if (group !== lastGroup) {
      if (inChips) html += '</div>';
      inChips = false;
      if (SUG_GROUP[group]) html += `<div class="s-group">${SUG_GROUP[group]}</div>`;
      if (asChip) {
        html += '<div class="s-chips">';
        inChips = true;
      }
      lastGroup = group;
    }
    html += asChip
      ? `<button type="button" class="s-item s-chip" role="option" id="sug-${i}" data-i="${i}" title="${esc(it.meta || '')}"><span class="s-key">${esc(it.label)}</span><span class="s-meta">${esc(it.meta || '')}</span></button>`
      : `<button type="button" class="s-item s-${it.kind}" role="option" id="sug-${i}" data-i="${i}"><span class="s-main"><span class="s-ico" aria-hidden="true">${SUG_ICONS[it.kind] || ''}</span><span class="s-text">${highlight(it.label, needle)}</span></span>${it.kind === 'history' ? '' : `<span class="s-meta">${esc(it.meta || '')}</span>`}</button>`;
  });
  if (inChips) html += '</div>';
  html += '<div class="s-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> search</span><span><kbd>esc</kbd> close</span></div>';
  el.suggest.innerHTML = html;
  el.suggest.hidden = false;
  el.q.setAttribute('aria-expanded', 'true');
}
function hideSuggest() {
  el.suggest.hidden = true;
  el.q.setAttribute('aria-expanded', 'false');
  el.q.removeAttribute('aria-activedescendant');
  activeSuggest = -1;
}
function moveSuggest(d) {
  if (el.suggest.hidden || !suggestItems.length) return false;
  activeSuggest = (activeSuggest + d + suggestItems.length) % suggestItems.length;
  el.suggest.querySelectorAll('.s-item').forEach((b, i) => b.classList.toggle('active', i === activeSuggest));
  el.q.setAttribute('aria-activedescendant', `sug-${activeSuggest}`);
  el.suggest.querySelector('.s-item.active')?.scrollIntoView({ block: 'nearest' });
  return true;
}
function pickSuggest(i) {
  const it = suggestItems[i];
  if (!it) return;
  if (it.fill) {
    el.q.value = it.q;
    el.q.focus();
    onInput();
    return;
  }
  hideSuggest();
  navigate(it.q);
}
async function onInput() {
  const text = el.q.value;
  const seq = ++suggestSeq;
  const local = localSuggestions(text);
  showSuggest(local, text.trim());
  const remote = await remoteSuggestions(text);
  if (seq !== suggestSeq || !remote.length) return;
  showSuggest([...local.slice(0, 2), ...remote, ...local.slice(2)].slice(0, 12), text.trim().replace(/^org:\s*/i, ''));
}
let inputTimer;
el.q.addEventListener('input', () => {
  autosize();
  renderDetect();
  clearTimeout(inputTimer);
  suggestSeq++;
  showSuggest(localSuggestions(el.q.value), el.q.value.trim());
  inputTimer = setTimeout(onInput, 220);
});
el.q.addEventListener('focus', () => showSuggest(localSuggestions(el.q.value), el.q.value.trim()));
el.q.addEventListener('blur', () => setTimeout(hideSuggest, 120));
el.q.addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowDown') {
    if (moveSuggest(1)) ev.preventDefault();
  } else if (ev.key === 'ArrowUp') {
    if (moveSuggest(-1)) ev.preventDefault();
  } else if (ev.key === 'Escape') {
    if (!el.suggest.hidden) {
      hideSuggest();
      ev.stopPropagation();
    }
  } else if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    if (activeSuggest >= 0) pickSuggest(activeSuggest);
    else el.form.requestSubmit();
  }
});
el.suggest.addEventListener('mousedown', (ev) => ev.preventDefault());
el.suggest.addEventListener('click', (ev) => {
  const b = ev.target.closest('.s-item');
  if (b) pickSuggest(+b.dataset.i);
});
el.form.addEventListener('click', (ev) => {
  if (!ev.target.closest('button')) el.q.focus();
});

/* ---------------- Files: attach, paste, drop ---------------- */
$('attach-btn').addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
  const f = el.fileInput.files?.[0];
  el.fileInput.value = '';
  if (f) runFile(f);
});
el.q.addEventListener('paste', (ev) => {
  const f = [...(ev.clipboardData?.files || [])][0];
  if (f) {
    ev.preventDefault();
    runFile(f);
  }
});
let dragDepth = 0;
const hasFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (ev) => {
  if (!hasFiles(ev)) return;
  dragDepth++;
  el.dropzone.hidden = false;
});
window.addEventListener('dragleave', (ev) => {
  if (!hasFiles(ev)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) el.dropzone.hidden = true;
});
window.addEventListener('dragover', (ev) => {
  if (hasFiles(ev)) ev.preventDefault();
});
window.addEventListener('drop', (ev) => {
  const f = ev.dataTransfer?.files?.[0];
  dragDepth = 0;
  el.dropzone.hidden = true;
  if (f) {
    ev.preventDefault();
    runFile(f);
  }
});

function runFile(file) {
  if (file.size > 200 * 1024 * 1024) return toast('Files over 200 MB are not analysed in the browser');
  history.pushState({}, '', `/?file=${encodeURIComponent(file.name)}`);
  el.q.value = '';
  run({ type: 'file', value: file.name, display: 'File', file });
}

/* ---------------- Routing ---------------- */
el.form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  hideSuggest();
  const q = el.q.value.trim();
  if (q) navigate(q);
});
$('home-link').addEventListener('click', (ev) => {
  ev.preventDefault();
  history.pushState({}, '', '/');
  route();
});
document.querySelectorAll('#examples button').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.q)));
window.addEventListener('popstate', route);

function navigate(q) {
  if (q === null) {
    history.pushState({}, '', '/');
    return route();
  }
  const url = `/?q=${encodeURIComponent(q)}`;
  if (location.pathname + location.search !== url) history.pushState({}, '', url);
  route();
}

function showHome() {
  current?.abort();
  current = null;
  el.body.dataset.view = 'home';
  el.home.hidden = false;
  el.main.hidden = true;
  el.caseView.hidden = true;
  el.agentView.hidden = true;
  stopAgent();
  el.exportBtn.disabled = true;
  el.q.value = '';
  autosize();
  document.title = 'Indizia';
  renderDetect();
}

function route() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  if (params.get('case')) {
    showCase(params.get('case'), params.get('tab'));
  } else if (q) {
    el.q.value = q;
    autosize();
    const entity = detect(q);
    if (entity) run(entity);
  } else if (params.get('file')) {
    showHome();
    toast('Files are never stored. Attach the file again to analyse it.');
  } else {
    showHome();
    el.q.focus();
  }
}

/* ---------------- Running an investigation ---------------- */
function resetResults(entity) {
  current?.abort();
  current = null;
  closeDrawer();
  el.body.dataset.view = 'results';
  el.home.hidden = true;
  el.main.hidden = false;
  el.caseView.hidden = true;
  el.agentView.hidden = true;
  stopAgent();
  el.findings.innerHTML = '';
  el.cards.innerHTML = cardsHtml = '';
  cardsOpen.clear();
  $('view-graph').innerHTML = '';
  $('view-graph')._graphMem = null;
  $('view-map').innerHTML = '';
  $('view-timeline').innerHTML = '';
  rendered = new Map();
  selected = -1;
  $('findings-q').value = '';
  findingsQuery = parseQuery('');
  graphDirty = true;
  mapDirty = true;
  setView('findings');
  renderDetect();
  document.title = `${entity.value} · Indizia`;
  el.q.blur();
  hideSuggest();
  window.scrollTo({ top: 0 });
}

function showAgent(objective) {
  current?.abort();
  current = null;
  closeDrawer();
  el.body.dataset.view = 'agent';
  el.home.hidden = true;
  el.main.hidden = true;
  el.caseView.hidden = true;
  el.agentView.hidden = false;
  el.exportBtn.disabled = true;
  document.title = `Brief: ${objective.slice(0, 60)} · Indizia`;
  pushHistory(objective);
  window.scrollTo({ top: 0 });
  renderAgent(el.agentView, objective, { navigate, toast });
}

function run(entity) {
  if (entity.type === 'objective') return showAgent(entity.value);
  resetResults(entity);
  if (entity.type !== 'file') pushHistory(el.q.value.trim() || entity.value);
  autosize();
  if (entity.type === 'username' && !gateDone()) return showGate(entity);
  el.gate.hidden = true;
  el.layout.hidden = false;
  const prefs = getSettings();
  current = startInvestigation(entity, scheduleRender, { depth: prefs.pivotDepth, budget: prefs.pivotBudget });
  render(current.state);
  el.main.focus({ preventScroll: true });
}

function showGate(entity) {
  el.entity.innerHTML = `<div><div class="eyebrow">Username</div><h1 class="mono">${esc(entity.value)}</h1></div>`;
  el.coverage.innerHTML = '';
  el.restricted.hidden = true;
  el.layout.hidden = true;
  el.gate.hidden = false;
  el.gate.innerHTML = `
    <h2>Before searching a username</h2>
    <p>Indizia checks about 600 public sites for an account with this name. A match is a presence signal, not proof that the accounts belong to one person. Sites about sex, dating, health and politics are never checked.</p>
    <p>What is this search for? You are asked once; your answer stays in this browser.</p>
    <div class="purposes" role="group" aria-label="Purpose">
      ${['Journalism or research', 'Security or fraud prevention', 'Checking my own accounts', 'Brand or impersonation check'].map((p) => `<button type="button" aria-pressed="false" data-p="${esc(p)}">${esc(p)}</button>`).join('')}
    </div>
    <label><input type="checkbox" id="gate-ack"> I will not use the results to harass, stalk, threaten or expose anyone.</label>
    <div><button type="button" class="btn primary" id="gate-go" disabled>Search username</button></div>`;
  let purpose = null;
  const go = $('gate-go');
  const update = () => (go.disabled = !(purpose && $('gate-ack').checked));
  el.gate.querySelectorAll('.purposes button').forEach((b) =>
    b.addEventListener('click', () => {
      purpose = b.dataset.p;
      el.gate.querySelectorAll('.purposes button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      update();
    }),
  );
  $('gate-ack').addEventListener('change', update);
  go.addEventListener('click', () => {
    gatePassed = true;
    try {
      localStorage.setItem(GATE_KEY, purpose);
    } catch {
      /* private mode: remembered for this page only */
    }
    run(entity);
  });
}

// Batch renders per frame. Browsers pause requestAnimationFrame in background tabs, so a timer
// guarantees results still land while the tab is hidden.
function scheduleRender(state) {
  if (frame) return;
  const flush = () => {
    if (!frame) return;
    cancelAnimationFrame(frame.raf);
    clearTimeout(frame.timer);
    frame = 0;
    if (current?.state === state) render(state);
  };
  frame = { raf: requestAnimationFrame(flush), timer: setTimeout(flush, 120) };
}

function render(state) {
  renderEntity(state);
  renderCoverage(state);
  renderRestricted(state);
  renderCards(state);
  renderFindings(state);
  renderLedger(state);
  renderNext(state);
  renderLaunch(state);
  renderTabs(state);
  el.exportBtn.disabled = !state.finishedAt;
  graphDirty = true;
  mapDirty = true;
  if (state.finishedAt) {
    if (view === 'graph') drawGraph();
    if (view === 'map') drawMap();
    if (view === 'timeline') drawTimeline();
    autoSave(state);
  }
}

/* ---------------- Workspace: active case, auto-save ---------------- */
const SAVEABLE = (t) => !['file', 'question'].includes(t);
async function refreshActive() {
  activeCase = await getCase(activeCaseId());
  if (!activeCase && activeCaseId()) setActiveCase(null);
  el.caseName.textContent = activeCase ? activeCase.name : 'Cases';
  el.caseCount.textContent = activeCase ? activeCase.evidence.length : (await listCases()).length;
  el.caseCount.title = activeCase ? 'Evidence items in the active case' : 'Cases';
  if (current) {
    renderEntity(current.state);
    rerenderFindings();
  }
}
onCasesChange(() => refreshActive());

async function autoSave(state) {
  if (savedFor === state || !activeCase?.autoSave || !SAVEABLE(state.root.type) || activeCase.status === 'closed') return;
  savedFor = state;
  const { diff } = await saveInvestigation(activeCase.id, toSnapshot(state), el.q.value.trim() || state.root.value);
  toast(diff ? `Saved to “${activeCase.name}”: ${diff.added.length} new, ${diff.removed.length} gone since the last run` : `Saved to case “${activeCase.name}”`);
}

async function saveToCase(state) {
  if (!activeCase) {
    const c = await createCase({ name: `Case: ${state.root.value}` });
    setActiveCase(c.id);
    await refreshActive();
    toast(`Created case “${c.name}”`);
  }
  savedFor = state;
  await saveInvestigation(activeCase.id, toSnapshot(state), el.q.value.trim() || state.root.value);
  toast(`Saved to “${activeCase.name}”`);
}

function savedIn(state) {
  return activeCase?.investigations.some((i) => i.snapshot.root.type === state.root.type && i.snapshot.root.value.toLowerCase() === state.root.value.toLowerCase());
}

function showCase(id, tab) {
  current?.abort();
  current = null;
  closeDrawer();
  el.body.dataset.view = 'case';
  el.home.hidden = true;
  el.main.hidden = true;
  el.agentView.hidden = true;
  stopAgent();
  el.caseView.hidden = false;
  el.exportBtn.disabled = true;
  el.q.value = '';
  autosize();
  renderDetect();
  window.scrollTo({ top: 0 });
  renderCase(el.caseView, id, { navigate, toast, print: printCase }, tab);
}

function printCase(html, title) {
  el.printReport.innerHTML = html;
  el.body.classList.add('printing-case');
  const done = () => {
    el.body.classList.remove('printing-case');
    el.printReport.innerHTML = '';
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  document.title = `${title} · Indizia case report`;
  setTimeout(() => window.print(), 50);
}

const applicable = (state) => state.runs.filter((r) => r.state !== 'not_applicable');

function renderEntity(state) {
  const r = state.root;
  const runs = applicable(state);
  const answered = runs.filter((x) => x.state === 'done').length;
  const done = runs.filter((x) => FINAL_STATES.has(x.state)).length;
  const elapsed = state.finishedAt ? ((new Date(state.finishedAt) - new Date(state.startedAt)) / 1000).toFixed(1) + ' s' : 'running…';
  const mono = !['organisation', 'question', 'file'].includes(r.type);
  el.entity.innerHTML = `
    <div>
      <div class="eyebrow">${esc(DISPLAY[r.type] || r.type)}${r.type === 'lei' && r.valid === false ? ' · invalid checksum' : ''}${r.type === 'file' ? ' · analysed on your device' : ''}</div>
      <h1 class="${mono ? 'mono' : ''}">${esc(r.value)}</h1>
    </div>
    <div class="meta">
      <div>Started ${esc(time(state.startedAt))} · <b>${elapsed}</b></div>
      <div><b>${answered}</b> of ${runs.length} applicable sources answered${done < runs.length ? ` · ${runs.length - done} pending` : ''}</div>
      ${SAVEABLE(r.type) ? `<div class="case-line">${
        savedIn(state)
          ? `Saved in <a href="/?case=${esc(activeCase.id)}" data-case="${esc(activeCase.id)}">${esc(activeCase.name)}</a>`
          : `<button type="button" class="linkish" data-act="save-case" ${state.finishedAt ? '' : 'disabled'}>${activeCase ? `Save to “${esc(activeCase.name)}”` : 'Save to a new case'}</button>`
      }</div>` : ''}
    </div>`;
}
el.entity.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-act="save-case"]') && current?.state.finishedAt) return saveToCase(current.state);
  const a = ev.target.closest('a[data-case]');
  if (a) {
    ev.preventDefault();
    history.pushState({}, '', a.getAttribute('href'));
    route();
  }
});

function renderCoverage(state) {
  const runs = applicable(state);
  const count = (pred) => runs.filter(pred).length;
  const segs = runs.map((r) => `<i class="s-${r.state}" title="${esc(r.source.name)}: ${esc(STATE_LABEL[r.state])}"></i>`).join('');
  const items = [
    ['done', 'answered', count((r) => r.state === 'done')],
    ['empty', 'nothing found', count((r) => r.state === 'empty')],
    ['failed', 'failed', count((r) => r.state === 'failed' || r.state === 'timeout')],
    ['rate_limited', 'rate-limited', count((r) => r.state === 'rate_limited')],
    ['needs_relay', 'needs relay', count((r) => r.state === 'needs_relay')],
    ['running', 'querying', count((r) => r.state === 'running' || r.state === 'queued')],
    ['skipped', 'not needed', count((r) => r.state === 'skipped' || r.state === 'standby')],
  ].filter(([, , n]) => n > 0);
  const relayed = runs.filter((r) => r.viaRelay).length;
  const local = runs.filter((r) => r.source.local && r.state === 'done').length;
  const na = state.runs.length - runs.length;
  el.coverage.innerHTML = `
    <div class="bar" role="img" aria-label="Coverage: ${runs.length} sources">${segs}</div>
    <div class="legend">
      ${items.map(([s, label, n]) => `<span><i class="dot s-${s}"></i><b>${n}</b> ${label}</span>`).join('')}
      ${relayed ? `<span><i class="dot s-needs_relay"></i><b>${relayed}</b> via relay</span>` : ''}
      ${local ? `<span><i class="dot s-done"></i><b>${local}</b> on your device</span>` : ''}
      ${na ? `<span><i class="dot s-not_applicable"></i><b>${na}</b> not applicable</span>` : ''}
      <span><i class="dot s-launch"></i><b>${state.launches.length}</b> manual, not searched</span>
    </div>`;
}

function renderRestricted(state) {
  const text = state.restricted;
  el.restricted.hidden = !text;
  if (text) el.restricted.innerHTML = `<div><strong>${esc(DISPLAY[state.root.type])}: handled with care</strong><p>${esc(text)}</p></div>`;
}

// What a related entity is, for the section heading above its cards.
const ENTITY_KIND = { ip: 'Server', asn: 'Network', lei: 'Legal entity', domain: 'Domain', organisation: 'Organisation', url: 'Page', hash: 'File hash', coordinates: 'Place', doi: 'Publication' };
const FACT_LIMIT = 8; // rows shown before "Show more"
let cardsHtml = '';
const cardsOpen = new Set(); // cards the user expanded

function renderCards(state) {
  const base = (g) => g.split(' · ')[0];
  const subjectOf = (g) => (g.includes(' · ') ? g.slice(g.indexOf(' · ') + 3) : null);
  const order = (g) => {
    const i = CARD_ORDER.indexOf(base(g));
    return i < 0 ? 99 : i;
  };
  const groups = Object.keys(state.facts).filter((g) => state.facts[g].length);
  const running = applicable(state).some((r) => !FINAL_STATES.has(r.state) && r.state !== 'standby');
  if (!groups.length) {
    const html = running ? '<div class="card-grid"><div class="skeleton"><i></i><i></i><i></i><i></i></div><div class="skeleton"><i></i><i></i><i></i><i></i></div></div>' : '';
    if (html !== cardsHtml) el.cards.innerHTML = cardsHtml = html;
    return;
  }

  // Sections: the searched entity first, then each entity Indizia pivoted to, nearest first.
  const sections = new Map([[null, []]]);
  for (const g of groups) {
    const subj = subjectOf(g);
    if (!sections.has(subj)) sections.set(subj, []);
    sections.get(subj).push(g);
  }
  const hopOf = (v) => state.runs.find((r) => r.entity.value === v)?.hop ?? 9;
  const firstSeen = (v) => state.runs.findIndex((r) => r.entity.value === v);
  const subjects = [...sections.keys()].filter(Boolean).sort((a, b) => hopOf(a) - hopOf(b) || firstSeen(a) - firstSeen(b));

  const card = (g) => {
    const facts = [...state.facts[g]].sort((a, b) => Number(!!a.muted) - Number(!!b.muted));
    const srcs = [...new Map(facts.flatMap((f) => f.sources).map((s) => [s.id, s])).values()];
    const open = cardsOpen.has(g);
    const shown = open ? facts : facts.slice(0, FACT_LIMIT);
    const value = (f) => {
      const parts = String(f.value).split(/,\s+/);
      // Lists of hosts or names read better as tokens than as one long run-on line.
      const body = f.mono && parts.length > 1 ? `<span class="tokens">${parts.map((p) => `<span>${esc(p)}</span>`).join('')}</span>` : esc(f.value);
      return f.href ? `<a href="${esc(f.href)}" target="_blank" rel="noopener noreferrer">${body} ↗</a>` : body;
    };
    const names = srcs.map((s) => s.name);
    return `<article class="card" aria-label="${esc(g)}">
      <header class="card-head"><h3>${esc(base(g))}</h3><span class="card-count">${facts.length}</span></header>
      <dl>${shown
        .map((f) => `<div class="fact${f.muted ? ' muted' : ''}"><dt>${esc(f.label)}</dt><dd><i class="conf ${esc(f.confidence)}" title="${esc(CONFIDENCE_LABEL[f.confidence])} · ${esc(f.sources.map((x) => x.name).join(', '))}"></i><span class="v${f.mono ? ' mono' : ''}">${value(f)}</span></dd></div>`)
        .join('')}</dl>
      ${facts.length > FACT_LIMIT ? `<button type="button" class="card-more" data-card="${esc(g)}">${open ? 'Show fewer' : `Show ${facts.length - FACT_LIMIT} more`}</button>` : ''}
      <footer class="card-src" title="${esc(names.join(', '))}"><span class="favs">${srcs.slice(0, 4).map((x) => sourceFav(x)).join('')}</span><span class="names">${esc(names.slice(0, 2).join(' · '))}${names.length > 2 ? ` <b>+${names.length - 2}</b>` : ''}</span></footer>
    </article>`;
  };
  const grid = (list) => `<div class="card-grid">${[...list].sort((a, b) => order(a) - order(b) || state.facts[b].length - state.facts[a].length).map(card).join('')}</div>`;
  const heading = (v) => {
    const run = state.runs.find((r) => r.entity.value === v);
    const kind = ENTITY_KIND[run?.entity.type] || 'Related';
    const how = run?.via ? run.via.replace(/ · run by you$/, ' · run by you') : '';
    return `<header class="cards-sub"><span class="cs-kind">${esc(kind)}</span><span class="cs-name mono">${esc(v)}</span>${how ? `<span class="cs-via">via ${esc(how)}${run.hop > 1 ? ` · step ${run.hop}` : ''}</span>` : ''}</header>`;
  };

  const html =
    (sections.get(null).length ? grid(sections.get(null)) : '') +
    (subjects.length ? `<p class="cards-divider"><span>Followed from your search</span><b>${subjects.length}</b></p>` : '') +
    subjects.map((v) => `<section class="cards-related">${heading(v)}${grid(sections.get(v))}</section>`).join('');
  if (html === cardsHtml) return; // unchanged: keep the DOM (and its animations) as it is
  el.cards.innerHTML = cardsHtml = html;
  layoutCards();
}

/** Masonry: each card spans as many 4 px rows as its height needs, so short cards do not leave holes. */
function layoutCards() {
  requestAnimationFrame(() => {
    for (const c of el.cards.querySelectorAll('.card-grid > *')) {
      c.style.gridRowEnd = '';
      c.style.gridRowEnd = `span ${Math.ceil((c.getBoundingClientRect().height + 12) / 4)}`;
    }
  });
}
new ResizeObserver(() => cardsHtml && layoutCards()).observe(el.cards);
el.cards.addEventListener('click', (ev) => {
  const b = ev.target.closest('.card-more');
  if (!b || !current) return;
  if (cardsOpen.has(b.dataset.card)) cardsOpen.delete(b.dataset.card);
  else cardsOpen.add(b.dataset.card);
  renderCards(current.state);
});

/* ---------------- Findings (incremental) ---------------- */
function spark(years) {
  if (!years?.length) return '';
  const map = new Map(years);
  const ys = years.map(([y]) => +y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const all = [];
  for (let y = min; y <= max; y++) all.push([y, map.get(String(y)) || 0]);
  const w = 360;
  const h = 34;
  const bw = w / all.length;
  const top = Math.max(...all.map(([, c]) => c), 1);
  const bars = all.map(([, c], i) => `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(h - 10 - (c / top) * (h - 12)).toFixed(1)}" width="${Math.max(bw - 1, 1).toFixed(1)}" height="${((c / top) * (h - 12)).toFixed(1)}" rx="1"/>`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Captures per year ${min}–${max}">${bars}<text x="0" y="${h - 1}">${min}</text><text x="${w}" y="${h - 1}" text-anchor="end">${max}</text></svg>`;
}

function sourceChip(f) {
  const s = f.source;
  const ev = f.evidence;
  const host = s.local ? 'on your device' : hostOf(s.homepage);
  return `<span class="srcchip" tabindex="0" role="button" data-act="evidence" aria-label="Source: ${esc(s.name)}${s.reliability ? `, reliability ${s.reliability}` : ''}. Open evidence">${sourceFav(s)}${esc(s.name)}${s.reliability ? `<b class="grade g-${s.reliability}" title="Source reliability ${s.reliability}: ${esc(s.reliabilityLabel)}">${s.reliability}</b>` : ''}
    <span class="hovercard" role="tooltip">
      <span class="hc-host">${sourceFav(s)} ${esc(host)}</span>
      <span class="hc-title">${esc(s.provider || s.name)}</span>
      <span class="hc-desc">${esc(s.licence || '')}</span>
      ${s.reliability ? `<span class="hc-desc"><b>Source reliability ${esc(s.reliability)}</b> (${esc(s.reliabilityLabel)}): ${esc(s.reliabilityWhy)}</span>` : ''}
      ${ev ? `<span class="hc-foot">${esc(ev.local ? 'Computed on your device' : `${ev.method || 'GET'} ${ev.url}`)}<br>${esc(ev.retrievedAt)}${ev.viaRelay ? ' · via relay' : ''}</span>` : ''}
    </span></span>`;
}

function linkList(links) {
  const row = (l) => {
    const host = hostOf(l.href);
    return `<li><a class="l-main" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${fav(host)}<span class="l-label">${esc(l.label)}</span></a>${l.meta ? `<span class="l-meta">${esc(l.meta)}</span>` : ''}${l.q ? `<button type="button" class="l-go" data-q="${esc(l.q)}">Investigate</button>` : ''}</li>`;
  };
  const rest = links.slice(8);
  return `<ul class="linklist">${links.slice(0, 8).map(row).join('')}</ul>${rest.length ? `<details class="more"><summary>${rest.length} more</summary><ul class="linklist">${rest.map(row).join('')}</ul></details>` : ''}`;
}

function toolCards(tools) {
  return `<div class="toolgrid">${tools
    .map((t) => {
      const badges = [
        t.p && `<span class="badge ${t.p === 'free' ? 'free' : ''}">${esc(t.p)}</span>`,
        t.op && `<span class="badge ${t.op === 'active' ? 'active' : ''}" title="OPSEC: ${t.op === 'active' ? 'the target may notice' : 'passive'}">${esc(t.op)}</span>`,
        t.reg && '<span class="badge">registration</span>',
        t.api && '<span class="badge">API</span>',
        t.local && '<span class="badge">install</span>',
      ].filter(Boolean);
      return `<a class="tool" href="${esc(t.u)}" target="_blank" rel="noopener noreferrer">
        <span class="t-head">${fav(hostOf(t.u))}<span class="t-name">${esc(t.n)}</span></span>
        <span class="t-cat">${esc(t.c.join(' › '))}</span>
        <span class="t-desc">${esc(t.d || t.b)}</span>
        <span class="badges">${badges.join('')}</span>
      </a>`;
    })
    .join('')}</div>`;
}

const pivotQuery = (p) => (p.type === 'organisation' ? `org:${p.value}` : p.type === 'username' ? `user:${p.value}` : p.type === 'hash' ? `hash:${p.value}` : p.value);

function findingHtml(f) {
  const pinned = isPinned(f);
  const qs = (current?.state.questions || []).filter((q) => q.findingId === f.id);
  const asked = new Set(qs.filter((q) => q.entity).map((q) => `${q.entity.type}:${q.entity.value}`));
  const pivots = (f.pivots || []).filter((p) => p.value && !asked.has(`${p.type}:${p.value}`) && !(p.type === current?.state.root.type && p.value === current?.state.root.value));
  return `
    <button type="button" class="conf-bar" data-act="evidence" aria-label="${esc(CONFIDENCE_LABEL[f.confidence] || f.confidence)}. Show details" title="${esc(CONFIDENCE_LABEL[f.confidence] || f.confidence)}"></button>
    <span class="label ${esc(f.confidence)}" aria-hidden="true">${esc(CONFIDENCE_LABEL[f.confidence] || f.confidence)}</span>
    <div class="f-body">
      <p class="f-title">${esc(f.title)}</p>
      ${f.detail ? `<p class="f-detail">${esc(f.detail)}</p>` : ''}
      ${f.spark ? spark(f.spark) : ''}
      ${f.list?.length ? `<details class="more"><summary>${esc(f.listLabel || `${f.list.length} items`)}</summary><ul class="hostlist">${f.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      ${f.links?.length ? linkList(f.links) : ''}
      ${f.asOf ? `<form class="asof" data-url="${esc(f.asOf.url)}"><label>See the site as it was on <input type="date" name="d" min="${esc(f.asOf.min)}" max="${esc(f.asOf.max)}" value="${esc(f.asOf.max)}" required></label><button type="submit">Open the closest capture ↗</button></form>` : ''}
      ${f.tools?.length ? toolCards(f.tools) : ''}
      ${pivots.length ? `<div class="pivots">${pivots.map((p) => `<button type="button" class="pivot" data-q="${esc(pivotQuery(p))}">→ ${esc(p.value.length > 40 ? p.value.slice(0, 39) + '…' : p.value)}</button>`).join('')}</div>` : ''}
      ${qs.length ? `<div class="f-questions" aria-label="Questions this finding raises">${qs.slice(0, 2).map((q) => `<button type="button" class="fq${q.weak ? ' weak' : ''}" data-qid="${esc(q.id)}"><span>${esc(q.text)}</span><small>${esc(questionAction(q))}</small></button>`).join('')}</div>` : ''}
      <div class="f-meta">
        ${f.source.id === 'sherlock' ? `<span class="src">${sourceFav(f.source)} Cross-check</span>` : sourceChip(f)}
        ${f.via ? `<span class="via">via ${esc(f.via)}</span>` : ''}
        ${f.evidence ? `<span>${esc(time(f.evidence.retrievedAt))}</span>` : ''}
        <span class="f-actions">
          ${f.href ? `<a href="${esc(f.href)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : ''}
          ${f.evidence ? `<button type="button" data-act="evidence">Evidence</button>` : ''}
          <button type="button" data-act="pin" class="${pinned ? 'pinned' : ''}" aria-pressed="${pinned}">${pinned ? 'Pinned' : 'Pin'}</button>
        </span>
      </div>
    </div>`;
}

function renderFindings(state) {
  for (const f of state.findings) {
    const old = rendered.get(f.id);
    if (old) {
      if (old.dataset.rev !== String(f.rev || 0)) {
        // Keep expanded lists open when a growing finding is re-rendered.
        const open = old.querySelector('details.more')?.open;
        old.dataset.rev = String(f.rev || 0);
        old.innerHTML = findingHtml(f);
        if (open) old.querySelector('details.more')?.setAttribute('open', '');
      }
      continue;
    }
    const li = document.createElement('li');
    li.dataset.rev = String(f.rev || 0);
    li.className = 'finding';
    li.dataset.id = f.id;
    li.dataset.conf = f.confidence;
    li.innerHTML = findingHtml(f);
    rendered.set(f.id, li);
    const before = [...el.findings.children].find((x) => RANK[x.dataset.conf] > RANK[f.confidence]);
    el.findings.insertBefore(li, before || null);
  }
  applyFilter();
  el.findingsCount.textContent = state.findings.length;
  const settled = !!state.finishedAt;
  el.findingsEmpty.hidden = !(settled && state.findings.length === 0);
  if (settled && !state.findings.length) el.findingsEmpty.textContent = 'No source returned a finding. Check the ledger for what failed, then try the manual launch pads.';
}

let findingsQuery = parseQuery('');
function applyFilter() {
  let shown = 0;
  for (const [id, li] of rendered) {
    const conf = li.dataset.conf;
    const f = current?.state.findings.find((x) => x.id === id);
    const hide = (filter === 'confirmed' && !['confirmed', 'corroborated'].includes(conf)) || (filter === 'review' && !REVIEW.has(conf)) || (f && !findingMatches(f, findingsQuery));
    li.classList.toggle('filtered', hide);
    if (!hide) shown++;
  }
  const total = rendered.size;
  $('findings-shown').textContent = shown < total ? `${shown} of ${total} shown` : '';
}
$('findings-q').addEventListener('input', (ev) => {
  findingsQuery = parseQuery(ev.target.value);
  applyFilter();
});
document.querySelectorAll('.filters button').forEach((b) =>
  b.addEventListener('click', () => {
    filter = b.dataset.filter;
    document.querySelectorAll('.filters button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    applyFilter();
  }),
);

el.findings.addEventListener('click', (ev) => {
  const li = ev.target.closest('.finding');
  if (!li || !current) return;
  const f = current.state.findings.find((x) => x.id === li.dataset.id);
  const qb = ev.target.closest('[data-qid]');
  if (qb) return runQuestion(qb.dataset.qid, qb);
  const q = ev.target.closest('[data-q]');
  if (q) return navigate(q.dataset.q);
  if (ev.target.closest('a')) return;
  const act = ev.target.closest('[data-act]')?.dataset.act;
  select(visibleFindings().indexOf(li));
  if (act === 'pin') return togglePin(f, li);
  if (act === 'evidence') return openEvidence(f);
  // The rest of the row opens details too, unless the click hit its own control or ended a text selection.
  if (ev.target.closest('button, summary, details[open] > :not(summary), input')) return;
  if (String(window.getSelection?.() || '').trim()) return;
  openEvidence(f);
});
// Time machine: open the archived capture closest to a chosen date (the archive redirects to the nearest one).
el.findings.addEventListener('submit', (ev) => {
  const form = ev.target.closest('form.asof');
  if (!form) return;
  ev.preventDefault();
  const d = form.elements.d.value.replace(/-/g, '');
  if (!/^\d{8}$/.test(d)) return;
  window.open(`https://web.archive.org/web/${d}/${form.dataset.url}`, '_blank', 'noopener,noreferrer');
});
// Hovercards open upward; flip below the chip when the sticky topbar would cover them.
const placeHovercard = (ev) => {
  const chip = ev.target.closest?.('.srcchip');
  if (!chip) return;
  const card = chip.querySelector('.hovercard');
  const topbar = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
  chip.classList.toggle('below', chip.getBoundingClientRect().top - card.offsetHeight - 8 < topbar + 8);
};
el.findings.addEventListener('mouseover', placeHovercard);
el.findings.addEventListener('focusin', placeHovercard);
el.findings.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.classList.contains('srcchip')) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.target.click();
  }
});

/* ---------------- Views: findings, graph, map, tools ---------------- */
function setView(v) {
  view = v;
  document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === v)));
  for (const name of ['findings', 'graph', 'timeline', 'map', 'tools']) $(`view-${name}`).hidden = name !== v;
  if (v === 'graph') drawGraph();
  if (v === 'timeline') drawTimeline();
  if (v === 'map') drawMap();
  if (v === 'tools') drawTools();
}
document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

function renderTabs(state) {
  $('graph-count').textContent = countEntities(state);
  $('map-count').textContent = state.geo.length;
  $('timeline-count').textContent = state.findings.filter((f) => f.date || f.events?.length).length + Object.values(state.facts).flat().filter((x) => x.date).length;
  $('tab-map').hidden = !state.geo.length;
}

function drawGraph() {
  if (!current || !graphDirty) return;
  graphDirty = false;
  renderGraph($('view-graph'), { snapshots: [toSnapshot(current.state)] }, {
    onOpen: (n) => navigate(pivotQuery({ type: n.type, value: n.value })),
    onFollow: (n) => followEntity(n),
    onEvidence: ({ url }) => openEvidenceByUrl(url),
    onSource: (n) => {
      const f = current.state.findings.find((x) => x.sourceId === n.id.replace(/^source:/, ''));
      if (f) openEvidence(f);
    },
  });
}

function drawTimeline() {
  if (!current) return;
  const items = buildTimeline([toSnapshot(current.state)]);
  $('view-timeline').innerHTML = `<section class="vcard">
    <div class="vcard-bar"><h2>Timeline <span class="count">${items.length}</span></h2><p class="vcard-note">Dated facts from every source, newest first: registration, certificates, DNS history, scans, archive captures, publications.${current.state.finishedAt ? '' : ' Still collecting…'}</p></div>
    <div class="vcard-body">${timelineHtml(items)}</div>
  </section>`;
}

function drawMap() {
  if (!current || !mapDirty || !current.state.geo.length) return;
  mapDirty = false;
  renderMap($('view-map'), current.state.geo, { navigate }).catch(() => ($('view-map').innerHTML = '<p class="empty-note">The map library could not be loaded.</p>'));
}

async function drawTools() {
  const box = $('view-tools');
  const tools = await loadTools();
  if (!box.dataset.ready) {
    box.dataset.ready = '1';
    box.innerHTML = `<section class="vcard">
      <div class="vcard-bar"><h2>Tools</h2><label class="field grow">${SEARCH_ICON}<input type="search" id="tool-q" placeholder="Filter ${tools.length.toLocaleString()} tools: reverse image, subdomain, ship tracking…" aria-label="Search the tool library"></label></div>
      <div class="vcard-body"><p class="panel-sub" id="tool-sub"></p><div id="tool-results"></div></div>
    </section>`;
    let t;
    $('tool-q').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => fillTools(tools), 120);
    });
  }
  fillTools(tools);
}
function fillTools(tools) {
  const type = current?.state.root.type;
  const q = $('tool-q')?.value || '';
  const hits = searchTools(tools, q, { type: q ? undefined : type, limit: 48 });
  $('tool-sub').textContent = q ? `${hits.length} tools match “${q}”` : `Tools that take ${DISPLAY[type] ? `a ${DISPLAY[type].toLowerCase()}` : 'this input'} · from the OSINT Framework (MIT)`;
  $('tool-results').innerHTML = hits.length ? toolCards(hits) : '<p class="empty-note">No tools match.</p>';
  $('tools-count').textContent = hits.length;
  $('tools-count').hidden = false;
}

/* ---------------- Ledger, next steps, launch pads ---------------- */
const LEDGER_GROUPS = [
  ['active', 'Querying', (r) => r.state === 'running' || r.state === 'queued'],
  ['problem', 'Failed or limited', (r) => ['failed', 'timeout', 'rate_limited', 'needs_relay'].includes(r.state)],
  ['done', 'Answered', (r) => r.state === 'done'],
  ['empty', 'Nothing found', (r) => r.state === 'empty'],
  ['idle', 'Not needed', (r) => r.state === 'standby' || r.state === 'skipped'],
];

function renderLedger(state) {
  const rows = state.runs.filter((r) => r.state !== 'not_applicable');
  const na = state.runs.filter((r) => r.state === 'not_applicable');
  const row = (r) => {
    const st = r.state === 'done' ? `${r.count || '✓'}${r.count ? ' found' : ''}` : STATE_LABEL[r.state];
    const ms = r.ms != null ? (r.ms < 1000 ? `${r.ms} ms` : `${(r.ms / 1000).toFixed(1)} s`) : '';
    const target = r.entity.value !== state.root.value ? `<span class="tgt mono">${esc(r.entity.value)}</span>` : '';
    const via = r.via ? `via ${r.via}${r.hop > 1 ? ` · step ${r.hop}` : ''}` : r.viaRelay ? 'through the relay (source sends no CORS headers)' : r.source.local && r.state === 'done' ? 'on your device, nothing sent' : '';
    const note = [r.progress, r.message, ...r.notes].filter(Boolean).join(' · ');
    return `<li class="row"><i class="dot s-${r.state}"></i><span class="name">${sourceFav(r.source)}<span>${esc(r.source.name)}</span></span><span class="st ${r.state}">${esc(st)}${ms ? `<small>${ms}</small>` : ''}</span>${target || via ? `<div class="meta">${target}${via ? `<span class="via">${esc(via)}</span>` : ''}</div>` : ''}${note ? `<div class="msg" title="${esc(note)}">${esc(note)}</div>` : ''}</li>`;
  };
  el.ledger.innerHTML =
    LEDGER_GROUPS.map(([k, label, pick]) => {
      const list = rows.filter(pick);
      return list.length ? `<li class="lg-head lg-${k}"><span>${label}</span><b>${list.length}</b></li>${list.map(row).join('')}` : '';
    }).join('') +
    (na.length ? `<li class="lg-head lg-na"><span>Not applicable</span><b>${na.length}</b></li><li class="row na"><div class="msg" title="${esc(na.map((r) => r.source.name).join(', '))}">${esc(na.map((r) => r.source.name).join(', '))} do not take this input type.</div></li>` : '');
}

/** What a question's button does, in a few words. */
function questionAction(q) {
  if (q.kind === 'follow') return `Run here · ${q.cost} source${q.cost === 1 ? '' : 's'}`;
  if (q.kind === 'search') return q.entity?.type === 'username' ? 'New search · purpose prompt' : 'New search →';
  if (q.kind === 'path') return 'Show why connected';
  return 'Compare the evidence';
}

function renderNext(state) {
  const qs = state.questions || [];
  const b = budgetSummary(state);
  el.nextPanel.hidden = !qs.length && !b.auto && !b.held;
  const held = (state.pivots || []).filter((p) => p.status === 'held');
  const reasons = [...new Set(held.map((p) => p.held))].map((h) => ({ budget: 'budget used', depth: 'step limit', fanout: 'fan-out limit', policy: 'not automatic' })[h]).filter(Boolean);
  const summary = `<li class="next-budget"><p>Followed <b>${b.auto}</b> pivot${b.auto === 1 ? '' : 's'} automatically, up to ${b.depth} step${b.depth === 1 ? '' : 's'} from your search · <b>${b.spent}</b> of ${b.budget} source runs${b.manual ? ` · <b>${b.manual}</b> run by you` : ''}${held.length ? ` · <b>${held.length}</b> held (${esc(reasons.join(', '))})` : ''}.</p></li>`;
  el.next.innerHTML =
    (b.auto || b.held || b.manual ? summary : '') +
    qs
      .map(
        (q) => `<li class="next-row q-row${q.weak ? ' weak' : ''}">
          <button type="button" class="q-main" data-qid="${esc(q.id)}"><span class="q-text">${esc(q.text)}</span><small class="q-why">${esc(q.why || '')}</small><span class="q-act">${esc(questionAction(q))}</span></button>
          ${q.entity ? `<button type="button" class="add-lead" data-lead="${esc(pivotQuery(q.entity))}" data-label="${esc(q.text)}" title="Add to the case as a lead">+ Lead</button>` : ''}
        </li>`,
      )
      .join('');
}

/** Answer a question: follow it here, open a new search, explain a link, or open the conflicting evidence. */
function runQuestion(id, button) {
  const q = current?.state.questions.find((x) => x.id === id);
  if (!q) return;
  if (q.kind === 'follow') {
    const n = current.follow(q.entity, { reason: 'asked by you', from: q.from || null, sourceId: q.sourceId || null });
    if (button) {
      button.disabled = true;
      (button.querySelector('.q-act') || button.querySelector('small')).textContent = n ? `Running ${n} source${n === 1 ? '' : 's'}…` : 'Already covered';
    }
    return toast(n ? `Running ${n} source${n === 1 ? '' : 's'} on ${q.entity.label || q.entity.value}` : 'Indizia has already looked at this.');
  }
  if (q.kind === 'search') return navigate(pivotQuery(q.entity));
  if (q.kind === 'path') {
    $('view-graph')._graphSelect = q.edgeId ? { edge: q.edgeId } : { path: q.pair };
    graphDirty = true;
    return setView('graph');
  }
  const f = current.state.findings.find((x) => x.id === q.findingId);
  if (f) openEvidence(f);
}

/** Follow an entity from the graph inside this investigation. */
function followEntity(n) {
  if (!current) return;
  const k = current.follow({ type: n.type, value: n.value, ...(n.label && n.label !== n.value ? { label: n.label } : {}) }, { reason: 'asked by you' });
  toast(k ? `Running ${k} source${k === 1 ? '' : 's'} on ${n.label || n.value}` : 'Indizia has already looked at this.');
}

/** Open the request behind a graph link: the finding that cites it, else the source run that made it. */
function openEvidenceByUrl(url) {
  const st = current?.state;
  if (!st) return;
  const f = st.findings.find((x) => x.evidence?.url === url);
  if (f) return openEvidence(f);
  const run = st.runs.find((r) => r.evidence.some((e) => e.url === url));
  if (!run) return toast('That request is no longer in memory.');
  const ev = run.evidence.find((e) => e.url === url);
  openEvidence({ id: `ev-${run.key}`, title: `${run.source.name} request for ${run.entity.value}`, confidence: 'confirmed', source: run.source, sourceId: run.source.id, runKey: run.key, entity: run.entity, via: run.via, evidence: ev });
}

el.next.addEventListener('click', async (ev) => {
  const lead = ev.target.closest('button[data-lead]');
  if (lead) {
    if (!activeCase) {
      const c = await createCase({ name: `Case: ${current.state.root.value}` });
      setActiveCase(c.id);
      await refreshActive();
    }
    await mutate(activeCase.id, (x) => {
      x.tasks.unshift({ id: uid('t'), kind: 'lead', text: `${lead.dataset.label} (from “${current.state.root.value}”)`, query: lead.dataset.lead, status: 'open', createdAt: new Date().toISOString(), doneAt: null });
      return `Added lead: ${lead.dataset.label}`;
    });
    lead.textContent = 'Added';
    lead.disabled = true;
    return toast(`Lead added to “${activeCase.name}”`);
  }
  const qb = ev.target.closest('button[data-qid]');
  if (qb) return runQuestion(qb.dataset.qid, qb);
  const b = ev.target.closest('button[data-q]');
  if (b) navigate(b.dataset.q);
});

function renderLaunch(state) {
  el.launch.innerHTML = state.launches
    .map((l) => {
      const host = hostOf(l.href);
      return l.copy
        ? `<li><button type="button" data-href="${esc(l.href)}" data-copy="${esc(l.copy)}"><span>${fav(host)} ${esc(l.name)} ↗</span><small>copies “${esc(l.copy)}”${l.note ? ` · ${esc(l.note)}` : ''}</small></button></li>`
        : `<li><a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer"><span>${fav(host)} ${esc(l.name)} ↗</span><small>${esc(l.note || host)}</small></a></li>`;
    })
    .join('');
}
el.launch.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-copy]');
  if (!b) return;
  const w = window.open(b.dataset.href, '_blank', 'noopener,noreferrer');
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    toast(`Copied “${b.dataset.copy}”. Paste it into the search there.`);
  } catch {
    toast(`Search there for: ${b.dataset.copy}`);
  }
  if (!w) location.href = b.dataset.href;
});

/* ---------------- Drawer: evidence, case, settings ---------------- */
let lastFocus = null;
function openDrawer(title, html, wide = false) {
  lastFocus = document.activeElement;
  el.drawer.classList.toggle('wide', wide);
  el.drawerTitle.textContent = title;
  el.drawerBody.innerHTML = html;
  el.drawer.hidden = false;
  el.scrim.hidden = false;
  $('drawer-close').focus();
}
function closeDrawer() {
  if (el.drawer.hidden) return;
  el.drawer.hidden = true;
  el.scrim.hidden = true;
  lastFocus?.focus?.({ preventScroll: true });
}
$('drawer-close').addEventListener('click', closeDrawer);
el.scrim.addEventListener('click', closeDrawer);

function citation(f) {
  const ev = f.evidence;
  return `${f.title}. ${f.source.name}${f.source.provider ? ` (${f.source.provider})` : ''}${f.source.reliability ? `, source grade ${f.source.reliability}` : ''}. ${ev?.url || ''}. Retrieved ${ev?.retrievedAt || 'n/a'}${ev?.sha256 ? `. SHA-256 ${ev.sha256}` : ''}.`;
}

// What each rating means, in the order a reader should trust them least to most.
const CONFIDENCE_SCALE = ['conflict', 'lead', 'plausible', 'corroborated', 'confirmed'];
const CONFIDENCE_MEANING = {
  confirmed: 'A primary source states this directly, or a strong identifier links two records.',
  corroborated: 'Independent sources returned the same value.',
  plausible: 'One source suggests this and nothing else backs it yet. Check it before relying on it.',
  lead: 'A pointer worth following, not a fact. Indizia has not verified it.',
  conflict: 'Sources disagree. Read both records before using either.',
};

function confidenceHtml(f) {
  const c = f.confidence;
  return `<section class="rating ${esc(c)}">
      <div class="rating-head">
        <span class="rating-name">${esc(CONFIDENCE_LABEL[c] || c)}</span>
        ${f.crossCheck ? '<span class="badge">cross-check</span>' : ''}
      </div>
      <p class="rating-meaning">${esc(CONFIDENCE_MEANING[c] || '')}</p>
      <ol class="scale" aria-label="Confidence scale">${CONFIDENCE_SCALE.map((k) => `<li class="${esc(k)}${k === c ? ' on' : ''}"${k === c ? ' aria-current="true"' : ''}><i></i>${esc(CONFIDENCE_LABEL[k])}</li>`).join('')}</ol>
      ${f.confidenceNote ? `<p class="rating-why"><b>Why</b>${esc(f.confidenceNote)}</p>` : ''}
    </section>`;
}

function openEvidence(f) {
  if (!f) return;
  const run = current.state.runs.find((r) => r.key === f.runKey);
  const reqs = run ? [f.evidence, ...run.evidence.filter((e) => e !== f.evidence)].filter(Boolean).slice(0, 12) : [f.evidence].filter(Boolean);
  const s = f.source;
  openDrawer('Finding details', `
    ${confidenceHtml(f)}
    <section>
      <h3>Finding</h3>
      <p class="claim">${esc(f.title)}</p>
      ${f.detail ? `<p class="f-detail">${esc(f.detail)}</p>` : ''}
    </section>
    <section>
      <h3>Source</h3>
      <dl class="kv">
        <dt>Name</dt><dd>${sourceFav(s)} ${esc(s.name)}${s.provider ? ` · ${esc(s.provider)}` : ''}</dd>
        ${s.reliability ? `<dt>Reliability</dt><dd><b class="grade g-${s.reliability}">${esc(s.reliability)}</b> ${esc(s.reliabilityLabel)}. ${esc(s.reliabilityWhy)}. <small class="muted">The finding's own label (${esc(CONFIDENCE_LABEL[f.confidence] || f.confidence)}) rates this claim; the grade rates the source.</small></dd>` : ''}
        ${s.licence ? `<dt>Licence</dt><dd>${esc(s.licence)}</dd>` : ''}
        ${s.homepage ? `<dt>Docs</dt><dd><a href="${esc(s.homepage)}" target="_blank" rel="noopener noreferrer">${esc(s.homepage)}</a></dd>` : ''}
        ${s.terms ? `<dt>Terms</dt><dd><a href="${esc(s.terms)}" target="_blank" rel="noopener noreferrer">${esc(s.terms)}</a></dd>` : ''}
        ${f.via ? `<dt>Reached</dt><dd>via ${esc(f.via)}</dd>` : ''}
      </dl>
    </section>
    ${reqs
      .map(
        (e, i) => `<section class="req">
      <h3>${i === 0 ? (e.local ? 'Computed on your device' : 'Request behind this finding') : `Other request ${i}`}</h3>
      <dl class="kv">
        ${
          e.local
            ? `<dt>Method</dt><dd class="mono">${esc(e.url.replace('local:', ''))} · no network request</dd>`
            : `<dt>URL</dt><dd class="mono"><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.url)}</a></dd>
        <dt>Status</dt><dd class="mono">${esc(e.method || 'GET')} · HTTP ${esc(e.status)}${e.viaRelay ? ' · via relay' : ' · direct from your browser'}</dd>`
        }
        <dt>Time</dt><dd class="mono">${esc(e.retrievedAt)}${e.local ? '' : ` · ${esc(e.ms)} ms`}</dd>
        <dt>Size</dt><dd class="mono">${esc(Number(e.bytes).toLocaleString())} bytes</dd>
        ${e.sha256 ? `<dt>SHA-256</dt><dd class="mono">${esc(e.sha256)}</dd>` : ''}
      </dl>
      ${i === 0 ? `<pre class="raw">${esc(e.excerpt)}</pre>` : ''}
    </section>`,
      )
      .join('')}
    <div class="drawer-actions">
      <button type="button" class="btn primary" id="copy-cite">Copy citation</button>
      <button type="button" class="btn" id="pin-from-drawer">${isPinned(f) ? 'Unpin' : 'Pin to case'}</button>
    </div>`, true);
  $('copy-cite').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(citation(f));
      toast('Citation copied');
    } catch {
      toast('Copy failed. Select the text manually.');
    }
  });
  $('pin-from-drawer').addEventListener('click', (ev) => {
    togglePin(f, rendered.get(f.id));
    ev.target.textContent = isPinned(f) ? 'Unpin' : 'Pin to case';
  });
}

const isPinned = (f) => !!activeCase?.evidence.some((e) => e.query === current?.state.root.value && e.title === f.title);
async function togglePin(f, li) {
  if (!f || !current) return;
  if (!activeCase) {
    const c = await createCase({ name: `Case: ${current.state.root.value}` });
    setActiveCase(c.id);
    await refreshActive();
    toast(`Created case “${c.name}”`);
  }
  const root = current.state.root;
  const pinned = isPinned(f);
  await mutate(activeCase.id, (x) => {
    if (pinned) {
      x.evidence = x.evidence.filter((e) => !(e.query === root.value && e.title === f.title));
      return `Unpinned “${f.title.slice(0, 80)}”`;
    }
    x.evidence.push({ id: uid('e'), pinnedAt: new Date().toISOString(), tags: [], note: '', ...evidenceItem(f, root) });
    return `Pinned evidence “${f.title.slice(0, 80)}” from “${root.value}”`;
  });
  await refreshActive();
  toast(pinned ? 'Removed from case' : `Pinned to “${activeCase.name}”`);
  if (li) li.innerHTML = findingHtml(f);
}
const rerenderFindings = () => current && current.state.findings.forEach((f) => rendered.get(f.id) && (rendered.get(f.id).innerHTML = findingHtml(f)));

el.caseBtn.addEventListener('click', async function openCases() {
  const cases = await listCases();
  const persistent = await isPersistent();
  const folders = new Map();
  for (const c of cases) folders.set(c.folder || '', [...(folders.get(c.folder || '') || []), c]);
  const order = [...folders.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  const row = (c) => `<li class="case-row ${c.id === activeCase?.id ? 'is-active' : ''}">
      <a href="/?case=${esc(c.id)}" data-open="${esc(c.id)}"><b>${esc(c.name)}</b><small>${c.investigations.length} searches · ${c.evidence.length} evidence · ${c.tasks.filter((t) => t.status !== 'done').length} open · ${c.status}</small></a>
      ${c.id === activeCase?.id ? '<span class="lk stated">active</span>' : `<button type="button" class="btn ghost" data-activate="${esc(c.id)}">Make active</button>`}
    </li>`;
  openDrawer(`Cases · ${cases.length}`, `
    <form class="new-case" id="new-case">
      <h3>New case</h3>
      <input name="name" required placeholder="Case name, e.g. Phishing wave October">
      <input name="folder" placeholder="Folder or project (optional)" list="case-folders">
      <datalist id="case-folders">${order.filter(Boolean).map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
      <button class="btn primary">Create and make active</button>
    </form>
    ${activeCase ? `<div class="drawer-actions"><button type="button" class="btn" id="case-deactivate">Stop collecting into “${esc(activeCase.name)}”</button></div>` : '<p class="panel-sub">No active case. Pins and saved searches go to the active case; pinning without one creates it.</p>'}
    ${order.map((f) => `<section class="case-folder"><h3>${esc(f || 'No folder')}</h3><ul class="case-list">${folders.get(f).map(row).join('')}</ul></section>`).join('') || '<p class="empty-note">No cases yet.</p>'}
    <p class="panel-sub">Cases are stored in this browser only${persistent ? '' : ' — and this browser blocks storage, so they last until the tab closes'}. Export a report to keep or share one.</p>`);
  $('new-case').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const c = await createCase({ name: ev.target.name.value.trim(), folder: ev.target.folder.value.trim() });
    setActiveCase(c.id);
    await refreshActive();
    closeDrawer();
    history.pushState({}, '', `/?case=${c.id}`);
    route();
  });
  $('case-deactivate')?.addEventListener('click', async () => {
    setActiveCase(null);
    await refreshActive();
    openCases();
  });
  el.drawerBody.querySelectorAll('[data-activate]').forEach((b) => b.addEventListener('click', async () => {
    setActiveCase(b.dataset.activate);
    await refreshActive();
    openCases();
  }));
  el.drawerBody.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    closeDrawer();
    history.pushState({}, '', `/?case=${a.dataset.open}`);
    route();
  }));
});

el.settingsBtn.addEventListener('click', async () => {
  const s = getSettings();
  const health = await apiHealth();
  openDrawer('Settings', `
    <div class="setting">
      <label for="set-gh">GitHub token <span class="badge">optional</span></label>
      <p>Raises the GitHub limit from 60 to 5,000 requests per hour. A token with no scopes is enough. It is stored only in this browser and sent only to api.github.com.</p>
      <input type="password" id="set-gh" autocomplete="off" spellcheck="false" value="${esc(s.githubToken)}" placeholder="github_pat_…">
    </div>
    <div class="setting">
      <label for="set-otx">AlienVault OTX key <span class="badge">optional</span></label>
      <p>Free key from otx.alienvault.com. Unlocks historical DNS for domains (anonymous access is limited). Stored only in this browser and sent only to otx.alienvault.com.</p>
      <input type="password" id="set-otx" autocomplete="off" spellcheck="false" value="${esc(s.otxKey)}" placeholder="64-character key">
    </div>
    <div class="setting">
      <label for="set-anth">Anthropic API key <span class="badge">optional</span></label>
      <p>Lets investigation briefs be phrased by Claude when no model runs on this computer. Only the numbered evidence of a brief is sent, never usernames, emails or phone numbers. The key is stored only in this browser and sent only to api.anthropic.com. Without a key, briefs use the local model (desktop app with Ollama) or rules only.</p>
      <input type="password" id="set-anth" autocomplete="off" spellcheck="false" value="${esc(s.anthropicKey)}" placeholder="sk-ant-…">
    </div>
    <div class="setting">
      <label><input type="checkbox" id="set-remote" ${s.remoteSuggestions ? 'checked' : ''}> Organisation suggestions while typing</label>
      <p>Sends what you type (3+ characters, organisation names only) to Wikidata and GLEIF to complete names.</p>
    </div>
    <div class="setting">
      <label><input type="checkbox" id="set-fav" ${s.favicons ? 'checked' : ''}> Source icons</label>
      <p>Icons are fetched by the Indizia server, not by your browser.${health.ok ? '' : ' This deployment has no server, so letters are shown instead.'}</p>
    </div>
    <div class="setting">
      <label for="set-depth">Automatic pivots</label>
      <p>How far Indizia follows links on its own (such as domain → server → network, or company → parent → its parent), and how many source runs those pivots may use. Anything beyond becomes an open question you can run.</p>
      <div class="setting-row">
        <select id="set-depth" aria-label="Steps from your search">${[1, 2, 3].map((d) => `<option value="${d}" ${s.pivotDepth === d ? 'selected' : ''}>${d} step${d > 1 ? 's' : ''}</option>`).join('')}</select>
        <select id="set-budget" aria-label="Source runs for pivots">${[10, 30, 60].map((n) => `<option value="${n}" ${s.pivotBudget === n ? 'selected' : ''}>up to ${n} source runs</option>`).join('')}</select>
      </div>
    </div>
    <div class="setting">
      <label>Server features</label>
      <p>${health.ok ? `Relay, username checks (${health.usernameSites} sites) and icons are available.` : 'Static deployment: relay-only sources show “Needs relay” in the ledger, and username checks are unavailable.'}</p>
    </div>
    ${health.toolbox ? `
    <div class="setting" id="set-toolbox">
      <label>Local toolbox <span class="badge">Docker</span></label>
      <p>Runs ProjectDiscovery subfinder, dnsx and httpx on this computer, each in a throwaway container: no root, read-only, no capabilities, removed when it finishes. Images are pinned and downloaded on first use.</p>
      <label><input type="checkbox" id="set-tb-on" ${s.toolbox ? 'checked' : ''}> Deep subdomain scan on domain searches (subfinder, passive)</label>
      <label><input type="checkbox" id="set-tb-resolve" ${s.toolboxResolve ? 'checked' : ''}> Check which names still resolve (dnsx, public resolvers)</label>
      <label><input type="checkbox" id="set-tb-probe" ${s.toolboxProbe ? 'checked' : ''}> <span>Visit live hosts (httpx). <em>Contacts the target's servers: up to 60 homepages, 5 per second.</em></span></label>
      <ul class="toolbox-list" id="tb-list"><li>Checking Docker…</li></ul>
      <div class="drawer-actions"><button type="button" class="btn" id="tb-clean">Remove leftover containers</button><button type="button" class="btn" id="tb-purge">Remove tool images</button></div>
    </div>` : ''}
    ${health.desktop ? `
    <div class="setting" id="set-engine">
      <label>Network engine</label>
      <p>Where requests to the internet (relay, username checks, fingerprint, icons) are made. The container keeps them away from your system: Docker, read-only, unprivileged, removed when Indizia quits.</p>
      <div class="setting-row">
        <label><input type="radio" name="engine" value="builtin"> Built in (fastest start)</label>
        <label><input type="radio" name="engine" value="container"> Docker container (isolated)</label>
      </div>
      <p class="engine-state" id="engine-state"></p>
    </div>` : ''}
    <div class="setting">
      <label>Local data</label>
      <p>Search history, cases and these settings live in this browser only.</p>
      <div class="drawer-actions"><button type="button" class="btn" id="set-clear-history">Clear search history</button></div>
    </div>`);
  $('set-gh').addEventListener('change', (ev) => {
    setSetting('githubToken', ev.target.value.trim());
    toast('GitHub token saved in this browser');
  });
  $('set-otx').addEventListener('change', (ev) => {
    setSetting('otxKey', ev.target.value.trim());
    toast('OTX key saved in this browser');
  });
  $('set-anth').addEventListener('change', (ev) => {
    setSetting('anthropicKey', ev.target.value.trim());
    if (ev.target.value.trim()) setSetting('agentProvider', 'anthropic');
    toast(ev.target.value.trim() ? 'Anthropic key saved in this browser' : 'Anthropic key removed');
  });
  $('set-remote').addEventListener('change', (ev) => setSetting('remoteSuggestions', ev.target.checked));
  $('set-depth').addEventListener('change', (ev) => setSetting('pivotDepth', Number(ev.target.value)));
  $('set-budget').addEventListener('change', (ev) => setSetting('pivotBudget', Number(ev.target.value)));
  $('set-fav').addEventListener('change', (ev) => {
    setSetting('favicons', ev.target.checked);
    rerenderFindings();
  });
  $('set-clear-history').addEventListener('click', () => {
    clearHistory();
    toast('Search history cleared');
  });
  if (health.toolbox) wireToolboxSettings();
  if (health.desktop) wireEngineSettings();
});

async function wireToolboxSettings() {
  $('set-tb-on').addEventListener('change', (ev) => setSetting('toolbox', ev.target.checked));
  $('set-tb-resolve').addEventListener('change', (ev) => setSetting('toolboxResolve', ev.target.checked));
  $('set-tb-probe').addEventListener('change', (ev) => setSetting('toolboxProbe', ev.target.checked));
  const list = $('tb-list');
  const paint = async (refresh) => {
    try {
      const st = await toolboxStatus(refresh);
      if (!st.docker.available) {
        list.innerHTML = `<li>${esc(st.docker.reason)}. <button type="button" class="link" id="tb-retry">Check again</button></li>`;
        $('tb-retry').addEventListener('click', () => paint(true));
        return;
      }
      list.innerHTML = `<li class="muted">Docker ${esc(st.docker.version)}</li>` + st.tools.map((t) => `
        <li><b>${esc(t.name)}</b> <span class="mono">${esc(t.image.split(':')[1])}</span> · ${t.touchesTarget ? 'contacts the target' : 'passive'} ·
          ${t.installed ? `installed${t.sizeMB ? ` (${t.sizeMB} MB)` : ''}` : `<button type="button" class="link" data-install="${esc(t.id)}">Install (about ${t.approxMB} MB download)</button>`}
          <br><small>${esc(t.summary)} <a href="${esc(t.homepage)}" target="_blank" rel="noopener noreferrer">${esc(t.licence)}</a></small></li>`).join('');
      list.querySelectorAll('[data-install]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        b.textContent = 'Downloading…';
        try {
          await installTool(b.dataset.install);
          toast(`${b.dataset.install} installed`);
        } catch (err) {
          toast(`Install failed: ${err.message}`);
        }
        paint();
      }));
    } catch {
      list.innerHTML = '<li>The local toolbox did not answer.</li>';
    }
  };
  paint();
  const clean = (images) => async () => {
    try {
      const r = await cleanToolbox(images);
      toast(`Removed ${r.containers} container${r.containers === 1 ? '' : 's'}${images ? ` and ${r.images.length} image${r.images.length === 1 ? '' : 's'}` : ''}`);
    } catch (err) {
      toast(err.message);
    }
    paint();
  };
  $('tb-clean').addEventListener('click', clean(false));
  $('tb-purge').addEventListener('click', clean(true));
}

const ENGINE_STATE = { running: 'Running', starting: 'Starting…', building: 'Preparing the container image (first start only)…', error: 'Not running', off: 'Off' };
async function wireEngineSettings() {
  const out = $('engine-state');
  const paint = (st) => {
    document.querySelectorAll('input[name="engine"]').forEach((r) => (r.checked = r.value === (st.preferred || 'builtin')));
    out.textContent = st.preferred === 'container'
      ? `Container: ${ENGINE_STATE[st.state] || st.state}${st.error ? ` (${st.error}). Using the built-in engine meanwhile.` : ''}${st.state === 'running' ? ` · ${st.image}` : ''}`
      : 'Built-in engine: requests leave from the Indizia app itself.';
  };
  const poll = async () => {
    try {
      const st = await (await fetch('/api/engine', { cache: 'no-store' })).json();
      paint(st);
      if (['starting', 'building'].includes(st.state) && !el.drawer.hidden && document.body.contains(out)) setTimeout(poll, 1500);
    } catch {
      out.textContent = 'Engine status unavailable';
    }
  };
  document.querySelectorAll('input[name="engine"]').forEach((r) => r.addEventListener('change', async () => {
    out.textContent = r.value === 'container' ? 'Starting the container…' : 'Switching…';
    await fetch('/api/engine', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Indizia-Local': '1' }, body: JSON.stringify({ mode: r.value }) }).catch(() => {});
    poll();
  }));
  poll();
}

/* ---------------- Export ---------------- */
function toggleExport(open) {
  el.exportMenu.hidden = !open;
  el.exportBtn.setAttribute('aria-expanded', String(open));
  if (open) el.exportMenu.querySelector('button').focus();
}
el.exportBtn.addEventListener('click', () => toggleExport(el.exportMenu.hidden));
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('.menu-wrap') && !el.exportMenu.hidden) toggleExport(false);
});
el.exportMenu.addEventListener('click', (ev) => {
  const kind = ev.target.closest('[data-export]')?.dataset.export;
  if (!kind || !current?.state.finishedAt) return;
  toggleExport(false);
  const st = current.state;
  const slug = st.root.value.replace(/[^\w.-]+/g, '_').slice(0, 60);
  if (kind === 'md') download(`indizia-${slug}.md`, investigationMarkdown(st));
  if (kind === 'json') {
    const data = {
      root: { type: st.root.type, value: st.root.value }, startedAt: st.startedAt, finishedAt: st.finishedAt, facts: st.facts,
      findings: st.findings.map(({ source, ...f }) => ({ ...f, source: source.name })),
      ledger: st.runs.map((r) => ({ source: r.source.name, input: r.entity.value, state: r.state, ms: r.ms, via: r.via, notes: r.notes, message: r.message })),
      relations: st.relations.map(({ k, ...r }) => r), geo: st.geo,
    };
    const replacer = (k, v) => (k === 'file' ? undefined : k === 'sources' && Array.isArray(v) ? v.map((s) => s.name) : v);
    download(`indizia-${slug}.json`, JSON.stringify(data, replacer, 2));
  }
  if (kind === 'timesketch') {
    const jsonl = timesketchJsonl(buildTimeline([toSnapshot(st)]), st.root.value);
    if (!jsonl) return toast('No dated findings to export');
    download(`indizia-${slug}.timesketch.jsonl`, jsonl);
  }
  if (kind === 'pdf') printReport(st);
});

function printReport(st) {
  setView('findings');
  const runs = applicable(st);
  el.printHead.innerHTML = `<h1>Indizia report: ${esc(st.root.value)}</h1><p>${esc(DISPLAY[st.root.type] || st.root.type)} · ${esc(new Date(st.startedAt).toLocaleString())} · ${runs.filter((r) => r.state === 'done').length} of ${runs.length} sources answered · ${st.launches.length} manual launch pads not searched. Confidence labels describe the evidence, not the truth.</p>`;
  el.findings.querySelectorAll('details').forEach((d) => (d.open = true));
  setTimeout(() => window.print(), 50);
}

/* ---------------- Keyboard ---------------- */
function visibleFindings() {
  return [...el.findings.querySelectorAll('.finding:not(.filtered)')];
}
function select(i) {
  const list = visibleFindings();
  list.forEach((li) => li.classList.remove('selected'));
  if (!list.length) return (selected = -1);
  selected = Math.max(0, Math.min(i, list.length - 1));
  list[selected].classList.add('selected');
  list[selected].scrollIntoView({ block: 'nearest' });
}
// Sliders anywhere in the app keep their filled track in step with the value.
document.addEventListener('input', (ev) => {
  if (ev.target.matches?.('input[type="range"]')) paintRange(ev.target);
});

document.addEventListener('keydown', (ev) => {
  const typing = ev.target.matches('input, textarea, [contenteditable]');
  if (ev.key === 'Escape') {
    if (!el.exportMenu.hidden) return toggleExport(false);
    if (!el.drawer.hidden) return closeDrawer();
    if (typing) return ev.target.blur();
  }
  if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (ev.key === '/') {
    ev.preventDefault();
    el.q.focus();
    el.q.select();
    return;
  }
  if (el.body.dataset.view !== 'results' || !el.drawer.hidden || !current) return;
  const list = visibleFindings();
  const f = () => current.state.findings.find((x) => x.id === list[selected]?.dataset.id);
  if (ev.key === 'g') setView(view === 'graph' ? 'findings' : 'graph');
  else if (ev.key === 't') setView(view === 'timeline' ? 'findings' : 'timeline');
  else if (ev.key === 'm' && current.state.geo.length) setView(view === 'map' ? 'findings' : 'map');
  else if (view !== 'findings') return;
  else if (ev.key === 'j' || ev.key === 'ArrowDown') {
    ev.preventDefault();
    select(selected + 1);
  } else if (ev.key === 'k' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    select(selected - 1);
  } else if ((ev.key === 'o' || ev.key === 'Enter') && selected >= 0) {
    ev.preventDefault();
    openEvidence(f());
  } else if (ev.key === 'p' && selected >= 0) {
    togglePin(f(), list[selected]);
    list[selected].classList.add('selected');
  }
});

/* ---------------- Toast ---------------- */
let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 2600);
}

/* ---------------- Boot ---------------- */
apiHealth().then((h) => {
  setIconApi(h.ok);
  if (current) {
    rerenderFindings();
    render(current.state);
  }
});
migrateLegacyPins().finally(refreshActive);
// Scheduled watches: re-run due ones while this tab is open. Changes land in the case; the desktop app also notifies.
startWatchScheduler({
  onCount: (n) => desktopPost('watches', { count: n }),
  onResult: (r) => {
    if (!r.changed) return;
    toast(`Watch: “${r.watch.query}” changed (${r.summary})`);
    desktopPost('notify', { title: `${r.watch.query}: ${r.summary}`, body: `Watched search in “${r.watch.caseName}”. Open the case to see what changed.`, caseId: r.watch.caseId });
    const params = new URLSearchParams(location.search);
    if (el.body.dataset.view === 'case' && params.get('case') === r.watch.caseId) renderCase(el.caseView, r.watch.caseId, { navigate, toast, print: printCase });
  },
});
// Wait for the API probe so the first search already knows which server-side sources exist.
apiHealth().finally(route);
