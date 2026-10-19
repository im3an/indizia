// Watch scheduler: re-runs due watches while Indizia is open (and, in the desktop app, in a hidden
// background window while the main window is closed). One watch per tick, one tab at a time (Web Lock),
// sources that rate-limited sit out for a while, restricted lenses never run.

import { listCases } from './store.js';
import { runHeadless, recordWatchRun } from './actions.js';
import { dueWatches, countWatches, coolingDown, updateCooldowns, canWatch, TICK } from './watch.js';
import { detect } from '../detect.js';
import { toSnapshot } from '../snapshot.js';
import { SOURCES } from '../sources/index.js';

const COOL_KEY = 'sherlock.watch.cooldown';
const LOCK = 'indizia-watch';

function readCool() {
  try {
    return JSON.parse(localStorage.getItem(COOL_KEY) || '{}');
  } catch {
    return memoryCool;
  }
}
let memoryCool = {};
function writeCool(map) {
  memoryCool = map;
  try {
    localStorage.setItem(COOL_KEY, JSON.stringify(map));
  } catch {
    /* private mode: this tab only */
  }
}

/** Only one Indizia tab or window runs watches at a time. Without Web Locks, run anyway. */
function exclusive(fn) {
  if (!navigator.locks?.request) return fn();
  return navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => (lock ? fn() : null));
}

/** Re-run the most overdue watch, if any. Exported for the desktop smoke check. */
export async function checkOnce({ onResult, onCount, onStart } = {}) {
  return exclusive(async () => {
    const cases = await listCases();
    onCount?.(countWatches(cases));
    const next = dueWatches(cases).find((w) => canWatch(detect(w.query)?.type));
    if (!next) return null;
    const cool = coolingDown(readCool());
    onStart?.(next);
    const state = await runHeadless(detect(next.query), { sources: SOURCES.filter((s) => !cool.has(s.id)) });
    const snap = toSnapshot(state);
    writeCool(updateCooldowns(readCool(), snap.ledger));
    const res = await recordWatchRun(next.caseId, next.invId, snap);
    if (res) onResult?.({ ...res, watch: next });
    return res;
  });
}

/**
 * Start checking for due watches: first after `firstDelay`, then every TICK.
 * @param {{ onResult?(r):void, onCount?(n:number):void, onStart?(w):void, firstDelay?:number }} hooks
 * @returns {() => void} stop
 */
export function startWatchScheduler(hooks = {}) {
  let timer = null;
  let stopped = false;
  const tick = async () => {
    try {
      await checkOnce(hooks);
    } catch (err) {
      console.warn('Watch check failed', err);
    }
    if (!stopped) timer = setTimeout(tick, TICK);
  };
  timer = setTimeout(tick, hooks.firstDelay ?? 20_000);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** Desktop app only: native notification and background status, through the app's private protocol. */
export const isDesktop = () => !!document.documentElement.dataset.desktop || location.protocol === 'sherlock:';
export function desktopPost(path, body) {
  if (!isDesktop()) return Promise.resolve();
  return fetch(`/api/desktop/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
}
