// Investigation brief page: objective, limits, plan with live status, activity log, the brief (model
// statements with citation chips, then the rules sections), and the numbered evidence. Export or save to
// the active case.

import { startAgent, briefMarkdown, DEFAULT_LIMITS } from './run.js';
import { providers, pickProvider } from './llm.js';
import { KIND_LABEL } from './plan.js';
import { getSetting, setSetting } from '../settings.js';
import { activeCaseId, getCase, mutate, uid } from '../workspace/store.js';
import { saveInvestigation } from '../workspace/actions.js';
import { toSnapshot } from '../snapshot.js';
import { download } from '../report.js';
import { CONFIDENCE_LABEL } from '../report.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const time = (iso) => (iso ? iso.slice(11, 19) : '');
const STATUS = { queued: 'Waiting', running: 'Searching', done: 'Done', partial: 'Partial', skipped: 'Skipped', approval: 'Needs you' };

let current = null;

export function stopAgent() {
  current?.stop();
  current = null;
}

/**
 * @param {HTMLElement} root
 * @param {string} objective
 * @param {{ navigate(q: string): void, toast(msg: string): void }} deps
 */
export async function renderAgent(root, objective, deps) {
  stopAgent();
  const list = await providers();
  const chosen = await pickProvider();
  const limits = { ...DEFAULT_LIMITS, ...(getSetting('agentLimits') || {}) };
  const caseId = activeCaseId();
  const c = caseId ? await getCase(caseId) : null;
  root.innerHTML = `
    <header class="agent-head">
      <div class="eyebrow">Investigation brief${c ? ` · case “${esc(c.name)}”` : ''}</div>
      <h1>${esc(objective.replace(/^(brief|agent|investigate):\s*/i, ''))}</h1>
      <form class="agent-limits" id="ag-form">
        <label>Model <select id="ag-provider">${list.map((p) => `<option value="${p.id}" ${p.id === chosen.id ? 'selected' : ''} ${p.available ? '' : 'disabled'}>${esc(p.label)}</option>`).join('')}</select></label>
        <label>Searches <select id="ag-searches">${[3, 6, 10].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
        <label>Time <select id="ag-minutes">${[2, 4, 8].map((n) => `<option value="${n}">${n} min</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" id="ag-follow" ${limits.follow ? 'checked' : ''}> Follow leads</label>
        <button type="submit" class="btn" id="ag-restart">Run again</button>
        <button type="button" class="btn" id="ag-stop">Stop</button>
      </form>
      <p class="panel-sub">${chosen.id === 'anthropic' ? 'The numbered evidence is sent to Anthropic with your key to write the summary. ' : chosen.id === 'local' ? 'The model runs on this computer. ' : ''}A model never adds findings: it may only phrase what the sources returned, every statement must cite them, and statements whose numbers or dates are not in the cited evidence are dropped. Usernames, emails and phone numbers are never searched automatically or sent to a model.</p>
    </header>
    <div class="agent-grid">
      <div class="agent-main">
        <section class="panel" id="ag-brief"><h2>Brief</h2><p class="empty-note">Working…</p></section>
        <section class="panel" id="ag-evidence" hidden><h2>Evidence</h2><div></div></section>
      </div>
      <aside class="agent-side">
        <section class="panel"><h2>Plan</h2><ol class="ag-plan" id="ag-plan"></ol></section>
        <section class="panel"><h2>Activity</h2><ol class="ag-log" id="ag-log"></ol></section>
        <section class="panel" id="ag-actions" hidden><h2>Keep it</h2>
          <div class="drawer-actions"><button type="button" class="btn" id="ag-md">Export Markdown</button>${c ? '<button type="button" class="btn primary" id="ag-save">Save to case</button>' : ''}</div>
          ${c ? '' : '<p class="panel-sub">Activate a case to save the searches and the brief into it.</p>'}</section>
      </aside>
    </div>`;
  const $ = (id) => root.querySelector(`#${id}`);
  // Set the controls from the saved limits (unknown values fall back to the defaults).
  $('ag-searches').value = [3, 6, 10].includes(limits.searches) ? String(limits.searches) : String(DEFAULT_LIMITS.searches);
  $('ag-minutes').value = [2, 4, 8].includes(limits.minutes) ? String(limits.minutes) : String(DEFAULT_LIMITS.minutes);
  const readLimits = () => ({ searches: Number($('ag-searches').value), minutes: Number($('ag-minutes').value), follow: $('ag-follow').checked });

  const start = async () => {
    stopAgent();
    const lim = readLimits();
    setSetting('agentLimits', lim);
    setSetting('agentProvider', $('ag-provider').value);
    const provider = (await providers()).find((p) => p.id === $('ag-provider').value) || chosen;
    current = startAgent({ objective, caseId, provider, limits: lim, onChange: (st) => paint(root, st, deps) });
    current.promise.then((st) => paint(root, st, deps));
  };
  $('ag-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    start();
  });
  $('ag-stop').addEventListener('click', () => current?.stop());
  start();
}

let paintQueued = false;
function paint(root, st, deps) {
  if (paintQueued) return;
  paintQueued = true;
  // A timer, not requestAnimationFrame: background tabs pause rAF, and the brief should be current when you return.
  setTimeout(() => {
    paintQueued = false;
    paintNow(root, st, deps);
  }, 80);
}

function cites(list) {
  return list.map((c) => `<a class="cite" href="#ev-${esc(c)}" data-cite="${esc(c)}">${esc(c)}</a>`).join('');
}

function paintNow(root, st, deps) {
  const $ = (id) => root.querySelector(`#${id}`);
  if (!$('ag-plan')) return;
  $('ag-stop').disabled = !!st.finishedAt;
  $('ag-plan').innerHTML = st.tasks.length
    ? st.tasks.map((t) => `<li class="t-${t.status}"><span class="ag-status">${STATUS[t.status] || t.status}</span><b>${esc(t.query)}</b>${t.followUp ? ' <span class="badge">lead</span>' : ''}<br><small>${esc(t.summary || t.why)}</small>${t.restricted ? `<br><button type="button" class="linkish" data-open="${esc(t.query)}">Open as a separate search</button>` : ''}</li>`).join('')
    : `<li class="muted">${st.phase === 'planning' ? 'Reading the objective…' : 'Nothing to search.'}</li>`;
  $('ag-log').innerHTML = st.log.map((l) => `<li class="l-${l.kind}"><span class="mono">${time(l.at)}</span> ${esc(l.text)}</li>`).join('');
  $('ag-log').scrollTop = $('ag-log').scrollHeight;
  root.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => deps.navigate(b.dataset.open)));

  if (!st.finishedAt) {
    const done = st.tasks.filter((t) => ['done', 'partial'].includes(t.status)).length;
    $('ag-brief').innerHTML = `<h2>Brief</h2><p class="empty-note">${st.phase === 'writing' ? 'Writing the brief from the evidence…' : `Searching: ${done} of ${st.tasks.filter((t) => !t.restricted).length} done.`}</p>`;
    return;
  }
  const mb = st.modelBrief;
  const b = st.brief;
  $('ag-brief').innerHTML = `<h2>Brief</h2>
    ${mb?.answer?.length ? `<div class="ag-summary"><p class="ag-gen">Summary written by ${esc(mb.model)} from ${st.evidence.length} evidence items · ${mb.answer.length} statement${mb.answer.length > 1 ? 's' : ''} passed the citation check${mb.dropped.length ? `, ${mb.dropped.length} dropped` : ''}</p>
      <ul class="ag-statements">${mb.answer.map((a) => `<li><span class="kind k-${a.kind}">${KIND_LABEL[a.kind]}</span> ${esc(a.text)} ${cites(a.cites)}</li>`).join('')}</ul>
      ${mb.dropped.length ? `<details class="more"><summary>Dropped by the citation check (${mb.dropped.length})</summary><ul class="ag-dropped">${mb.dropped.map((d) => `<li><s>${esc(d.text)}</s> <small>${esc(d.reason)}</small></li>`).join('')}</ul></details>` : ''}</div>` : ''}
    ${b.sections.map((s) => `<h3>${esc(s.title)}</h3><ul class="ag-statements">${s.items.map((i) => `<li><span class="kind k-${i.kind}">${KIND_LABEL[i.kind]}</span> ${esc(i.text)} ${cites(i.cites)}</li>`).join('')}</ul>`).join('') || '<p class="empty-note">No evidence was collected.</p>'}
    ${[...b.gaps, ...(mb?.gaps || [])].length ? `<h3>Not established / not checked</h3><ul>${[...b.gaps, ...(mb?.gaps || [])].map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
    ${[...b.questions, ...(mb?.next || [])].length ? `<h3>Open questions and next steps</h3><ul>${[...b.questions, ...(mb?.next || [])].map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}`;
  const evBox = $('ag-evidence');
  evBox.hidden = !st.evidence.length;
  evBox.querySelector('div').innerHTML = `<ol class="ag-evidence">${st.evidence.map((e) => `<li id="ev-${esc(e.id)}"><span class="ev-no">${esc(e.id)}</span><div>
    <p><b>${esc(e.title)}</b></p>${e.detail ? `<p class="f-detail">${esc(e.detail.slice(0, 400))}</p>` : ''}
    <small>${esc(e.source)}${e.reliability ? ` · source grade ${esc(e.reliability)}` : ''} · ${esc(CONFIDENCE_LABEL[e.confidence] || e.confidence)}${e.date ? ` · dated ${esc(String(e.date).slice(0, 10))}` : ''}${e.retrievedAt ? ` · retrieved ${esc(e.retrievedAt.replace('T', ' ').slice(0, 19))}` : ''}${e.url && /^https?:/.test(e.url) ? ` · <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">request</a>` : ''}${e.kind === 'finding' ? ` · <button type="button" class="linkish" data-open="${esc(e.query)}">open search</button>` : ''}</small></div></li>`).join('')}</ol>`;
  root.querySelectorAll('[data-open]').forEach((x) => (x.onclick = () => deps.navigate(x.dataset.open)));
  root.querySelectorAll('[data-cite]').forEach((a) => (a.onclick = (ev) => {
    ev.preventDefault();
    const li = root.querySelector(`#ev-${CSS.escape(a.dataset.cite)}`);
    li?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    li?.classList.add('flash');
    setTimeout(() => li?.classList.remove('flash'), 1400);
  }));
  $('ag-actions').hidden = false;
  $('ag-md').onclick = () => download(`indizia-brief-${new Date().toISOString().slice(0, 10)}.md`, briefMarkdown(st));
  if ($('ag-save')) $('ag-save').onclick = async () => {
    const caseId = st.caseId;
    for (const r of st.runs) await saveInvestigation(caseId, toSnapshot(r.state), r.query);
    await mutate(caseId, (x) => {
      x.notes.push({ id: uid('n'), text: briefMarkdown(st), tags: ['brief'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return `Saved investigation brief “${st.objective.slice(0, 80)}” (${st.runs.length} searches, ${st.evidence.length} evidence items${st.modelBrief ? `, summary by ${st.modelBrief.model}` : ''})`;
    });
    deps.toast('Brief and searches saved to the case');
  };
}
