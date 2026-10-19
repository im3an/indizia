// Filtering findings with the query language (query.js): words, "phrases", -exclusions, OR, and the fields
//   source:  conf: (or confidence:)  grade:  type:  entity:  after:  before:
// Pure: works on finding objects, no DOM.

import { parse, matchText, inRange, fieldOk } from './query.js';
import { CONFIDENCE_LABEL } from './report.js';

export { parse };

/** Everything a finding says, as one searchable string. */
export function findingText(f) {
  return [f.title, f.detail, f.confidenceNote, f.listLabel, ...(f.list || []), f.entity?.value, f.source?.name, f.via].filter(Boolean).join('\n');
}

/** @param {object} f finding  @param {ReturnType<typeof parse>} p */
export function findingMatches(f, p) {
  if (p.empty) return true;
  if (!fieldOk(p, 'source', [f.source?.name, f.source?.id, f.source?.provider])) return false;
  if (!fieldOk(p, 'conf', [f.confidence, CONFIDENCE_LABEL[f.confidence]])) return false;
  if (!fieldOk(p, 'confidence', [f.confidence, CONFIDENCE_LABEL[f.confidence]])) return false;
  if (p.filters.grade || p.filters['-grade']) {
    // grade:ab → A or B; -grade:d → not D
    const g = String(f.source?.reliability || 'F').toLowerCase();
    if (p.filters.grade && !p.filters.grade.some((w) => w.includes(g))) return false;
    if (p.filters['-grade'] && p.filters['-grade'].some((w) => w.includes(g))) return false;
  }
  if (!fieldOk(p, 'type', [f.entity?.type])) return false;
  if (!fieldOk(p, 'entity', [f.entity?.value])) return false;
  if ((p.after || p.before) && !inRange(p, f.date || (f.events || [])[0]?.date || null)) return false;
  return matchText(p, findingText(f));
}
