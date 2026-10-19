// Knowledge graph: entities resolved across one or more investigations (resolve.js), drawn as a live force
// simulation in SVG with springy drag (Obsidian-style). No libraries.
// Solid lines are links a source stated. Dashed lines are links Indizia inferred, with a confidence score;
// click any line to see why it exists, click a node for its aliases and connections, shift-click a second node
// to explain how the two are connected.

import { resolveGraph, explainConnection, discoveryPath, band, canonical, WEIGHTS } from '../resolve.js';

// Colour by role, not just type: in company graphs nearly everything is an "organisation",
// so parents/owners, subsidiaries and LEI-registered entities each get their own hue.
const GROUPS = {
  parent: { label: 'Parent / owner', color: 'var(--g-parent)' },
  subsidiary: { label: 'Subsidiary', color: 'var(--g-sub)' },
  organisation: { label: 'Organisation', color: 'var(--g-org)' },
  lei: { label: 'Legal entity (LEI)', color: 'var(--g-lei)' },
  web: { label: 'Domain / URL', color: 'var(--g-domain)' },
  network: { label: 'Network', color: 'var(--g-net)' },
  tracker: { label: 'Tracking ID', color: 'var(--g-tracker)' },
  person: { label: 'Account / person', color: 'var(--g-person)' },
  doc: { label: 'Publication', color: 'var(--g-doc)' },
  geo: { label: 'Place', color: 'var(--g-geo)' },
  file: { label: 'File', color: 'var(--g-file)' },
  source: { label: 'Source', color: 'var(--g-source)' },
};
const TYPE_GROUP = {
  domain: 'web', url: 'web', ip: 'network', asn: 'network', crypto: 'network', lei: 'lei', organisation: 'organisation', tracker: 'tracker',
  username: 'person', account: 'person', person: 'person', 'person-name': 'person', email: 'person', phone: 'person',
  file: 'file', hash: 'file', doi: 'doc', coordinates: 'geo', source: 'source',
};
// Relation labels whose target is the parent / the child of the entity it hangs off.
const TO_PARENT = new Set(['parent organisation', 'owned by', 'direct parent', 'ultimate parent']);
const TO_CHILD = new Set(['subsidiary', 'division', 'owner of']);
const colorOf = (n) => GROUPS[n.group]?.color || 'var(--muted)';
export const INVESTIGABLE = new Set(['domain', 'url', 'ip', 'asn', 'lei', 'organisation', 'doi', 'hash', 'coordinates', 'username']);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (c) => `${Math.round(c * 100)}%`;
const BAND_LABEL = { confirmed: 'Stated', corroborated: 'Strong', plausible: 'Moderate', lead: 'Weak' };

/** Cheap entity count for the tab badge while an investigation is still running. */
export function countEntities(state) {
  const keys = new Set([canonical(state.root)]);
  for (const r of state.relations) {
    keys.add(canonical(r.from));
    keys.add(canonical(r.to));
  }
  return keys.size;
}

/**
 * Build the drawable model from snapshots: resolved entities and edges, plus (optionally) which source
 * produced which entity.
 */
export function graphModel(snapshots, ui = {}) {
  const model = resolveGraph(snapshots, { minConfidence: 0.3 });
  const nodes = new Map(model.nodes.map((n) => [n.id, { ...n, group: TYPE_GROUP[n.type] || 'organisation' }]));
  const keyToId = new Map();
  for (const n of model.nodes) for (const k of n.keys) keyToId.set(k, n.id);
  const minConf = ui.minConf ?? 0.3;
  let edges = model.edges.filter((e) => e.kind === 'stated' || (ui.inferred !== false && e.confidence >= minConf));
  if (ui.sources) {
    snapshots.forEach((s) => {
      for (const row of s.ledger || []) {
        if (row.state !== 'done' || row.sourceId === 'tool-library' || !row.inputType) continue;
        const target = keyToId.get(canonical({ type: row.inputType, value: row.input }));
        if (!target) continue;
        const id = `source:${row.sourceId || row.source}`;
        if (!nodes.has(id)) nodes.set(id, { id, type: 'source', value: row.source, label: row.source, aliases: [], keys: [], group: 'source', snaps: [] });
        if (!edges.some((e) => e.a === id && e.b === target)) edges = [...edges, { id: `src${edges.length}`, a: id, b: target, label: row.count ? String(row.count) : '', kind: 'source', confidence: 1, reasons: [], sources: [row.source] }];
      }
    });
  }
  // Which entities a source already ran on: those can only be re-searched, not followed.
  for (const s of snapshots) {
    for (const row of s.ledger || []) {
      if (row.state === 'not_applicable' || !row.inputType) continue;
      const n = nodes.get(keyToId.get(canonical({ type: row.inputType, value: row.input })));
      if (n) n.investigated = true;
    }
  }
  for (const e of edges) {
    if (e.kind !== 'stated') continue;
    const t = nodes.get(e.b);
    if (!t || t.root) continue;
    const l = String(e.label || '').toLowerCase();
    if (TO_PARENT.has(l)) t.group = 'parent';
    else if (TO_CHILD.has(l) && t.group !== 'parent') t.group = 'subsidiary';
  }
  // Hide nodes that only hung off a filtered-out inferred edge? No: every resolved entity came from a stated
  // mention, so it always has at least one stated edge or is a root.
  return { ...model, nodes: [...nodes.values()], edges, allEdges: model.edges };
}

const LABEL_MAX = 26;
const CHAR_W = 6.1; // approx. advance of an 11px Plex Sans glyph, for label-aware collision
const SUB_W = 5.7; // approx. advance of a 9.5px mono glyph
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Layouts: the same entities and links, arranged to answer different questions.
const ICON = (d) => `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">${d}</svg>`;
const LAYOUTS = [
  { id: 'force', label: 'Network', hint: 'Free layout: groups emerge from the links themselves', icon: ICON('<circle cx="3" cy="4" r="1.6"/><circle cx="11" cy="3" r="1.6"/><circle cx="7" cy="11" r="1.6"/><path d="M4.5 4.6 9.5 3.4M4 5.4l2.2 4.2M10.3 4.5 7.8 9.5"/>') },
  { id: 'tree', label: 'Tree', hint: 'How Indizia reached every entity, hop by hop from the search', icon: ICON('<circle cx="3" cy="2.5" r="1.4"/><path d="M3 4v7.5h3M3 7h3"/><circle cx="8" cy="7" r="1.4"/><circle cx="8" cy="11.5" r="1.4"/><path d="M10 7h2.5"/>') },
  { id: 'radial', label: 'Radial', hint: 'Rings by distance: the closer to the centre, the fewer hops from the search', icon: ICON('<circle cx="7" cy="7" r="1.5"/><circle cx="7" cy="7" r="3.8" stroke-dasharray="1.5 1.5"/><circle cx="7" cy="7" r="6" stroke-dasharray="1.5 1.5"/>') },
  { id: 'clusters', label: 'Clusters', hint: 'Grouped by role, so links between groups stand out', icon: ICON('<circle cx="4.2" cy="5" r="3"/><circle cx="10" cy="9.2" r="3"/><path d="M6.4 6.8 7.9 7.6"/>') },
  { id: 'ownership', label: 'Ownership', hint: 'Corporate structure only: owners above, subsidiaries below', icon: ICON('<rect x="5" y="1.2" width="4" height="3" rx=".6"/><rect x="1" y="9.8" width="4" height="3" rx=".6"/><rect x="9" y="9.8" width="4" height="3" rx=".6"/><path d="M7 4.2v2.8M3 9.8V7h8v2.8"/>') },
];
const STRUCTURED = new Set(['tree', 'radial', 'ownership']);
const ROW_H = 24; // tree row height
const isOwnership = (e) => e.kind === 'stated' && (TO_PARENT.has(String(e.label || '').toLowerCase()) || TO_CHILD.has(String(e.label || '').toLowerCase()));

function shortUrl(u) {
  try {
    const x = new URL(u);
    return short(`${x.host}${x.pathname}${x.search}`, 54);
  } catch {
    return short(u, 54);
  }
}
const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? '' : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
};

function short(s, n = LABEL_MAX) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Physics: many-body repulsion, link springs, gentle gravity and label-box collision.
 * Structured layouts (tree, radial, ownership) skip the physics and ease every node to its computed target,
 * so switching layout animates and a dragged node springs back into place. Clusters add a pull toward the
 * node's group centre on top of the normal forces.
 */
function createSim(nodes, edges, { mode = 'force', detail = false } = {}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = edges.map((e) => ({ ...e, s: byId.get(e.a), t: byId.get(e.b) }));
  for (const l of links) {
    l.s.deg = (l.s.deg || 0) + 1;
    l.t.deg = (l.t.deg || 0) + 1;
  }
  for (const n of nodes) {
    n.deg ||= 0;
    n.r = n.root ? 12 : n.type === 'source' ? 5 : 6 + Math.min(6, Math.sqrt(n.deg) * 1.6);
    n.text = short(n.label, detail || STRUCTURED.has(mode) ? 40 : LABEL_MAX);
    n.sub = detail && n.type !== 'source' ? `${n.type}${n.deg ? ` · ${n.deg} link${n.deg > 1 ? 's' : ''}` : ''}` : '';
    n.textW = n.text.length * (n.type === 'source' ? 6 : CHAR_W);
    // Collision box: the dot plus its label (and, in detail, the type line) centred underneath.
    n.hw = Math.max(n.r, Math.max(n.textW, n.sub.length * SUB_W) / 2) + 6;
    n.hh = (n.r * 2 + 16 + (n.sub ? 11 : 0)) / 2 + 4;
    n.vx ||= 0;
    n.vy ||= 0;
  }
  const sim = { nodes, links, byId, alpha: 1, alphaTarget: 0, decay: 0.17, mode };
  const ease = reduceMotion() ? 1 : 0.14;
  sim.tick = () => {
    sim.alpha += (sim.alphaTarget - sim.alpha) * 0.025;
    if (STRUCTURED.has(mode)) {
      for (const n of nodes) {
        if (n.fx != null) {
          n.x = n.fx;
          n.y = n.fy;
        } else {
          n.x += (n.tx - n.x) * ease;
          n.y += (n.ty - n.y) * ease;
        }
        n.vx = n.vy = 0;
      }
      return;
    }
    const a = sim.alpha;
    // Repulsion (n² is fine at the sizes Indizia produces).
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        if (d2 > 640000) continue;
        const f = ((mode === 'clusters' ? -320 : -520) * a) / d2;
        p.vx += dx * f;
        p.vy += dy * f;
        q.vx -= dx * f;
        q.vy -= dy * f;
      }
    }
    // Springs: leaves sit close to their hub, hub-to-hub links get more room.
    for (const l of links) {
      const { s, t } = l;
      const dx = t.x + t.vx - s.x - s.vx;
      const dy = t.y + t.vy - s.y - s.vy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const ideal = (l.kind === 'source' ? 56 : l.kind === 'inferred' ? 96 : 46) + Math.min(s.deg, t.deg, 6) * 9 + (s.hw + t.hw) * 0.3;
      // In clusters, links between groups pull less, so each group stays together.
      const k = (1 / Math.min(s.deg, t.deg)) * (l.kind === 'inferred' ? 0.25 : 0.7) * (mode === 'clusters' && s.cluster !== t.cluster ? 0.15 : 1);
      const f = ((d - ideal) / d) * a * k;
      const bias = s.deg / (s.deg + t.deg);
      t.vx -= dx * f * bias;
      t.vy -= dy * f * bias;
      s.vx += dx * f * (1 - bias);
      s.vy += dy * f * (1 - bias);
    }
    // Gravity toward the origin keeps disconnected pieces on screen; in clusters, toward the group centre.
    for (const n of nodes) {
      const g = mode === 'clusters' ? 0.15 : 0.02;
      n.vx -= (n.x - (n.tx || 0)) * g * a;
      n.vy -= (n.y - (n.ty || 0)) * g * a;
    }
    // Integrate.
    for (const n of nodes) {
      if (n.fx != null) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = n.vy = 0;
        continue;
      }
      n.vx *= 1 - sim.decay;
      n.vy *= 1 - sim.decay;
      n.x += n.vx;
      n.y += n.vy;
    }
    // Label-aware collision: separate overlapping boxes along the shallower axis.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        const p = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const q = nodes[j];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const ox = p.hw + q.hw - Math.abs(dx);
          const oy = p.hh + q.hh - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          // A pinned (dragged) node does not yield; its neighbour takes the whole push.
          const pw = p.fx != null ? 0 : q.fx != null ? 1 : 0.5;
          const qw = 1 - pw;
          if (ox < oy) {
            const m = ox * 0.7 * Math.sign(dx || Math.random() - 0.5);
            p.x -= m * pw;
            q.x += m * qw;
          } else {
            const m = oy * 0.7 * Math.sign(dy || Math.random() - 0.5);
            p.y -= m * pw;
            q.y += m * qw;
          }
        }
      }
    }
  };
  return sim;
}

/**
 * Hop structure: a spanning tree grown from the searched entities. Stated links (pivots first) are walked
 * before inferred ones, so a node hangs off the path a source supports whenever there is one. Pieces not
 * connected to a search start their own tree at their best-connected node.
 */
function spanningTree(nodes, links) {
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const l of links) {
    adj.get(l.a).push({ to: l.b, l });
    adj.get(l.b).push({ to: l.a, l });
  }
  const rank = (l) => (l.pivot ? 0 : l.kind === 'stated' ? 1 : l.kind === 'source' ? 2 : 3);
  for (const list of adj.values()) list.sort((x, y) => rank(x.l) - rank(y.l));
  const depth = new Map();
  const parent = new Map();
  const via = new Map();
  const tops = [];
  const grow = (seeds) => {
    for (const id of seeds) {
      depth.set(id, 0);
      parent.set(id, null);
      tops.push(id);
    }
    let q = [...seeds];
    while (q.length) {
      for (let i = 0; i < q.length; i++) {
        for (const { to, l } of adj.get(q[i])) {
          if (l.kind === 'inferred' || depth.has(to)) continue;
          depth.set(to, depth.get(q[i]) + 1);
          parent.set(to, q[i]);
          via.set(to, l);
          q.push(to);
        }
      }
      // Only when stated links are exhausted, cross an inferred one.
      const next = [];
      for (const at of q) {
        for (const { to, l } of adj.get(at)) {
          if (l.kind !== 'inferred' || depth.has(to)) continue;
          depth.set(to, depth.get(at) + 1);
          parent.set(to, at);
          via.set(to, l);
          next.push(to);
        }
      }
      q = next;
    }
  };
  grow(nodes.filter((n) => n.root).map((n) => n.id));
  for (const n of [...nodes].sort((a, b) => b.deg - a.deg)) if (!depth.has(n.id)) grow([n.id]);
  const order = Object.keys(GROUPS);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map();
  for (const [id, p] of parent) if (p != null) (children.get(p) || children.set(p, []).get(p)).push(id);
  for (const list of children.values()) {
    list.sort((x, y) => {
      const a = byId.get(x);
      const b = byId.get(y);
      return order.indexOf(a.group) - order.indexOf(b.group) || String(a.label).localeCompare(String(b.label));
    });
  }
  for (const l of links) {
    if (via.get(l.b) === l) Object.assign(l, { tree: true, par: l.a, child: l.b });
    else if (via.get(l.a) === l) Object.assign(l, { tree: true, par: l.b, child: l.a });
  }
  return { depth, parent, children, tops, maxDepth: Math.max(0, ...depth.values()) };
}

/**
 * Tree: an org chart that reads top to bottom, labels to the right of each dot. A node's leaves are listed
 * under it (wrapping into columns when there are many); its branches sit side by side below them.
 */
function layoutTree(st, byId) {
  const INDENT = 28;
  const GAP = 40;
  const kids = (id) => st.children.get(id) || [];
  const right = (n) => n.tx + n.r + 10 + n.textW + (n.sub ? n.sub.length * SUB_W + 7 : 0);
  // Places a subtree with its node at (x, y); returns its width and height.
  const place = (id, x, y) => {
    const n = byId.get(id);
    Object.assign(n, { tx: x, ty: y });
    let maxX = right(n);
    const leaves = kids(id).filter((k) => !kids(k).length);
    const branches = kids(id).filter((k) => kids(k).length);
    let cy = y + ROW_H;
    const cx = x + INDENT;
    if (leaves.length) {
      const colW = Math.max(...leaves.map((k) => right({ ...byId.get(k), tx: 0 }))) + GAP;
      const rows = leaves.length <= 8 ? leaves.length : Math.min(18, Math.max(6, Math.ceil(Math.sqrt((leaves.length * colW) / ROW_H) * 0.8)));
      leaves.forEach((k, i) => {
        const c = byId.get(k);
        Object.assign(c, { tx: cx + Math.floor(i / rows) * colW, ty: cy + (i % rows) * ROW_H, tcol: Math.floor(i / rows), trow: i % rows, branch: false });
        maxX = Math.max(maxX, right(c));
      });
      cy += Math.min(rows, leaves.length) * ROW_H;
    }
    let bottom = cy;
    if (branches.length) {
      cy += ROW_H * 0.6; // room for the bus line that feeds the branches
      let bx = cx;
      for (const b of branches) {
        byId.get(b).branch = true;
        const sub = place(b, bx, cy);
        bx += sub.w + GAP;
        maxX = Math.max(maxX, bx - GAP);
        bottom = Math.max(bottom, cy + sub.h);
      }
    }
    return { w: maxX - x, h: bottom - y };
  };
  // Separate trees sit side by side, wrapping into a new band when the row gets too wide.
  let ox = 0;
  let oy = 0;
  let band = 0;
  for (const top of st.tops) {
    if (ox > 0 && ox > 1600) {
      ox = 0;
      oy += band + ROW_H * 2;
      band = 0;
    }
    const sub = place(top, ox, oy);
    ox += sub.w + GAP * 1.5;
    band = Math.max(band, sub.h);
  }
  for (const n of byId.values()) n.lp = 'right';
}

/**
 * Radial: the search at the centre, one ring per hop. Every subtree gets an angle in proportion to its
 * leaves, and rings are pushed out until neighbours on a ring are at least a label height apart.
 */
function layoutRadial(st, byId) {
  const kids = (id) => st.children.get(id) || [];
  const weight = new Map();
  const w = (id) => {
    const v = kids(id).length ? kids(id).reduce((s, c) => s + w(c), 0) : 1;
    weight.set(id, v);
    return v;
  };
  // One search sits at the centre; several (a case) or loose pieces share the first ring.
  const single = st.tops.length === 1;
  const shift = single ? 0 : 1;
  const total = st.tops.reduce((s, t) => s + w(t), 0);
  const assign = (id, a0, a1) => {
    const n = byId.get(id);
    n.ang = (a0 + a1) / 2;
    let a = a0;
    for (const c of kids(id)) {
      const span = ((a1 - a0) * weight.get(c)) / weight.get(id);
      assign(c, a, a + span);
      a += span;
    }
  };
  let a = -Math.PI / 2;
  for (const t of st.tops) {
    const span = (Math.PI * 2 * weight.get(t)) / total;
    assign(t, a, a + span);
    a += span;
  }
  const rings = [];
  for (const n of byId.values()) (rings[st.depth.get(n.id) + shift] ||= []).push(n);
  const radii = [0];
  for (let d = 1; d < rings.length; d++) {
    const ring = (rings[d] || []).sort((p, q) => p.ang - q.ang);
    let gap = Math.PI * 2;
    for (let i = 0; i < ring.length; i++) {
      const next = ring[(i + 1) % ring.length];
      const g = ring.length === 1 ? Math.PI * 2 : (next.ang - ring[i].ang + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2;
      gap = Math.min(gap, g);
    }
    const inner = d === 1 ? (single ? 40 : 0) : Math.min(190, Math.max(...(rings[d - 1] || []).filter((n) => kids(n.id).length).map((n) => n.textW + n.sub.length * SUB_W), 40));
    radii[d] = Math.max(radii[d - 1] + inner + 50, d * 90, 17 / gap);
  }
  for (const n of byId.values()) {
    const d = st.depth.get(n.id) + shift;
    n.tx = Math.cos(n.ang) * radii[d];
    n.ty = Math.sin(n.ang) * radii[d];
    n.lp = d === 0 ? 'below' : 'radial';
  }
  return radii;
}

/** Clusters: one pool per role on a ring around the searched entities, sized by how many it holds. */
function layoutClusters(nodes) {
  const counts = new Map();
  for (const n of nodes) {
    n.cluster = n.root ? 'root' : n.group;
    counts.set(n.cluster, (counts.get(n.cluster) || 0) + 1);
  }
  const groups = [...counts.keys()].filter((g) => g !== 'root').sort((a, b) => counts.get(b) - counts.get(a));
  const size = (g) => 50 + Math.sqrt(counts.get(g)) * 42;
  const ring = Math.max(260, (groups.reduce((s, g) => s + size(g) * 2, 0) / (Math.PI * 2)) * 1.2);
  const centre = new Map([['root', { x: 0, y: 0 }]]);
  let a = -Math.PI / 2;
  const total = groups.reduce((s, g) => s + size(g), 0);
  for (const g of groups) {
    const span = (Math.PI * 2 * size(g)) / total;
    centre.set(g, { x: Math.cos(a + span / 2) * ring, y: Math.sin(a + span / 2) * ring });
    a += span;
  }
  for (const n of nodes) {
    const c = centre.get(n.cluster);
    n.tx = c.x;
    n.ty = c.y;
    n.lp = 'below';
  }
  return groups.map((g) => ({ g, count: counts.get(g) }));
}

/**
 * Ownership: only entities joined by parent / subsidiary / owner links, layered so owners sit above what
 * they own. Each connected group gets its own chart; wide levels wrap.
 */
function ownershipSubset(nodes, edges) {
  const own = edges.filter(isOwnership);
  const ids = new Set(own.flatMap((e) => [e.a, e.b]));
  const level = new Map();
  const adj = new Map();
  for (const e of own) {
    // Positive step: b is one level below a.
    const step = TO_CHILD.has(String(e.label).toLowerCase()) ? 1 : -1;
    (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push({ to: e.b, step });
    (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push({ to: e.a, step: -step });
  }
  const comps = [];
  // Start from the searched side: roots first, then the best-connected entity of each remaining piece.
  const seeds = [...nodes].filter((n) => ids.has(n.id)).sort((a, b) => Number(!!b.root) - Number(!!a.root) || (adj.get(b.id)?.length || 0) - (adj.get(a.id)?.length || 0));
  for (const s of seeds) {
    if (level.has(s.id)) continue;
    const comp = [s.id];
    level.set(s.id, 0);
    for (let i = 0; i < comp.length; i++) {
      for (const { to, step } of adj.get(comp[i]) || []) {
        if (level.has(to)) continue;
        level.set(to, level.get(comp[i]) + step);
        comp.push(to);
      }
    }
    const min = Math.min(...comp.map((id) => level.get(id)));
    for (const id of comp) level.set(id, level.get(id) - min);
    comps.push(comp);
  }
  return { ids, level, comps };
}

function layoutOwnership(own, byId, links, detail) {
  const GAP = detail ? 104 : 92;
  const MAX_W = 820;
  const up = new Map(); // id → owners one level up
  for (const l of links) {
    if (!isOwnership(l)) continue;
    const [hi, lo] = own.level.get(l.a) < own.level.get(l.b) ? [l.a, l.b] : [l.b, l.a];
    (up.get(lo) || up.set(lo, []).get(lo)).push(hi);
  }
  let ox = 0;
  let oy = 0;
  let band = 0;
  for (const comp of own.comps) {
    const rows = [];
    for (const id of comp) (rows[own.level.get(id)] ||= []).push(byId.get(id));
    const slot = (n) => Math.max(n.hw * 2, 44) + 12;
    let y = 0;
    let compW = 0;
    const placed = [];
    rows.forEach((row, lv) => {
      if (!row) return;
      // Order each level under its owners (barycentre), then by name.
      const bary = (n) => {
        const xs = (up.get(n.id) || []).map((id) => byId.get(id)).filter((p) => p.tx != null && own.level.get(p.id) < lv).map((p) => p.tx);
        return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
      };
      row.sort((a, b) => bary(a) - bary(b) || String(a.label).localeCompare(String(b.label)));
      // Wrap wide levels into several lines.
      const lines = [[]];
      let lw = 0;
      for (const n of row) {
        if (lw + slot(n) > MAX_W && lines.at(-1).length) {
          lines.push([]);
          lw = 0;
        }
        lines.at(-1).push(n);
        lw += slot(n);
      }
      lines.forEach((line, i) => {
        const width = line.reduce((s, n) => s + slot(n), 0);
        compW = Math.max(compW, width);
        let x = -width / 2;
        for (const n of line) {
          n.tx = x + slot(n) / 2;
          n.ty = y + i * GAP * 0.62;
          placed.push(n);
          x += slot(n);
        }
      });
      y += (lines.length - 1) * GAP * 0.62 + GAP;
    });
    // Charts sit side by side, wrapping into a new band when the row gets too wide.
    if (ox > 0 && ox + compW > 1500) {
      ox = 0;
      oy += band + GAP * 0.4;
      band = 0;
    }
    for (const n of placed) {
      n.tx += ox + compW / 2;
      n.ty += oy;
    }
    ox += compW + 80;
    band = Math.max(band, y);
  }
  for (const n of byId.values()) n.lp = 'below';
}

/** Where a node's label reaches, relative to its centre: [x0, y0, x1, y1]. Used to fit the camera. */
function labelBox(n) {
  const tw = n.textW + (n.sub ? n.sub.length * SUB_W + 7 : 0);
  if (n.lp === 'right') return [-n.r - 4, -12, n.r + 8 + tw, 12];
  if (n.lp === 'radial') {
    const L = n.r + 8 + tw;
    const ex = Math.cos(n.ang) * L;
    const ey = Math.sin(n.ang) * L;
    return [Math.min(-n.r, ex) - 4, Math.min(-n.r, ey) - 6, Math.max(n.r, ex) + 4, Math.max(n.r, ey) + 6];
  }
  return [-n.hw, -n.r - 4, n.hw, n.r + 18 + (n.sub ? 11 : 0)];
}

function nodeLabel(n) {
  const t = (dx) => `<tspan class="t"${dx ? ' dx="7"' : ''}>${esc(n.text)}</tspan>`;
  const sub = n.sub ? `<tspan class="sub">${esc(n.sub)}</tspan>` : '';
  const after = n.sub ? `<tspan class="sub" dx="7">${esc(n.sub)}</tspan>` : '';
  if (n.lp === 'right') return `<text class="right" x="${n.r + 6}" y="4">${t()}${after}</text>`;
  if (n.lp === 'radial') {
    const deg = (n.ang * 180) / Math.PI;
    // Labels point outward; on the left half they are flipped so they never read upside down.
    return Math.cos(n.ang) >= 0
      ? `<text class="right" transform="rotate(${deg.toFixed(1)})" x="${n.r + 5}" y="3.5">${t()}${after}</text>`
      : `<text class="left" transform="rotate(${(deg + 180).toFixed(1)})" x="${-(n.r + 5)}" y="3.5">${sub}${t(!!sub)}</text>`;
  }
  return `<text y="${n.r + 13}">${t()}</text>${n.sub ? `<text class="sub" y="${n.r + 24}">${esc(n.sub)}</text>` : ''}`;
}

const f1 = (v) => v.toFixed(1);

/**
 * Render the graph into a container.
 * input: { snapshots } — one snapshot for a single investigation, many for a case.
 * opts: { onOpen(node), onSource(node), title }
 * Positions, camera, layout and filter settings are remembered on the container, so a re-render does not reshuffle.
 */
export function renderGraph(container, input, opts = {}) {
  container._graphStop?.();
  const mem = (container._graphMem ||= { pos: new Map(), cam: null, ui: { inferred: true, sources: !!opts.sources, minConf: 0.3 }, sel: null });
  if (container._graphSelect) {
    // A question elsewhere on the page asked to explain a link: show it, even below the confidence filter.
    mem.sel = container._graphSelect;
    container._graphSelect = null;
    if (mem.ui.minConf > 0.3) mem.ui.minConf = 0.3;
    mem.ui.inferred = true;
  }
  const ui = mem.ui;
  ui.layout ||= 'force';
  const model = graphModel(input.snapshots, ui);
  const hasOwnership = model.edges.some(isOwnership);
  if (ui.layout === 'ownership' && !hasOwnership) ui.layout = 'force';
  const mode = ui.layout;
  // A layout switch re-runs the animation from where the nodes are now, and refits the camera.
  const switched = mem.layout && mem.layout !== mode;
  mem.layout = mode;
  // Ownership shows only the corporate structure; the rest of the graph is one layout switch away.
  const own = mode === 'ownership' ? ownershipSubset(model.nodes, model.edges) : null;
  const nodes = own ? model.nodes.filter((n) => own.ids.has(n.id)) : model.nodes;
  const edges = own ? model.edges.filter((e) => own.ids.has(e.a) && own.ids.has(e.b)) : model.edges;
  const hidden = model.nodes.length - nodes.length;
  if (nodes.length < 2) {
    ui.max = false;
    container.classList.remove('graph-max');
    container.innerHTML = '<p class="empty-note">Not enough linked entities to draw a graph yet.</p>';
    return;
  }
  container.classList.toggle('graph-max', !!ui.max);
  const w = Math.round(container.clientWidth || 960);
  const detail = !!ui.detail;
  // Seed: remembered position, else near an already-placed neighbour, else a small ring (the "bloom").
  nodes.forEach((n, i) => {
    const old = mem.pos.get(n.id);
    if (old) return Object.assign(n, old);
    if (n.root && !nodes.some((x) => x.root && x !== n && mem.pos.has(x.id))) return Object.assign(n, { x: (Math.random() - 0.5) * 40, y: (Math.random() - 0.5) * 40 });
    const nb = edges.map((e) => (e.a === n.id ? e.b : e.b === n.id ? e.a : null)).map((id) => id && mem.pos.get(id)).find(Boolean);
    const ang = (i / nodes.length) * Math.PI * 2;
    const base = nb || { x: 0, y: 0 };
    n.x = base.x + Math.cos(ang) * 20 + (Math.random() - 0.5) * 6;
    n.y = base.y + Math.sin(ang) * 20 + (Math.random() - 0.5) * 6;
  });
  const sim = createSim(nodes, edges, { mode, detail });
  const byId = sim.byId;
  const st = spanningTree(nodes, sim.links);
  if (mode === 'tree' && detail) {
    // In the outline the relation reads best next to the child it led to.
    for (const l of sim.links) if (l.tree && l.label) byId.get(l.child).sub = `${short(l.label, 22)} · ${byId.get(l.child).sub}`;
  }
  let radii = null;
  let clusters = null;
  if (mode === 'tree') layoutTree(st, byId);
  else if (mode === 'radial') radii = layoutRadial(st, byId);
  else if (mode === 'clusters') clusters = layoutClusters(nodes);
  else if (mode === 'ownership') layoutOwnership(own, byId, sim.links, detail);
  else for (const n of nodes) n.lp = 'below';
  for (const n of nodes) n.box = labelBox(n);
  if (mem.pos.size) sim.alpha = switched ? 1 : 0.5;
  if (switched) mem.cam = null;
  const structured = STRUCTURED.has(mode);
  const arrows = detail && !structured;

  // Canvas height: structured layouts are as tall as they need (within the window), the force layout grows
  // with the number of entities, and the expanded view fills the screen (measured once the bars are drawn).
  let h;
  if (structured) {
    let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (const n of nodes) {
      x0 = Math.min(x0, n.tx + n.box[0]);
      x1 = Math.max(x1, n.tx + n.box[2]);
      y0 = Math.min(y0, n.ty + n.box[1]);
      y1 = Math.max(y1, n.ty + n.box[3]);
    }
    const s = Math.max(0.45, Math.min(1, (w - 40) / Math.max(x1 - x0, 1)));
    h = Math.round(Math.max(460, Math.min(window.innerHeight * 0.85, (y1 - y0) * s + 60)));
  } else h = Math.round(Math.max(460, Math.min(window.innerHeight * 0.78, mode === 'clusters' ? 900 : 820, 280 + nodes.length * (mode === 'clusters' ? 11 : 9))));

  const groupCount = new Map();
  for (const n of nodes) groupCount.set(n.group, (groupCount.get(n.group) || 0) + 1);
  const groups = Object.keys(GROUPS).filter((g) => groupCount.has(g));
  const many = nodes.length > 45;
  const inferredAll = model.allEdges.filter((e) => e.kind === 'inferred');
  const stats = model.stats;
  const layoutInfo = LAYOUTS.find((l) => l.id === mode);
  const nStated = edges.filter((e) => e.kind === 'stated').length;
  const nInferred = edges.filter((e) => e.kind === 'inferred').length;
  const levels = own ? Math.max(...own.level.values()) + 1 : 0;
  const statLine = [
    `${nodes.length} entities`,
    `${nStated} stated link${nStated === 1 ? '' : 's'}`,
    nInferred && `${nInferred} inferred`,
    own ? `${levels} level${levels === 1 ? '' : 's'}` : st.maxDepth && `${st.maxDepth} hop${st.maxDepth === 1 ? '' : 's'} deep`,
    `${nodes.filter((n) => n.deg >= 4).length} hubs`,
    st.tops.length > 1 && `${st.tops.length} separate pieces`,
  ].filter(Boolean);
  const markerId = `gm-${Math.random().toString(36).slice(2, 8)}`;
  const ringLabel = (d) => (st.tops.length === 1 ? `${d} hop${d > 1 ? 's' : ''}` : d === 1 ? 'start' : `${d - 1} hop${d > 2 ? 's' : ''}`);

  const keyLine = (cls) => `<svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" class="${cls}"/></svg>`;
  container.innerHTML = `
    <div class="graph-card">
    <div class="graph-toolbar">
      <div class="graph-modes" role="radiogroup" aria-label="Layout">${LAYOUTS.filter((l) => l.id !== 'ownership' || hasOwnership)
        .map((l) => `<button type="button" role="radio" aria-checked="${l.id === mode}" data-layout="${l.id}" title="${esc(l.hint)}">${l.icon}<span>${esc(l.label)}</span></button>`)
        .join('')}</div>
      <div class="graph-tools">
        <label class="field graph-find">${ICON('<circle cx="6" cy="6" r="4.2"/><path d="m9.2 9.2 3.3 3.3"/>')}<input type="search" placeholder="Find in graph" value="${esc(mem.find || '')}" aria-label="Find an entity in the graph" spellcheck="false"><output aria-live="polite"></output></label>
        <button type="button" class="gbtn" data-act="detail" aria-pressed="${detail}" title="Full names, entity type and link count, every link label, link direction">${ICON('<path d="M2 3.5h10M2 7h10M2 10.5h6"/>')}<span>Detailed</span></button>
        <span class="gsep" aria-hidden="true"></span>
        <button type="button" class="gbtn icon" data-act="fit" title="Fit the graph to the view" aria-label="Fit to view">${ICON('<path d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9"/>')}</button>
        <button type="button" class="gbtn ${ui.max ? '' : 'icon'}" data-act="max" aria-pressed="${!!ui.max}" title="${ui.max ? 'Back to the page (Esc)' : 'Use the whole window'}" aria-label="${ui.max ? 'Close the expanded graph' : 'Expand the graph'}">${ui.max ? `${ICON('<path d="M5 1.5V5H1.5M9 1.5V5h3.5M12.5 9H9v3.5M1.5 9H5v3.5"/>')}<span>Close</span>` : ICON('<path d="M5 1.5H1.5V5M9 1.5h3.5V5M12.5 9v3.5H9M1.5 9v3.5H5"/><path d="m1.8 1.8 3 3M12.2 1.8l-3 3M12.2 12.2l-3-3M1.8 12.2l3-3"/>')}</button>
      </div>
    </div>
    <div class="graph-filters">
      <div class="graph-legend" aria-label="Entity types">${groups.map((g) => `<button type="button" class="legend-item" data-group="${g}" aria-pressed="false" title="Highlight ${esc(GROUPS[g].label)}"><i style="background:${GROUPS[g].color}"></i>${esc(GROUPS[g].label)}<b>${groupCount.get(g)}</b></button>`).join('')}</div>
      <div class="graph-controls" aria-label="Links">
        <label class="gc"><input type="checkbox" data-ui="inferred" ${ui.inferred ? 'checked' : ''}>Inferred <b>${inferredAll.length}</b></label>
        <label class="gc range" ${ui.inferred ? '' : 'data-off'}><span>≥</span><input type="range" min="30" max="95" step="5" value="${Math.round(ui.minConf * 100)}" style="--fill:${((ui.minConf * 100 - 30) / 65) * 100}%" data-ui="minConf" aria-label="Minimum confidence for inferred links"><output>${pct(ui.minConf)}</output></label>
        <label class="gc"><input type="checkbox" data-ui="sources" ${ui.sources ? 'checked' : ''}>Sources</label>
        ${model.candidates.length ? `<button type="button" class="gbtn small" data-act="dupes" title="Similar entities that were not merged">Duplicates <b>${model.candidates.length}</b></button>` : ''}
      </div>
    </div>
    <div class="graph-wrap">
      <svg class="graph mode-${mode} ${edges.filter((e) => e.kind !== 'source').length <= 14 ? 'few' : ''} ${many ? 'many' : ''} ${detail ? 'detail' : ''}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(layoutInfo.label)} graph of ${nodes.length} entities">
        <defs><marker id="${markerId}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,.6 8,4 0,7.4z" fill="context-stroke"/></marker></defs>
        <g class="viewport">
          ${radii ? `<g class="guides">${radii.map((r, d) => (d ? `<circle r="${f1(r)}"/><text y="${f1(-r - 6)}">${ringLabel(d)}</text>` : '')).join('')}</g>` : ''}
          ${clusters ? `<g class="clusters">${clusters.map((c) => `<g class="cluster" data-g="${c.g}" style="--c:${GROUPS[c.g]?.color || 'var(--muted)'}"><circle/><text>${esc(GROUPS[c.g]?.label || c.g)} · ${c.count}</text></g>`).join('')}</g>` : ''}
          <g class="edges">${sim.links
            .map((e, i) => `<g class="edge ${e.kind}${e.pivot ? ' pivot' : ''}${e.tree ? ' tree' : ''}${own && isOwnership(e) ? ' own' : ''} b-${e.kind === 'inferred' ? band(e.confidence) : 'confirmed'}" data-i="${i}"><path class="hit"/><path class="vis" style="${e.kind === 'inferred' ? `stroke-width:${(0.8 + e.confidence * 2).toFixed(2)}` : ''}"${arrows && e.kind !== 'source' ? ` marker-end="url(#${markerId})"` : ''}/>${e.kind !== 'source' ? `<text>${esc(short(e.kind === 'inferred' ? `${e.label} · ${pct(e.confidence)}` : e.label, 30))}</text>` : ''}</g>`)
            .join('')}</g>
          <g class="nodes">${nodes
            .map(
              (n) => `<g class="node g-${n.group} ${n.type === 'source' ? 'is-source' : ''} ${n.root ? 'is-root' : ''} ${n.deg >= 4 ? 'is-hub' : ''} ${INVESTIGABLE.has(n.type) && !n.root ? 'is-open' : ''} ${n.aliases?.length ? 'has-alias' : ''}" data-id="${esc(n.id)}" tabindex="0">
                <circle class="halo" r="${n.r + 5}" style="fill:${colorOf(n)}"/>
                <circle class="core" r="${n.r}" style="fill:${colorOf(n)}"/>
                ${nodeLabel(n)}
                <title>${esc(GROUPS[n.group]?.label || n.type)}: ${esc(n.label)}${n.aliases?.length ? ` (also: ${esc(n.aliases.join(', '))})` : ''}</title>
              </g>`,
            )
            .join('')}</g>
        </g>
      </svg>
      <aside class="graph-panel" hidden aria-live="polite"></aside>
    </div>
    <div class="graph-foot">
      <div class="graph-key"><span>${keyLine('k-stated')}stated</span><span>${keyLine('k-inferred')}inferred</span><span>${keyLine('k-pivot')}pivot followed</span></div>
      <span class="graph-stats">${statLine.join(' · ')}</span>
      <p class="graph-desc"><b>${esc(layoutInfo.label)}</b> · ${esc(layoutInfo.hint)}.${hidden ? ` <em>${hidden} entities outside the ownership structure are hidden.</em>` : ''}<span class="graph-hint"> Click a node or line for details · shift-click two nodes to explain the link · double-click to investigate${stats.merged ? ` · ${stats.merged} duplicate mention${stats.merged > 1 ? 's' : ''} merged` : ''}.</span></p>
    </div>
    </div>`;

  const svg = container.querySelector('svg.graph');
  const panel = container.querySelector('.graph-panel');
  const viewport = svg.querySelector('.viewport');
  const nodeEls = new Map([...svg.querySelectorAll('.node')].map((g) => [g.dataset.id, g]));
  const edgeEls = [...svg.querySelectorAll('.edge')].map((g) => ({ paths: [...g.querySelectorAll('path')], text: g.querySelector('text'), g }));
  const clusterEls = clusters
    ? [...svg.querySelectorAll('.cluster')].map((g) => ({ circle: g.querySelector('circle'), text: g.querySelector('text'), members: nodes.filter((n) => n.cluster === g.dataset.g) }))
    : [];
  if (ui.max) {
    // Fill the window below the bars.
    h = Math.max(320, Math.round(window.innerHeight - svg.getBoundingClientRect().top - container.querySelector('.graph-foot').offsetHeight - 18));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  // Controls re-render with the same positions and camera.
  container.querySelectorAll('[data-ui]').forEach((input) =>
    input.addEventListener(input.type === 'range' ? 'input' : 'change', () => {
      const k = input.dataset.ui;
      ui[k] = input.type === 'checkbox' ? input.checked : Number(input.value) / 100;
      if (input.type === 'range') {
        input.nextElementSibling.textContent = pct(ui[k]);
        clearTimeout(container._rangeT);
        container._rangeT = setTimeout(() => renderGraph(container, input0, opts), 120);
      } else renderGraph(container, input0, opts);
    }),
  );
  const input0 = input;
  container.querySelectorAll('[data-layout]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.layout === mode) return;
      ui.layout = b.dataset.layout;
      renderGraph(container, input0, opts);
      container.querySelector(`[data-layout="${ui.layout}"]`)?.focus();
    }),
  );
  // Arrow keys move between layouts, as in any radio group.
  container.querySelector('.graph-modes').addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    const all = [...container.querySelectorAll('[data-layout]')];
    const i = all.findIndex((b) => b.dataset.layout === mode);
    all[(i + (ev.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length]?.click();
    ev.preventDefault();
  });
  const setMax = (on) => {
    ui.max = on;
    mem.cam = null;
    renderGraph(container, input0, opts);
  };
  container.querySelector('[data-act="max"]').addEventListener('click', () => setMax(!ui.max));
  container.querySelector('[data-act="detail"]').addEventListener('click', () => {
    ui.detail = !ui.detail;
    renderGraph(container, input0, opts);
  });

  // Camera. It follows the layout (auto-fit) until the user pans or zooms.
  let cam = mem.cam ? { ...mem.cam } : { s: 1, x: w / 2, y: h / 2 };
  let follow = !mem.cam;
  const applyCam = () => {
    viewport.setAttribute('transform', `translate(${cam.x},${cam.y}) scale(${cam.s})`);
    // Zoomed out, the free layouts keep only hub labels; outlines and detail keep every label.
    svg.classList.toggle('far', !structured && !detail && cam.s < 0.62);
    mem.cam = follow ? null : { ...cam };
  };
  const fitTarget = () => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of nodes) {
      x0 = Math.min(x0, n.x + n.box[0]);
      x1 = Math.max(x1, n.x + n.box[2]);
      y0 = Math.min(y0, n.y + n.box[1]);
      y1 = Math.max(y1, n.y + n.box[3]);
    }
    for (const c of clusterEls) {
      if (c.r == null) continue;
      x0 = Math.min(x0, c.cx - c.r);
      x1 = Math.max(x1, c.cx + c.r);
      y0 = Math.min(y0, c.cy - c.r - 16);
      y1 = Math.max(y1, c.cy + c.r);
    }
    // Never fit so small that labels become unreadable; pan to see the rest. Structures may go smaller,
    // since their shape is the point and every label stays in place.
    const s = Math.max(structured ? 0.45 : mode === 'clusters' ? 0.4 : 0.7, Math.min(1.4, (w - 40) / Math.max(x1 - x0, 1), (h - 40) / Math.max(y1 - y0, 1)));
    return { s, x: w / 2 - ((x0 + x1) / 2) * s, y: h / 2 - ((y0 + y1) / 2) * s };
  };
  const toSvg = (ev) => {
    const r = svg.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * w, y: ((ev.clientY - r.top) / r.height) * h };
  };
  const toWorld = (p) => ({ x: (p.x - cam.x) / cam.s, y: (p.y - cam.y) / cam.s });

  // Link geometry per layout: [path, label x, label y].
  const edgeGeom = (l) => {
    const { s, t } = l;
    if (mode === 'tree' && l.tree) {
      // Outline elbows: down the parent's spine, then across to the child.
      const p = byId.get(l.par);
      const c = byId.get(l.child);
      const end = c.x - c.r - 1;
      const top = p.y + p.r;
      if (c.branch) {
        // Branches hang off a bus line just above their row.
        const by = c.y - ROW_H * 0.6;
        return [`M${f1(p.x)},${f1(top)}V${f1(by)}H${f1(c.x)}V${f1(c.y - c.r - 1)}`, c.x, by - 4];
      }
      if (c.tcol > 0) {
        const my = c.y - (c.trow + 0.5) * ROW_H;
        const sx = c.x - 16;
        return [`M${f1(p.x)},${f1(top)}V${f1(my)}H${f1(sx)}V${f1(c.y)}H${f1(end)}`, sx, c.y - 5];
      }
      return [`M${f1(p.x)},${f1(top)}V${f1(c.y)}H${f1(end)}`, p.x, c.y - 5];
    }
    if (own && isOwnership(l)) {
      const [u, v] = own.level.get(s.id) <= own.level.get(t.id) ? [s, t] : [t, s];
      const my = (u.y + v.y) / 2;
      return [`M${f1(u.x)},${f1(u.y + u.r)}C${f1(u.x)},${f1(my)} ${f1(v.x)},${f1(my)} ${f1(v.x)},${f1(v.y - v.r - 1)}`, (u.x + v.x) / 2, my - 3];
    }
    if (mode === 'tree' || mode === 'ownership') {
      // Links outside the structure bow out of the way.
      const mx = (s.x + t.x) / 2;
      const my = (s.y + t.y) / 2;
      const cx = mx + (t.y - s.y) * 0.3;
      const cy = my - (t.x - s.x) * 0.3;
      return [`M${f1(s.x)},${f1(s.y)}Q${f1(cx)},${f1(cy)} ${f1(t.x)},${f1(t.y)}`, (mx + cx) / 2, (my + cy) / 2 - 3];
    }
    let x2 = t.x;
    let y2 = t.y;
    if (arrows && l.kind !== 'source') {
      // Stop short of the target so the arrowhead is not hidden under the dot.
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      x2 -= (dx / d) * (t.r + 2.5);
      y2 -= (dy / d) * (t.r + 2.5);
    }
    return [`M${f1(s.x)},${f1(s.y)}L${f1(x2)},${f1(y2)}`, (s.x + t.x) / 2, (s.y + t.y) / 2 - 4];
  };

  const draw = () => {
    for (const n of nodes) nodeEls.get(n.id).setAttribute('transform', `translate(${f1(n.x)},${f1(n.y)})`);
    sim.links.forEach((l, i) => {
      const { paths, text } = edgeEls[i];
      const [d, lx, ly] = edgeGeom(l);
      for (const p of paths) p.setAttribute('d', d);
      if (text) {
        text.setAttribute('x', f1(lx));
        text.setAttribute('y', f1(ly));
      }
    });
    for (const c of clusterEls) {
      // A soft pool around each group, drawn from where its members actually are.
      let cx = 0;
      let cy = 0;
      for (const n of c.members) {
        cx += n.x;
        cy += n.y;
      }
      cx /= c.members.length;
      cy /= c.members.length;
      let r = 0;
      for (const n of c.members) r = Math.max(r, Math.hypot(n.x - cx, n.y - cy) + Math.max(n.r + 12, n.hw * 0.75));
      r += 10;
      Object.assign(c, { cx, cy, r });
      c.circle.setAttribute('cx', f1(cx));
      c.circle.setAttribute('cy', f1(cy));
      c.circle.setAttribute('r', f1(r));
      c.text.setAttribute('x', f1(cx));
      c.text.setAttribute('y', f1(cy - r - 7));
    }
    if (follow) {
      const t = fitTarget();
      const k = reduceMotion() ? 1 : 0.12;
      cam = { s: cam.s + (t.s - cam.s) * k, x: cam.x + (t.x - cam.x) * k, y: cam.y + (t.y - cam.y) * k };
    }
    applyCam();
  };

  // Animation loop: runs while the simulation is warm or a drag is active, then sleeps.
  let raf = 0;
  const loop = () => {
    raf = 0;
    if (!svg.isConnected) return;
    sim.tick();
    draw();
    for (const n of nodes) mem.pos.set(n.id, { x: n.x, y: n.y });
    if (sim.alpha > 0.004 || sim.alphaTarget > 0) raf = requestAnimationFrame(loop);
  };
  const wake = (alpha = 0.3) => {
    sim.alpha = Math.max(sim.alpha, alpha);
    if (!raf) raf = requestAnimationFrame(loop);
  };
  const onResize = () => {
    if (svg.isConnected && container.clientWidth > 0 && Math.abs(container.clientWidth - w) > 40) renderGraph(container, input0, opts);
  };
  let resizeT;
  const onResizeDebounced = () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(onResize, 150);
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape' && ui.max && svg.isConnected && !ev.target.matches('input, textarea')) setMax(false);
  };
  window.addEventListener('resize', onResizeDebounced);
  window.addEventListener('keydown', onKey);
  container._graphStop = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResizeDebounced);
    window.removeEventListener('keydown', onKey);
  };
  if (reduceMotion()) {
    for (let i = 0; i < 300; i++) sim.tick();
    sim.alpha = 0;
    draw();
  } else {
    draw();
    wake(sim.alpha);
  }

  /* ---------- Highlighting ---------- */
  const neighbours = (id) => new Set(sim.links.filter((e) => e.a === id || e.b === id).flatMap((e) => [e.a, e.b]));
  let locked = null; // { nodes:Set, edges:Set } while a panel selection is shown
  let found = null; // Set of node ids matching the find box, while it has text
  const paint = (litNodes, litEdges) => {
    svg.classList.toggle('focus', !!litNodes);
    for (const [nid, g] of nodeEls) g.classList.toggle('lit', !!litNodes?.has(nid));
    sim.links.forEach((e, i) => edgeEls[i].g.classList.toggle('lit', !!litEdges?.has(i)));
  };
  const restore = () => (locked ? paint(locked.nodes, locked.edges) : pinnedGroup ? focusGroup(pinnedGroup) : found ? paint(found, new Set()) : paint(null, null));
  const focus = (id) => {
    const nb = neighbours(id);
    const le = new Set(sim.links.map((e, i) => (e.a === id || e.b === id ? i : -1)).filter((i) => i >= 0));
    paint(nb, le);
    nodeEls.get(id).querySelector('.t').textContent = byId.get(id).label;
  };
  const unfocus = () => {
    for (const [nid, g] of nodeEls) g.querySelector('.t').textContent = byId.get(nid).text;
    restore();
  };
  let pinnedGroup = null;
  const focusGroup = (g) => {
    paint(new Set(nodes.filter((n) => n.group === g || n.root).map((n) => n.id)), new Set(sim.links.map((e, i) => (e.s.group === g || e.t.group === g ? i : -1)).filter((i) => i >= 0)));
    for (const b of legendEls) b.classList.toggle('on', b.dataset.group === g);
  };
  const clearGroup = () => {
    for (const b of legendEls) b.classList.toggle('on', b.dataset.group === pinnedGroup);
    restore();
  };
  const legendEls = [...container.querySelectorAll('.legend-item')];
  for (const b of legendEls) {
    b.addEventListener('pointerenter', () => focusGroup(b.dataset.group));
    b.addEventListener('focus', () => focusGroup(b.dataset.group));
    b.addEventListener('pointerleave', clearGroup);
    b.addEventListener('blur', clearGroup);
    b.addEventListener('click', () => {
      pinnedGroup = pinnedGroup === b.dataset.group ? null : b.dataset.group;
      for (const x of legendEls) x.setAttribute('aria-pressed', String(pinnedGroup === x.dataset.group));
      clearGroup();
    });
  }
  svg.addEventListener('pointerover', (ev) => {
    const g = ev.target.closest('.node');
    if (g && !drag?.pan) focus(g.dataset.id);
  });
  svg.addEventListener('pointerout', (ev) => {
    if (ev.target.closest('.node') && !drag?.node) unfocus();
  });

  /* ---------- Find ---------- */
  const findInput = container.querySelector('.graph-find input');
  const findOut = container.querySelector('.graph-find output');
  let foundList = [];
  const runFind = () => {
    mem.find = findInput.value;
    const q = findInput.value.trim().toLowerCase();
    foundList = q ? nodes.filter((n) => [n.label, n.value, ...(n.aliases || [])].some((s) => String(s ?? '').toLowerCase().includes(q))) : [];
    found = q ? new Set(foundList.map((n) => n.id)) : null;
    findOut.textContent = q ? (foundList.length ? `${foundList.length}` : 'none') : '';
    mem.findIdx = -1;
    restore();
  };
  // Glide the camera to a node, leaving room for the details panel.
  const centreOn = (n) => {
    follow = false;
    const s = Math.max(cam.s, 1.1);
    const cx = !panel.hidden && w > 760 ? (w - 380) / 2 : w / 2;
    const to = { s, x: cx - n.x * s, y: h / 2 - n.y * s };
    if (reduceMotion()) {
      cam = to;
      return applyCam();
    }
    const from = { ...cam };
    let k = 0;
    const step = () => {
      k = Math.min(1, k + 0.08);
      const e = 1 - (1 - k) ** 3;
      cam = { s: from.s + (to.s - from.s) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      applyCam();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  findInput.addEventListener('input', runFind);
  findInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && foundList.length) {
      // Enter steps through the matches.
      ev.preventDefault();
      mem.findIdx = ((mem.findIdx ?? -1) + 1) % foundList.length;
      const n = foundList[mem.findIdx];
      findOut.textContent = `${mem.findIdx + 1}/${foundList.length}`;
      selected = n;
      showNode(n);
      centreOn(n);
    } else if (ev.key === 'Escape' && findInput.value) {
      ev.stopPropagation();
      findInput.value = '';
      runFind();
    }
  });
  if (findInput.value) runFind();

  /* ---------- Details panel ---------- */
  const nodeName = (id) => byId.get(id)?.label || model.nodes.find((n) => n.id === id)?.label || id;
  const kindBadge = (e) =>
    e.kind === 'inferred' ? `<span class="lk inferred b-${band(e.confidence)}">Inferred · ${pct(e.confidence)} · ${esc(BAND_LABEL[band(e.confidence)])}</span>` : e.kind === 'source' ? '<span class="lk">Source run</span>' : '<span class="lk stated">Stated by a source</span>';
  const showPanel = (html, lit) => {
    panel.innerHTML = `<button type="button" class="gp-close" aria-label="Close details">×</button>${html}`;
    panel.hidden = false;
    locked = lit || null;
    restore();
  };
  const closePanel = () => {
    panel.hidden = true;
    locked = null;
    mem.sel = null;
    restore();
  };
  const edgeIndex = (e) => sim.links.findIndex((l) => l.id === e.id);
  const evidenceList = (list) =>
    list?.length
      ? `<ul class="gp-ev">${list
          .slice(0, 6)
          .map((ev) => {
            const local = ev.local || String(ev.url).startsWith('local:');
            const where = local ? `Computed on your device (${esc(String(ev.url).replace('local:', ''))})` : `<a href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">${esc(shortUrl(ev.url))}</a>`;
            const meta = [ev.source, !local && ev.status && `HTTP ${ev.status}`, ev.viaRelay && 'via relay', ev.retrievedAt && when(ev.retrievedAt), ev.sha256 && `SHA-256 ${ev.sha256.slice(0, 12)}…`].filter(Boolean).join(' · ');
            return `<li><span class="gp-ev-url">${where}</span><small>${esc(meta)}</small>${opts.onEvidence ? `<button type="button" data-ev="${esc(ev.url)}" data-src="${esc(ev.source || '')}">Open</button>` : ''}</li>`;
          })
          .join('')}</ul>`
      : '';
  const hopList = (hops) =>
    `<ol class="gp-hops">${hops.map((hop) => `<li><span class="lk-dot ${hop.edge.kind}${hop.edge.pivot ? ' pivot' : ''}"></span><span>${esc(nodeName(hop.from))} <em>${esc(hop.edge.label)}</em> ${esc(nodeName(hop.to))}${hop.edge.sources?.length ? `<small>${esc(hop.edge.sources.join(', '))}</small>` : ''}</span><button type="button" data-edge="${esc(hop.edge.id)}" aria-label="Why: ${esc(hop.edge.label)}">why</button></li>`).join('')}</ol>`;
  // How the investigation reached the endpoint that is further from the search.
  const reachedHtml = (e) => {
    const pa = discoveryPath(model, e.a);
    const pb = discoveryPath(model, e.b);
    const [far, path] = (pb?.length || 0) >= (pa?.length || 0) ? [e.b, pb] : [e.a, pa];
    if (!path?.length || (path.length === 1 && path[0].edge.id === e.id)) return '';
    return `<h4>How Indizia reached ${esc(short(nodeName(far), 40))}</h4>${hopList(path)}`;
  };
  const followBtn = (id) => {
    const n = byId.get(id) || model.nodes.find((x) => x.id === id);
    if (!n || n.root || n.investigated || !opts.onFollow || !INVESTIGABLE.has(n.type) || n.type === 'username') return '';
    return `<button type="button" class="btn" data-follow="${esc(n.id)}">Investigate ${esc(short(n.label, 28))} here</button>`;
  };
  const showEdge = (e) => {
    mem.sel = { edge: e.id };
    let body = '';
    if (e.kind === 'inferred') {
      body = `<h4>Why Indizia links them</h4>
        <ol class="gp-why">${e.reasons
          .map((r) => {
            const support = (r.edges || []).map((id) => model.allEdges.find((x) => x.id === id)).filter(Boolean);
            return `<li><div class="gp-why-head"><span>${esc(r.text)}</span><b>${pct(r.weight)}</b></div>
              ${support.length ? `<div class="gp-support">${support.map((se) => `<p><span class="lk-dot stated"></span>${esc(nodeName(se.a))} <em>${esc(se.label)}</em> ${esc(nodeName(se.b))} <button type="button" data-edge="${esc(se.id)}">evidence</button></p>`).join('')}</div>` : r.kind ? `<p class="gp-note">Computed by Indizia from the names; no request involved.</p>` : ''}
              ${r.caveat ? `<p class="gp-caveat"><b>Could mislead:</b> ${esc(r.caveat)}</p>` : ''}</li>`;
          })
          .join('')}</ol>
        <p class="gp-note">Independent signals are combined (1 − Π(1 − w)) into ${pct(e.confidence)}. Inferred links are hypotheses to check, not facts. Shared CDNs, cloud hosts and mass-market DNS count for little or nothing.</p>`;
    } else if (e.kind === 'source') {
      body = `<h4>Evidence</h4><ul class="gp-reasons"><li><span>${esc(e.sources?.join(', ') || 'A source')} produced this entity</span></li></ul>`;
    } else {
      body = `<h4>Why they are connected</h4>
        <p class="gp-lead">${esc(e.sources?.join(', ') || 'A source')} states that ${esc(nodeName(e.a))} <em>${esc(e.label)}</em> ${esc(nodeName(e.b))}.${e.pivot ? ' Indizia followed this link as a pivot.' : ''}</p>
        ${e.evidence?.length ? `<h4>Request behind it <small>${e.evidence.length}</small></h4>${evidenceList(e.evidence)}` : '<p class="gp-note">No request is recorded for this link (it comes from the structure of the data, such as a subdomain of a searched domain).</p>'}`;
    }
    const actions = [followBtn(e.a), followBtn(e.b)].filter(Boolean).join('');
    showPanel(
      `<div class="gp-eyebrow">${kindBadge(e)}</div>
       <h3 class="gp-title">${esc(nodeName(e.a))} <span>— ${esc(e.label)} —</span> ${esc(nodeName(e.b))}</h3>
       ${body}
       ${e.kind !== 'source' ? reachedHtml(e) : ''}
       ${actions ? `<div class="gp-actions">${actions}</div>` : ''}`,
      { nodes: new Set([e.a, e.b]), edges: new Set([edgeIndex(e)]) },
    );
  };
  const showNode = (n) => {
    mem.sel = { node: n.id };
    const inc = model.allEdges.filter((e) => e.a === n.id || e.b === n.id);
    const merges = model.merges.filter((m) => m.keys.some((k) => n.keys?.includes(k)));
    const conn = (e) => {
      const other = e.a === n.id ? e.b : e.a;
      return `<li><button type="button" data-edge="${esc(e.id)}"><span class="lk-dot ${e.kind}"></span><span>${esc(e.label)} <b>${esc(nodeName(other))}</b></span>${e.kind === 'inferred' ? `<em>${pct(e.confidence)}</em>` : ''}</button></li>`;
    };
    const stated = inc.filter((e) => e.kind === 'stated');
    const inferred = inc.filter((e) => e.kind === 'inferred').sort((a, b) => b.confidence - a.confidence);
    // Hops from the search, when this node's piece of the graph hangs off a searched entity.
    let top = n.id;
    while (st.parent.get(top) != null) top = st.parent.get(top);
    const hops = !own && !n.root && byId.get(top)?.root ? st.depth.get(n.id) : null;
    showPanel(
      `<div class="gp-eyebrow"><span class="lk" style="--c:${colorOf(n)}"><i></i>${esc(GROUPS[n.group]?.label || n.type)}</span>${n.root ? '<span class="lk">searched</span>' : ''}${hops ? `<span class="lk">${hops} hop${hops > 1 ? 's' : ''} from the search</span>` : ''}<span class="lk">${inc.length} link${inc.length === 1 ? '' : 's'}</span>${input.snapshots.length > 1 && n.snaps?.length ? `<span class="lk">in ${n.snaps.length} of ${input.snapshots.length} investigations</span>` : ''}</div>
       <h3 class="gp-title">${esc(n.label)}</h3>
       ${n.label !== n.value && n.type !== 'source' ? `<p class="gp-value mono">${esc(n.value)}</p>` : ''}
       ${n.aliases?.length ? `<h4>Also known as</h4><p class="gp-aliases">${n.aliases.map((a) => `<span>${esc(a)}</span>`).join('')}</p>` : ''}
       ${merges.length ? `<h4>Merged duplicates</h4><ul class="gp-reasons">${merges.map((m) => `<li><span>${esc(m.reason)}</span><b>${pct(m.confidence)}</b></li>`).join('')}</ul>` : ''}
       ${inferred.length ? `<h4>Inferred links <small>${inferred.length}</small></h4><ul class="gp-conn">${inferred.slice(0, 12).map(conn).join('')}</ul>` : ''}
       ${stated.length ? `<h4>Stated links <small>${stated.length}</small></h4><ul class="gp-conn">${stated.slice(0, 14).map(conn).join('')}</ul>${stated.length > 14 ? `<p class="gp-note">${stated.length - 14} more</p>` : ''}` : ''}
       ${(() => {
         const path = n.type === 'source' ? null : discoveryPath(model, n.id);
         return path?.length ? `<h4>How Indizia reached it <small>${path.length} step${path.length > 1 ? 's' : ''}</small></h4>${hopList(path)}` : '';
       })()}
       <div class="gp-actions">
         ${followBtn(n.id).replace('class="btn"', 'class="btn primary"')}
         ${INVESTIGABLE.has(n.type) && !(n.root && input.snapshots.length === 1) ? `<button type="button" class="btn ${followBtn(n.id) ? '' : 'primary'}" data-act="open">${followBtn(n.id) ? 'New search' : 'Investigate'}</button>` : ''}
         ${n.type === 'source' ? `<button type="button" class="btn" data-act="source">Show evidence</button>` : ''}
         <span class="gp-note">Shift-click another node to explain the connection.</span>
       </div>`,
      { nodes: new Set([n.id, ...neighbours(n.id)]), edges: new Set(sim.links.map((e, i) => (e.a === n.id || e.b === n.id ? i : -1)).filter((i) => i >= 0)) },
    );
    panel.querySelector('[data-act="open"]')?.addEventListener('click', () => opts.onOpen?.(n));
    panel.querySelector('[data-act="source"]')?.addEventListener('click', () => opts.onSource?.(n));
  };
  const showPath = (a, b) => {
    mem.sel = { path: [a.id, b.id] };
    const paths = explainConnection(model, a.id, b.id, { max: 3, depth: 5 });
    const litN = new Set([a.id, b.id]);
    const litE = new Set();
    for (const p of paths) for (const hop of p.hops) {
      litN.add(hop.from);
      litN.add(hop.to);
      const i = sim.links.findIndex((l) => l.id === hop.edge.id);
      if (i >= 0) litE.add(i);
    }
    showPanel(
      `<div class="gp-eyebrow"><span class="lk">Connection</span></div>
       <h3 class="gp-title">${esc(a.label)} <span>↔</span> ${esc(b.label)}</h3>
       ${paths.length
         ? paths.map((p, i) => `<section class="gp-path"><h4>Path ${i + 1} · ${p.hops.length} hop${p.hops.length > 1 ? 's' : ''} · ${p.inferred ? `includes inferred links · ${pct(p.confidence)}` : 'all links stated by sources'}</h4>
             <ol>${p.hops.map((hop) => `<li><span class="lk-dot ${hop.edge.kind}"></span><span>${esc(nodeName(hop.from))} <em>${esc(hop.edge.label)}${hop.edge.kind === 'inferred' ? ` ${pct(hop.edge.confidence)}` : ''}</em> ${esc(nodeName(hop.to))}</span><button type="button" data-edge="${esc(hop.edge.id)}" aria-label="Why">why</button></li>`).join('')}</ol></section>`).join('')
         : '<p class="gp-note">No path of up to five links connects them in the current evidence. Try lowering the minimum confidence or investigating a node in between.</p>'}
       <p class="gp-note">A path through stated links shows how sources connect them. A path that needs inferred links is a hypothesis; its confidence is the product of its links.</p>`,
      { nodes: litN, edges: litE },
    );
  };
  panel.addEventListener('click', (ev) => {
    if (ev.target.closest('.gp-close')) return closePanel();
    const f = ev.target.closest('[data-follow]');
    if (f) {
      const n = byId.get(f.dataset.follow) || model.nodes.find((x) => x.id === f.dataset.follow);
      if (n) {
        f.disabled = true;
        f.textContent = 'Running…';
        opts.onFollow?.(n);
      }
      return;
    }
    const evb = ev.target.closest('[data-ev]');
    if (evb) return opts.onEvidence?.({ url: evb.dataset.ev, source: evb.dataset.src });
    const b = ev.target.closest('[data-edge]');
    if (b) {
      const e = model.allEdges.find((x) => x.id === b.dataset.edge) || edges.find((x) => x.id === b.dataset.edge);
      if (e) showEdge(e);
    }
  });
  container.querySelector('[data-act="dupes"]')?.addEventListener('click', () => {
    showPanel(
      `<div class="gp-eyebrow"><span class="lk">Possible duplicates</span></div>
       <h3 class="gp-title">Similar entities, not merged</h3>
       <p class="gp-note">Merged automatically: identical names after removing legal forms, or a shared LEI (weight ${pct(WEIGHTS.lei)}). These pairs are only similar, so they stay separate until you confirm them.</p>
       <ul class="gp-conn">${model.candidates.map((c) => `<li><button type="button" data-pair="${esc(c.a)}|${esc(c.b)}"><span>${esc(nodeName(c.a))} <b>≈ ${esc(nodeName(c.b))}</b></span><em>${pct(c.score)}</em></button></li>`).join('')}</ul>`,
      { nodes: new Set(model.candidates.flatMap((c) => [c.a, c.b])), edges: new Set() },
    );
    panel.querySelectorAll('[data-pair]').forEach((b) =>
      b.addEventListener('click', () => {
        const [x, y] = b.dataset.pair.split('|');
        if (byId.get(x) && byId.get(y)) showPath(byId.get(x), byId.get(y));
      }),
    );
  });

  /* ---------- Pointer: drag nodes, pan, click to select ---------- */
  let drag = null;
  let selected = mem.sel?.node ? byId.get(mem.sel.node) : null;
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const g = ev.target.closest('.node');
    const p = toSvg(ev);
    if (g) {
      const n = byId.get(g.dataset.id);
      const wp = toWorld(p);
      drag = { node: n, el: g, dx: n.x - wp.x, dy: n.y - wp.y, sx: p.x, sy: p.y, moved: false, shift: ev.shiftKey };
      n.fx = n.x;
      n.fy = n.y;
      g.classList.add('grabbed');
    } else {
      drag = { pan: true, edgeEl: ev.target.closest('.edge'), sx: p.x, sy: p.y, cx: cam.x, cy: cam.y, moved: false };
    }
    svg.classList.add('dragging');
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const p = toSvg(ev);
    if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) < 3) return;
    drag.moved = true;
    if (drag.pan) {
      follow = false;
      cam.x = drag.cx + (p.x - drag.sx);
      cam.y = drag.cy + (p.y - drag.sy);
      return applyCam();
    }
    follow = false;
    const wp = toWorld(p);
    drag.node.fx = wp.x + drag.dx;
    drag.node.fy = wp.y + drag.dy;
    sim.alphaTarget = 0.3;
    wake(0.3);
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.node) {
      const n = drag.node;
      if (!drag.moved) {
        if (drag.shift && selected && selected !== n) showPath(selected, n);
        else {
          selected = n;
          showNode(n);
        }
      }
      n.fx = n.fy = null;
      drag.el.classList.remove('grabbed');
      sim.alphaTarget = 0;
      if (drag.moved) wake(0.35);
      unfocus();
    } else if (!drag.moved) {
      if (drag.edgeEl) showEdge(sim.links[+drag.edgeEl.dataset.i]);
      else if (!panel.hidden) closePanel();
    }
    svg.classList.remove('dragging');
    drag = null;
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('dblclick', (ev) => {
    const g = ev.target.closest('.node');
    if (!g) return;
    const n = byId.get(g.dataset.id);
    if (n.type === 'source') opts.onSource?.(n);
    else if (INVESTIGABLE.has(n.type)) opts.onOpen?.(n);
  });
  svg.addEventListener('keydown', (ev) => {
    const g = ev.target.closest('.node');
    if (g && ev.key === 'Enter') {
      const n = byId.get(g.dataset.id);
      if (ev.shiftKey && selected && selected !== n) showPath(selected, n);
      else {
        selected = n;
        showNode(n);
      }
    }
  });
  svg.addEventListener('focusin', (ev) => {
    const g = ev.target.closest('.node');
    if (g) focus(g.dataset.id);
  });
  svg.addEventListener('focusout', unfocus);
  svg.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      follow = false;
      const p = toSvg(ev);
      const next = Math.min(3, Math.max(0.25, cam.s * Math.exp(-ev.deltaY * 0.0015)));
      cam.x = p.x - ((p.x - cam.x) * next) / cam.s;
      cam.y = p.y - ((p.y - cam.y) * next) / cam.s;
      cam.s = next;
      applyCam();
    },
    { passive: false },
  );
  container.querySelector('[data-act="fit"]').addEventListener('click', () => {
    follow = true;
    mem.cam = null;
    if (reduceMotion()) {
      cam = fitTarget();
      applyCam();
    } else wake(0.05);
  });

  // Keep the selection across re-renders (new findings arriving, filter changes).
  if (mem.sel?.node && byId.get(mem.sel.node)) showNode(byId.get(mem.sel.node));
  else if (mem.sel?.edge) {
    const e = edges.find((x) => x.id === mem.sel.edge);
    if (e) showEdge(e);
  } else if (mem.sel?.path && byId.get(mem.sel.path[0]) && byId.get(mem.sel.path[1])) showPath(byId.get(mem.sel.path[0]), byId.get(mem.sel.path[1]));
}
