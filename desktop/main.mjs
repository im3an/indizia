// Indizia desktop: the web app in its own window, served over a private sherlock:// protocol (no TCP port),
// with the shared API in-process, the Docker toolbox, and an optional isolated engine container.
import { app, BrowserWindow, Menu, Notification, Tray, nativeImage, globalShortcut, protocol, session, shell, dialog } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Engine } from './engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Packaged: public/, server/ and docker/ sit in Resources. In development: the repository root.
const RESOURCES = app.isPackaged ? process.resourcesPath : join(HERE, '..');
// The scheme keeps the pre-rename id: it is the storage origin, so changing it would orphan saved cases.
const ORIGIN = 'sherlock://app';
const SHORTCUT = 'Alt+Shift+S';

protocol.registerSchemesAsPrivileged([
  { scheme: 'sherlock', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();
app.setName('Indizia');
// Renamed from SherLock on 2026-10-19: keep using the old profile folder when it exists, so saved cases survive.
const LEGACY_PROFILE = join(app.getPath('appData'), 'SherLock');
if (existsSync(LEGACY_PROFILE)) app.setPath('userData', LEGACY_PROFILE);

/* ---------- Preferences (a small JSON file in the user data folder) ---------- */
const PREFS_FILE = () => join(app.getPath('userData'), 'desktop-prefs.json');
function readPrefs() {
  try {
    return JSON.parse(readFileSync(PREFS_FILE(), 'utf8'));
  } catch {
    return {};
  }
}
function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  try {
    mkdirSync(dirname(PREFS_FILE()), { recursive: true });
    writeFileSync(PREFS_FILE(), JSON.stringify(next, null, 2));
  } catch {
    /* read-only profile: preferences last for this session */
  }
  return next;
}

let win = null;
let engine = null;
let quitting = false;
let watcher = null; // hidden window that runs scheduled watches while the main window is closed
let tray = null;
const notices = []; // notifications shown this session (kept referenced so they stay clickable; read by the smoke check)

function isOwn(url) {
  return typeof url === 'string' && (url === ORIGIN || url.startsWith(`${ORIGIN}/`));
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') shell.openExternal(u.href);
  } catch {
    /* not a URL */
  }
}

function createWindow() {
  const prefs = readPrefs();
  const b = prefs.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1320,
    height: b.height || 860,
    x: b.x,
    y: b.y,
    minWidth: 380,
    minHeight: 520,
    title: 'Indizia',
    backgroundColor: '#0D1012',
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  if (prefs.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  const wc = win.webContents;
  // Only Indizia's own pages load in the window; every other link opens in the default browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (isOwn(url)) wc.loadURL(url);
    else openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (ev, url) => {
    if (!isOwn(url)) {
      ev.preventDefault();
      openExternal(url);
    }
  });
  wc.on('will-attach-webview', (ev) => ev.preventDefault());

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    writePrefs({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
  };
  win.on('close', saveBounds);
  win.on('closed', () => {
    win = null;
    startWatcher();
  });
  stopWatcher();
  wc.loadURL(`${ORIGIN}/`);
}

/* ---------- Scheduled watches in the background ---------- */
// While the main window is open its page runs the watch scheduler. When it closes and searches are watched,
// a hidden window on the same origin (same cases in IndexedDB) takes over until the window opens again.
function startWatcher() {
  if (quitting || watcher || win || !(readPrefs().watchCount > 0)) return;
  watcher = new BrowserWindow({
    show: false,
    title: 'Indizia watches',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, devTools: !app.isPackaged },
  });
  const wc = watcher.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (ev) => ev.preventDefault());
  watcher.on('closed', () => {
    watcher = null;
    updateTray();
  });
  wc.loadURL(`${ORIGIN}/watcher.html`);
  updateTray();
}

function stopWatcher() {
  if (watcher && !watcher.isDestroyed()) watcher.destroy();
  watcher = null;
  updateTray();
}

/** Windows and Linux quit when the last window closes; while watches run in the background, a tray icon says so and offers Quit. */
function updateTray() {
  if (process.platform === 'darwin') return; // the Dock icon stays, and Cmd+Q quits
  if (!watcher) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(join(HERE, 'build', 'icon.png')).resize({ width: 16, height: 16 }));
    tray.on('click', () => show());
  }
  const n = readPrefs().watchCount || 0;
  tray.setToolTip(`Indizia is watching ${n} search${n === 1 ? '' : 'es'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Watching ${n} search${n === 1 ? '' : 'es'}`, enabled: false },
    { label: 'Open Indizia', click: () => show() },
    { type: 'separator' },
    { label: 'Quit Indizia', click: () => app.quit() },
  ]));
}

function notify({ title, body, caseId }) {
  const entry = { at: new Date().toISOString(), title: String(title || 'Indizia').slice(0, 200), body: String(body || '').slice(0, 400), caseId: typeof caseId === 'string' ? caseId : null, shown: false };
  if (Notification.isSupported()) {
    const n = new Notification({ title: entry.title, body: entry.body, silent: false });
    n.on('click', () => show(entry.caseId ? `/?case=${encodeURIComponent(entry.caseId)}&tab=searches` : '/'));
    n.show();
    entry.shown = true;
    entry.ref = n;
  }
  notices.push(entry);
  if (notices.length > 50) notices.shift();
}

/** Small API only the app's own pages reach (sherlock:// is not a network origin). */
async function desktopApi(request, path) {
  const body = await request.json().catch(() => ({}));
  if (path === 'watches') {
    const count = Math.max(0, Math.min(10_000, Number(body.count) || 0));
    if (count !== readPrefs().watchCount) writePrefs({ watchCount: count });
    if (count === 0 && watcher) stopWatcher();
    else updateTray();
  } else if (path === 'notify') notify(body);
  else return new Response('Not found', { status: 404 });
  return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
}

function show(path) {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (path) win.webContents.loadURL(`${ORIGIN}${path}`);
}

/** Run a small action inside the page (the same buttons a user would click). */
function page(js) {
  show();
  win.webContents.executeJavaScript(js).catch(() => {});
}

function buildMenu() {
  const mac = process.platform === 'darwin';
  const template = [
    ...(mac ? [{ label: 'Indizia', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: () => page("document.getElementById('settings-btn')?.click()") }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Search', accelerator: 'CmdOrCtrl+N', click: () => { show('/'); page("setTimeout(() => document.getElementById('q')?.focus(), 150)"); } },
        { label: 'Analyse File…', accelerator: 'CmdOrCtrl+O', click: () => page("document.getElementById('attach-btn')?.click()") },
        { label: 'Cases', accelerator: 'CmdOrCtrl+Shift+C', click: () => page("document.getElementById('case-btn')?.click()") },
        { type: 'separator' },
        ...(mac ? [{ role: 'close' }] : [{ label: 'Settings', accelerator: 'Ctrl+,', click: () => page("document.getElementById('settings-btn')?.click()") }, { type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Engine',
      submenu: [
        { label: 'Built In', type: 'radio', checked: engine.preferred !== 'container', click: () => engine.setMode('builtin') },
        { label: 'Docker Container (Isolated)', type: 'radio', checked: engine.preferred === 'container', click: () => engine.setMode('container') },
        { type: 'separator' },
        { label: 'Clean Up Containers and Images…', click: cleanUp },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'About Indizia, Sources and Licences', click: () => show('/about.html') },
        { label: `Show Indizia from Anywhere (${SHORTCUT.replace('Alt', mac ? '⌥' : 'Alt').replace('Shift', mac ? '⇧' : 'Shift')})`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function cleanUp() {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Remove', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Remove Indizia’s Docker containers and images?',
    detail: 'Stops the engine container and deletes the toolbox images (subfinder, dnsx, httpx) and the engine image. Other Docker images are not touched. They are downloaded again when needed.',
  });
  if (response !== 0) return;
  const tb = await import(pathToFileURL(join(RESOURCES, 'server', 'toolbox.mjs')).href);
  const res = await tb.handleToolbox(new Request(`${ORIGIN}/api/toolbox/clean`, { method: 'POST', body: JSON.stringify({ images: true }) }), { trusted: true });
  const body = await res.json().catch(() => ({}));
  const wasContainer = engine.preferred === 'container';
  await engine.purge();
  if (wasContainer) engine.setMode('builtin');
  buildMenu();
  dialog.showMessageBox(win, { type: 'info', message: res.ok ? `Removed ${body.containers} container(s) and ${body.images?.length || 0} toolbox image(s).` : body.error || 'Docker is not running.' });
}

app.whenReady().then(async () => {
  const { createHandler } = await import(pathToFileURL(join(RESOURCES, 'server', 'app.mjs')).href);
  const prefs = readPrefs();
  engine = new Engine({ resources: RESOURCES, version: app.getVersion(), onPreference: (mode) => { writePrefs({ engine: mode }); buildMenu(); } });
  const handle = createHandler({
    root: join(RESOURCES, 'public'),
    local: true,
    toolbox: { trusted: true },
    ai: { trusted: true },
    engine,
    desktop: { version: app.getVersion(), platform: process.platform },
  });
  protocol.handle('sherlock', (request) => {
    const { pathname } = new URL(request.url);
    if (request.method === 'POST' && pathname.startsWith('/api/desktop/')) return desktopApi(request, pathname.slice('/api/desktop/'.length));
    return handle(request);
  });

  const ses = session.defaultSession;
  // No camera, microphone, location, web notifications or MIDI (watch alerts are native, sent from the main process). Clipboard writes are allowed for "copy citation".
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  ses.setPermissionCheckHandler((wc, permission) => permission === 'clipboard-sanitized-write');
  ses.on('will-download', (ev, item) => item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), item.getFilename()) }));

  buildMenu();
  createWindow();
  if (prefs.engine === 'container') engine.setMode('container');

  if (process.env.INDIZIA_SMOKE) smokeTest(process.env.INDIZIA_SMOKE, process.env.INDIZIA_SMOKE_PATH || '/');

  if (!globalShortcut.register(SHORTCUT, () => page("document.getElementById('q')?.focus()"))) console.warn(`Shortcut ${SHORTCUT} is taken by another app`);

  app.on('activate', () => show());
  app.on('second-instance', () => show());
});

/** Development check: load a page, wait for it to settle, save a screenshot and what the page reports, quit. */
function smokeTest(dir, path) {
  const wc = win.webContents;
  wc.once('did-finish-load', async () => {
    if (path !== '/') await wc.loadURL(`${ORIGIN}${path}`);
    await new Promise((r) => setTimeout(r, Number(process.env.INDIZIA_SMOKE_WAIT || 4000)));
    mkdirSync(dir, { recursive: true });
    const report = await wc.executeJavaScript(`(async () => ({
      url: location.href,
      title: document.title,
      desktopMark: document.documentElement.dataset.desktop || null,
      downloadButtonVisible: !!document.getElementById('desktop-dl')?.offsetParent,
      health: await (await fetch('/api/health')).json(),
      toolbox: await (await fetch('/api/toolbox')).json().catch(() => null),
      ledger: [...document.querySelectorAll('#ledger li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim()).slice(0, 60),
      findings: [...document.querySelectorAll('#findings > li')].map((li) => li.querySelector('h3, .f-title, strong')?.innerText || li.innerText.slice(0, 120)).slice(0, 40),
    }))()`);
    // Optional extra check, e.g. OCR or the AI bridge inside the packaged app.
    if (process.env.INDIZIA_SMOKE_JS) report.extra = await wc.executeJavaScript(`(async () => { ${process.env.INDIZIA_SMOKE_JS} })()`).catch((err) => ({ error: String(err) }));
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
    writeFileSync(join(dir, 'screen.png'), (await wc.capturePage()).toPNG());
    if (process.env.INDIZIA_SMOKE_WATCH) return smokeWatch(dir);
    app.quit();
  });
}

/** Watch check: close the main window, let the background watcher run due watches, record notifications, quit. */
async function smokeWatch(dir) {
  win.close();
  const limit = Date.now() + Number(process.env.INDIZIA_SMOKE_WATCH_WAIT || 180_000);
  while (Date.now() < limit && !notices.length) await new Promise((r) => setTimeout(r, 1000));
  const state = watcher ? await watcher.webContents.executeJavaScript('window.indiziaWatcher').catch(() => null) : null;
  writeFileSync(join(dir, 'watch.json'), JSON.stringify({ watcherRunning: !!watcher, mainWindowOpen: !!win, prefs: { watchCount: readPrefs().watchCount }, watcher: state, notifications: notices.map(({ ref, ...n }) => n) }, null, 2));
  app.quit();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Leave nothing running: stop the engine container and any toolbox run before the app exits.
app.on('before-quit', (ev) => {
  if (quitting || !engine) return;
  ev.preventDefault();
  quitting = true;
  globalShortcut.unregisterAll();
  const done = () => app.exit(0);
  const timer = setTimeout(done, 8000);
  Promise.allSettled([
    engine.stop(),
    import(pathToFileURL(join(RESOURCES, 'server', 'docker.mjs')).href).then((d) => d.removeLabelled(`${d.LABEL}.tool`)),
  ]).finally(() => {
    clearTimeout(timer);
    done();
  });
});

