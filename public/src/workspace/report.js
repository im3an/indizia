// Audit-ready case report. One Markdown source, also rendered to HTML for print/PDF and bundled as JSON.
// Every claim keeps its citation (URL, retrieval time, SHA-256 of the response). The report ends with a
// SHA-256 over its own body, so a recipient can check it was not edited after export.

import { resolveGraph, WEIGHTS } from '../resolve.js';
import { buildTimeline } from '../timeline.js';

const CONF = { confirmed: 'Confirmed', corroborated: 'Corroborated', plausible: 'Plausible', conflict: 'Conflicting', lead: 'Unverified lead' };
const KIND = { task: 'Task', lead: 'Lead', question: 'Open question' };
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n+/g, ' ');
const pct = (c) => `${Math.round(c * 100)}%`;

export async function sha256Text(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function caseModel(c) {
  return resolveGraph(c.investigations.map((i) => i.snapshot), { minConfidence: 0.3 });
}

export async function caseMarkdown(c) {
  const model = caseModel(c);
  const name = new Map(model.nodes.map((n) => [n.id, n.label]));
  const exported = new Date().toISOString();
  const L = [];
  L.push(`# Case report: ${c.name}`, '');
  L.push('| | |', '|---|---|');
  L.push(`| Case ID | ${c.id} |`, `| Folder | ${cell(c.folder) || '—'} |`, `| Status | ${c.status} |`, `| Created | ${c.createdAt} |`, `| Last changed | ${c.updatedAt} |`, `| Exported | ${exported} |`, `| Tool | Indizia (public-source research prototype) |`, '');
  if (c.description) L.push(`> ${c.description.replace(/\n/g, '\n> ')}`, '');

  const openTasks = c.tasks.filter((t) => t.status !== 'done');
  L.push('## Summary', '');
  L.push(`- **Investigations:** ${c.investigations.length} (${c.investigations.map((i) => `\`${i.query}\``).join(', ') || 'none'})`);
  L.push(`- **Evidence items:** ${c.evidence.length}`);
  L.push(`- **Entities:** ${model.stats.entities} resolved from ${model.stats.mentions} mentions (${model.stats.merged} duplicates merged)`);
  L.push(`- **Links:** ${model.stats.stated} stated by sources · ${model.stats.inferred} inferred by Indizia`);
  L.push(`- **Open tasks, leads and questions:** ${openTasks.length}`, '');

  L.push('## Scope and method', '');
  L.push('- Collection is passive: public APIs and datasets queried from the analyst’s browser, a stateless relay for sources without CORS, and at most one homepage request per domain for the website fingerprint. No scanning, no login, no non-public data.');
  L.push('- Personal data is minimised by design: registry contacts of natural persons are not shown, and people never take part in link inference.');
  L.push('- **Confidence labels describe the evidence, not the truth.** Confirmed: a primary source states it, or a strong identifier links two records. Corroborated: independent sources agree. Plausible: one source suggests it. Unverified lead: a pointer worth following. Conflicting: sources disagree. Separately, each source has a reliability grade A–F (Admiralty scale): A completely reliable (authoritative registries, CT logs, archives), B usually reliable, C fairly reliable, D not usually reliable, F cannot be judged.');
  L.push('- **Stated links** were asserted by a source. **Inferred links** were computed by Indizia from shared attributes; independent signals combine as 1 − Π(1 − w). Weights used: ' + Object.entries(WEIGHTS).map(([k, w]) => `${k} ${w}`).join(', ') + '. Shared CDN, cloud and mass-market DNS/mail infrastructure is discounted or ignored.', '');

  L.push('## Investigations', '');
  for (const inv of c.investigations) {
    const s = inv.snapshot;
    const real = (s.ledger || []).filter((r) => r.state !== 'not_applicable');
    L.push(`### ${inv.query}`, '');
    L.push(`- Input type: ${s.root.type} · run ${s.startedAt}${s.finishedAt ? ` → ${s.finishedAt}` : ' (incomplete)'} · saved ${inv.savedAt}`);
    L.push(`- Sources: ${real.filter((r) => r.state === 'done').length} answered of ${real.length} applicable; ${real.filter((r) => ['failed', 'timeout', 'rate_limited', 'needs_relay'].includes(r.state)).length} failed or unavailable; ${(s.launches || []).length} manual launch pads not searched`);
    if (inv.runs?.length > 1) L.push(`- Re-runs: ${inv.runs.length} (${inv.runs.map((r) => `${r.at.slice(0, 10)}${r.change ? `: ${r.change}` : ''}`).join('; ')})`);
    L.push('');
    for (const [group, facts] of Object.entries(s.facts || {})) {
      L.push(`**${group}**`, '');
      for (const f of facts) L.push(`- ${f.label}: ${f.value} _(${(f.sources || []).join(', ')}; ${CONF[f.confidence] || f.confidence})_`);
      L.push('');
    }
    const failed = real.filter((r) => ['failed', 'timeout', 'rate_limited', 'needs_relay'].includes(r.state));
    if (failed.length) L.push(`Coverage gaps: ${failed.map((r) => `${r.source} (${r.state.replace('_', ' ')})`).join(', ')}.`, '');
  }

  L.push('## Evidence', '');
  if (!c.evidence.length) L.push('_No evidence pinned._', '');
  c.evidence.forEach((e, i) => {
    const ev = e.evidence || {};
    L.push(`### E${i + 1}. ${e.title}`, '');
    L.push(`- **Confidence:** ${CONF[e.confidence] || e.confidence}`);
    L.push(`- **Source:** ${e.source}${e.provider ? ` (${e.provider})` : ''}${e.reliability ? ` · source reliability ${e.reliability}` : ''} · from the investigation of \`${e.query}\``);
    if (ev.url) L.push(`- **Request:** ${ev.method || 'GET'} ${ev.url}${ev.status ? ` → HTTP ${ev.status}` : ''}${ev.viaRelay ? ' (via relay)' : ''}`);
    if (ev.retrievedAt) L.push(`- **Retrieved:** ${ev.retrievedAt}`);
    if (ev.sha256) L.push(`- **Response SHA-256:** \`${ev.sha256}\``);
    L.push(`- **Pinned:** ${e.pinnedAt}${e.tags?.length ? ` · tags: ${e.tags.map((t) => `#${t}`).join(' ')}` : ''}`);
    if (e.detail) L.push(`- **Detail:** ${e.detail}`);
    if (e.note) L.push(`- **Analyst note:** ${e.note}`);
    if (ev.excerpt) L.push('', '```', ev.excerpt.slice(0, 700).replace(/```/g, "'''"), '```');
    L.push('');
  });

  L.push('## Entities and links', '');
  const stated = model.edges.filter((e) => e.kind === 'stated' && e.label !== 'subdomain');
  const inferred = model.edges.filter((e) => e.kind === 'inferred').sort((a, b) => b.confidence - a.confidence);
  L.push(`### Stated links (${stated.length})`, '', '| From | Link | To | Source |', '|---|---|---|---|');
  for (const e of stated.slice(0, 200)) L.push(`| ${cell(name.get(e.a))} | ${cell(e.label)} | ${cell(name.get(e.b))} | ${cell(e.sources.join(', '))} |`);
  if (stated.length > 200) L.push(`| … | ${stated.length - 200} more | | |`);
  L.push('', `### Inferred links (${inferred.length})`, '');
  if (!inferred.length) L.push('_None above 30 % confidence._');
  else {
    L.push('| Entity | Entity | Assessment | Confidence | Why |', '|---|---|---|---|---|');
    for (const e of inferred) L.push(`| ${cell(name.get(e.a))} | ${cell(name.get(e.b))} | ${e.label} | ${pct(e.confidence)} | ${cell(e.reasons.map((r) => `${r.text} (${r.weight.toFixed(2)})`).join('; '))} |`);
  }
  L.push('');
  if (model.merges.length) {
    L.push('### Merged duplicates', '');
    for (const m of model.merges) L.push(`- ${m.keys.map((k) => k.replace(/^[a-z-]+:/, '')).join(' = ')} — ${m.reason}`);
    L.push('');
  }
  if (model.candidates.length) {
    L.push('### Possible duplicates (not merged)', '');
    for (const p of model.candidates) L.push(`- ${name.get(p.a)} ≈ ${name.get(p.b)} (${pct(p.score)})`);
    L.push('');
  }

  const timeline = buildTimeline(c.investigations.map((i) => i.snapshot), []);
  L.push('## Timeline of findings', '');
  if (!timeline.length) L.push('_No dated events._');
  for (const t of timeline.slice(0, 150).reverse()) L.push(`- **${t.date.slice(0, 10)}** — ${t.title} _(${t.source || ''}${c.investigations.length > 1 ? `, ${t.query}` : ''})_`);
  L.push('');

  L.push('## Notes', '');
  if (!c.notes.length) L.push('_No notes._');
  for (const n of c.notes) L.push(`- _${n.createdAt.slice(0, 16).replace('T', ' ')}_${n.tags?.length ? ` ${n.tags.map((t) => `#${t}`).join(' ')}` : ''}: ${n.text.replace(/\n/g, ' ')}`);
  L.push('');

  L.push('## Tasks, leads and open questions', '');
  if (!c.tasks.length) L.push('_None._');
  for (const t of c.tasks) L.push(`- [${t.status === 'done' ? 'x' : ' '}] **${KIND[t.kind] || t.kind}:** ${t.text}${t.query ? ` (\`${t.query}\`)` : ''}${t.doneAt ? ` — done ${t.doneAt.slice(0, 10)}` : ''}`);
  L.push('');

  if (c.bookmarks.length) {
    L.push('## Bookmarks', '');
    for (const b of c.bookmarks) L.push(`- ${b.title ? `${b.title}: ` : ''}${b.url}${b.tags?.length ? ` ${b.tags.map((t) => `#${t}`).join(' ')}` : ''}`);
    L.push('');
  }

  L.push('## Audit trail', '', '| Time (UTC) | Event |', '|---|---|');
  for (const a of c.activity) L.push(`| ${a.at.slice(0, 19).replace('T', ' ')} | ${cell(a.text)} |`);
  L.push('');

  const body = L.join('\n');
  const digest = await sha256Text(body);
  return `${body}\n---\n\n**Integrity:** SHA-256 of everything above this line: \`${digest}\`\n`;
}

/** Minimal Markdown → HTML for the subset the report uses (headings, lists, tables, code, emphasis). */
export function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_([^_]+)_(?=[\s).,;]|$)/g, '$1<em>$2</em>').replace(/(https?:\/\/[^\s|<)]+)/g, '<a href="$1">$1</a>');
  const lines = md.split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      html += `<pre>${esc(buf.join('\n'))}</pre>`;
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      i++;
      continue;
    }
    if (l.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
      const head = cells(rows[0]);
      const bodyRows = rows.slice(2);
      html += `<table>${head.some(Boolean) ? `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${bodyRows.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      continue;
    }
    if (/^- /.test(l)) {
      html += '<ul>';
      while (i < lines.length && /^- /.test(lines[i])) {
        const item = lines[i++].slice(2).replace(/^\[( |x)\]\s/, (m, x) => (x === 'x' ? '☑ ' : '☐ '));
        html += `<li>${inline(item)}</li>`;
      }
      html += '</ul>';
      continue;
    }
    if (l.startsWith('> ')) {
      html += `<blockquote>${inline(l.slice(2))}</blockquote>`;
      i++;
      continue;
    }
    if (l === '---') html += '<hr>';
    else if (l.trim()) html += `<p>${inline(l)}</p>`;
    i++;
  }
  return html;
}

export function caseJson(c) {
  return JSON.stringify({ format: 'sherlock-case/1', exportedAt: new Date().toISOString(), case: c, links: caseModel(c) }, null, 2);
}
