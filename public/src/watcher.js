// Background watcher (desktop app): loaded in a hidden window while the main window is closed.
// Same origin as the app, so it reads and writes the same cases in IndexedDB.
import { startWatchScheduler, desktopPost } from './workspace/scheduler.js';

window.indiziaWatcher = { checks: 0, results: [] };
startWatchScheduler({
  firstDelay: 3000,
  onCount: (n) => desktopPost('watches', { count: n }),
  onStart: () => window.indiziaWatcher.checks++,
  onResult: (r) => {
    window.indiziaWatcher.results.push({ query: r.watch.query, changed: r.changed, summary: r.summary });
    if (r.changed) desktopPost('notify', { title: `${r.watch.query}: ${r.summary}`, body: `Watched search in “${r.watch.caseName}”. Open the case to see what changed.`, caseId: r.watch.caseId });
  },
});
