process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
const { app, BrowserWindow, ipcMain, shell, Notification, dialog, Menu, screen, safeStorage } = require('electron');

// Solid Fluent: opaque composited windows (design decision - no acrylic glass)
app.commandLine.appendSwitch('disable-gpu-sandbox');

const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { fork } = require('child_process');
const { autoUpdater } = require('electron-updater');
const crypto = require('crypto');

// Master key for engine-side at-rest encryption of persisted secrets
// (proxy/site credentials in settings.json). Sealed with safeStorage
// (DPAPI / OS keyring) under userData and handed to the engine process via
// NDM_SECRET_KEY. When OS encryption is unavailable the engine falls back
// to plaintext storage.
function getEngineSecretKey() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const keyPath = path.join(app.getPath('userData'), 'engine.key');
    if (fs.existsSync(keyPath)) {
      return safeStorage.decryptString(fs.readFileSync(keyPath));
    }
    const key = crypto.randomBytes(32).toString('base64');
    fs.writeFileSync(keyPath, safeStorage.encryptString(key));
    return key;
  } catch (err) {
    console.error('[NDM] Failed to provision engine secret key:', err);
    return null;
  }
}

const NDM_LOCAL_TOKEN = 'ndm_local_secret_token';

// 1. Single Instance Lock (Section 5)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[NDM] Another instance is already running. Focusing existing instance and quitting.');
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let engineProcess = null;
let isAppQuitting = false;
let engineLogFd = 'ignore';
let engineCrashCount = 0;
let lastEngineCrashAt = 0;
const childWindows = new Map(); // key -> BrowserWindow

// 2.5 System Tray & Minimize-to-Tray
// While any download is active the app keeps running in the tray when the
// window is minimized or closed; with nothing active the legacy behavior
// applies (minimize = taskbar, close = quit).
let tray = null;
let trayProgressState = { activeCount: 0, activeBytes: 0, totalBytes: 0 };
const activeDownloadIds = new Set();
// Downloads that have gone active at least once this session — used so the
// auto-opened status dialog pops exactly once per download, not on every
// pause→resume cycle or bulk retry.
const everActiveIds = new Set();
let lastTrayBalloonAt = 0;
// Latest snapshot of active downloads from the engine poll — used to build
// the right-click tray menu (per-download live entries) fresh on demand.
let lastActiveDownloads = [];

function trayTooltipText() {
  if (trayProgressState.activeCount === 0) return 'NDM — Nogadex Download Manager';
  const pct = trayProgressState.totalBytes > 0
    ? Math.min(100, Math.round((trayProgressState.activeBytes / trayProgressState.totalBytes) * 100))
    : 0;
  return `NDM — ${trayProgressState.activeCount} download${trayProgressState.activeCount === 1 ? '' : 's'} in progress (${pct}%)`;
}

function updateTray() {
  if (!tray) return;
  const hasActive = trayProgressState.activeCount > 0;
  tray.setToolTip(trayTooltipText());
  if (hasActive && trayProgressState.totalBytes > 0) {
    const pct = Math.min(1, trayProgressState.activeBytes / trayProgressState.totalBytes);
    tray.setProgressBar(pct);
  } else {
    tray.setProgressBar(-1); // remove progress overlay
  }
}

function showTrayBalloon(title, body) {
  if (!tray || !Notification.isSupported()) return;
  const now = Date.now();
  if (now - lastTrayBalloonAt < 1500) return; // rate-limit balloons
  lastTrayBalloonAt = now;
  try {
    tray.displayBalloon({
      iconType: 'info',
      title,
      content: body,
    });
  } catch {}
}

function createTray() {
  if (tray || process.platform !== 'win32') return;
  try {
    const { Tray } = require('electron');
    tray = new Tray(iconPath);
    tray.setToolTip('NDM — Nogadex Download Manager');
    // Left-click toggles the main window (show/restore or minimize).
    tray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        mainWindow.minimize();
      }
    });
    // Right-click opens the popup with per-download live entries.
    // Built on demand from the latest poll so every entry is current.
    tray.on('right-click', () => {
      if (!tray) return;
      tray.popUpContextMenu(buildTrayMenu());
    });
  } catch (err) {
    console.error('[NDM] Tray creation failed:', err);
    tray = null;
  }
}

function enginePost(pathName) {
  try {
    const req = http.request(
      { hostname: '127.0.0.1', port: 5005, path: pathName, method: 'POST', timeout: 3000, headers: { 'X-NDM-Token': NDM_LOCAL_TOKEN } },
      (res) => { res.resume(); }
    );
    req.on('error', () => {});
    req.end();
  } catch {}
}

function formatMenuFilename(name) {
  const n = name || 'File';
  return n.length > 42 ? n.slice(0, 39) + '…' : n;
}

function formatBytesShort(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  const kbps = bytesPerSec / 1024;
  return kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${Math.round(kbps)} KB/s`;
}

function buildTrayMenu() {
  const { Menu } = require('electron');
  const items = [];
  const active = lastActiveDownloads;

  if (active.length === 0) {
    items.push({ label: 'No active downloads', enabled: false });
  } else {
    items.push({
      label: `${active.length} download${active.length === 1 ? '' : 's'} in progress`,
      enabled: false,
    });
    items.push({ type: 'separator' });

    for (const d of active) {
      const pct = d.totalBytes > 0
        ? Math.min(100, Math.floor(((d.downloadedBytes || 0) / d.totalBytes) * 100))
        : 0;
      const speed = formatSpeed(d.speedBps);
      const sizeText = d.totalBytes > 0
        ? `${formatBytesShort(d.downloadedBytes)} / ${formatBytesShort(d.totalBytes)}`
        : formatBytesShort(d.downloadedBytes);
      const label = `${formatMenuFilename(d.filename)} — ${pct}%  (${sizeText}${speed ? `, ${speed}` : ''})`;

      items.push({
        label,
        click: () => {
          // Opening a specific download opens its status window.
          openChildWindow('download-status', { id: d.id });
        },
        submenu: [
          {
            label: 'Pause',
            enabled: d.status === 'downloading',
            click: () => enginePost(`/api/downloads/${d.id}/pause`),
          },
          { type: 'separator' },
          {
            label: 'Open containing folder',
            click: () => enginePost(`/api/downloads/${d.id}/open-folder`),
          },
        ],
      });
    }

    if (active.length > 1) {
      items.push({ type: 'separator' });
      items.push({
        label: 'Pause all downloads',
        click: () => {
          for (const d of active) enginePost(`/api/downloads/${d.id}/pause`);
        },
      });
    }
  }

  items.push({ type: 'separator' });
  items.push({
    label: 'Open NDM',
    click: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    },
  });
  items.push({ type: 'separator' });
  items.push({ label: 'Exit', click: () => { isAppQuitting = true; app.quit(); } });

  return Menu.buildFromTemplate(items);
}

// The main process polls the engine directly so tray state is authoritative
// and does not depend on any renderer staying alive.
async function pollEngineForTrayState() {
  // Runs even without a tray (non-Windows builds): the same poll also drives
  // taskbar progress and auto-opens the status dialog for new active downloads.
  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:5005/api/downloads', { timeout: 1500, headers: { 'X-NDM-Token': NDM_LOCAL_TOKEN } }, (r) => {
        let data = '';
        r.on('data', (c) => { data += c; });
        r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    const downloads = (res && res.downloads) || [];
    const ACTIVE = new Set(['downloading', 'probing', 'connecting']);
    const active = downloads.filter((d) => ACTIVE.has(d.status));
    const previousActive = new Set(activeDownloadIds);

    activeDownloadIds.clear();
    let sumBytes = 0;
    let sumTotal = 0;
    for (const d of active) {
      activeDownloadIds.add(d.id);
      sumBytes += d.downloadedBytes || 0;
      sumTotal += d.totalBytes || 0;
    }
    trayProgressState.activeCount = activeDownloadIds.size;
    trayProgressState.activeBytes = sumBytes;
    trayProgressState.totalBytes = sumTotal;
    lastActiveDownloads = active;

    // The first time a download goes active in this session —
    // no matter which entry point started it (browser-extension takeover,
    // ndm:// protocol handoff, batch download, retry, resume) — pop its
    // status dialog. openChildWindow re-focuses an existing window instead of
    // duplicating, so the Add-Download dialog path stays conflict-free, and
    // already-seen items (pause→resume, bulk retry) never re-pop.
    if (mainWindow && !mainWindow.isDestroyed()) {
      for (const d of active) {
        if (!everActiveIds.has(d.id)) {
          everActiveIds.add(d.id);
          openChildWindow('download-status', { id: d.id });
        }
      }
    }

    updateTray();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(trayProgressState.activeCount > 0 && trayProgressState.totalBytes > 0
        ? Math.min(1, trayProgressState.activeBytes / trayProgressState.totalBytes)
        : -1);
    }

    // Completion / failure balloons: for each id that disappeared from the
    // active set since the last poll, look up its final state.
    if (previousActive.size > 0) {
      for (const id of previousActive) {
        if (activeDownloadIds.has(id)) continue;
        const finished = downloads.find((d) => d.id === id);
        if (!finished) continue;
        if (finished.status === 'completed') {
          const winFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
          if (!winFocused) showTrayBalloon('Download complete', `${finished.filename || 'File'} finished downloading.`);
        } else if (finished.status === 'error') {
          const winFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
          if (!winFocused) showTrayBalloon('Download failed', `${finished.filename || 'File'} — ${finished.error || 'error'}`);
        }
      }
    }
  } catch {}
}

let trayPollTimer = null;
function startTrayPolling() {
  // Also started on non-Windows: it drives taskbar progress and the
  // auto-open status dialog, which work without a tray.
  if (trayPollTimer) return;
  trayPollTimer = setInterval(pollEngineForTrayState, 1000);
  pollEngineForTrayState();
}

// ---------------------------------------------------------------------------
// Event sounds: poll the engine's sound-event feed
// and play the configured file (or the OS chime when no file is set) for
// download complete/failed and queue started/stopped. Runs in the MAIN
// process so sounds fire even when no renderer window is open.
// ---------------------------------------------------------------------------
let lastSoundEventAt = Date.now() - 5000; // replay window on startup
let soundEventTimer = null;
let soundSettingsCache = null;

function playEventSound(event, fileOverride) {
  try {
    // Preview (Settings → Sounds → Test) bypasses the enabled/mute check and
    // plays exactly the file currently typed in the dialog ('' = system chime).
    const cfg = fileOverride !== undefined
      ? { enabled: true, file: String(fileOverride || '') }
      : soundSettingsCache && soundSettingsCache[event];
    if (!cfg || !cfg.enabled) return;
    if (cfg.file && cfg.file.length > 0) {
      // Windows Media Player via wscript is fragile; use the built-in media
      // player through an invisible window only when a file is configured.
      const win = new BrowserWindow({
        width: 0,
        height: 0,
        show: false,
        skipTaskbar: true,
        webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      const fileUrl = 'file:///' + String(cfg.file).replace(/\\/g, '/').split('?')[0].split('#')[0].split('/').map(encodeURIComponent).join('/');
      win.loadURL('data:text/html,' + encodeURIComponent(
        `<audio src="${fileUrl}" autoplay onerror="window.close()" onended="window.close()"></audio>`
      ));
      setTimeout(() => { try { win.destroy(); } catch {} }, 15000);
    } else {
      // Built-in: OS attention chime.
      require('electron').shell.beep();
    }
  } catch { /* never let sound break the app */ }
}

async function pollSoundEvents() {
  try {
    const res = await new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:5005/api/sound-events?since=${lastSoundEventAt}`, { timeout: 1500, headers: { 'X-NDM-Token': NDM_LOCAL_TOKEN } }, (r) => {
        let data = '';
        r.on('data', (c) => { data += c; });
        r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    if (Array.isArray(res)) {
      for (const evt of res) {
        if (evt.at > lastSoundEventAt) lastSoundEventAt = evt.at;
        playEventSound(evt.event, evt.preview ? (evt.previewFile || '') : undefined);
      }
    }
  } catch { /* engine may be down; retry next tick */ }
}

async function refreshSoundSettings() {
  try {
    const res = await new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:5005/api/sounds', { timeout: 1500, headers: { 'X-NDM-Token': NDM_LOCAL_TOKEN } }, (r) => {
        let data = '';
        r.on('data', (c) => { data += c; });
        r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    if (res) soundSettingsCache = res;
  } catch { /* retry next cycle */ }
}

function startSoundEvents() {
  if (soundEventTimer) return;
  refreshSoundSettings();
  soundEventTimer = setInterval(() => {
    pollSoundEvents();
    // Settings refresh every ~15 polls (~30s) to pick up changes.
    if (Date.now() % 30000 < 2000) refreshSoundSettings();
  }, 2000);
}

function stopSoundEvents() {
  if (soundEventTimer) { clearInterval(soundEventTimer); soundEventTimer = null; }
}

function stopTrayPolling() {
  if (trayPollTimer) { clearInterval(trayPollTimer); trayPollTimer = null; }
}

ipcMain.handle('get-active-download-count', () => activeDownloadIds.size);

// Register Custom URL Protocol (Section 35)
app.setAsDefaultProtocolClient('ndm');

function handleIncomingUrl(rawArg) {
  let targetUrl = rawArg;
  if (rawArg.startsWith('ndm://')) {
    try {
      const parsed = new URL(rawArg);
      const qUrl = parsed.searchParams.get('url');
      if (qUrl) targetUrl = qUrl;
    } catch {}
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('open-new-download', { url: targetUrl });
  }
}

app.on('second-instance', (event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();

    const targetUrl = commandLine.find((arg) =>
      arg.startsWith('http://') ||
      arg.startsWith('https://') ||
      arg.startsWith('ndm://')
    );
    if (targetUrl) {
      handleIncomingUrl(targetUrl);
    }
  }
});

// 2. Production Server Lifecycle (Section 3 & 4)
function checkPortInUse(port, checkPath = '/') {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}${checkPath}`, () => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(400, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startEngine() {
  // Dev mode: a leftover backend from a previous session would serve stale
  // code — evict it before deciding anything. Packaged builds skip this and
  // happily reuse a healthy running backend.
  await evictStaleBackend();

  const isRunning = await checkPortInUse(5005, '/api/diagnostics');
  if (isRunning) {
    console.log('[NDM Engine] Backend is already running on port 5005.');
    return;
  }

  const engineSecretKey = getEngineSecretKey();
  if (engineSecretKey) {
    console.log('[NDM Engine] Credential at-rest encryption enabled.');
  } else {
    console.warn('[NDM Engine] OS secret encryption unavailable — credentials will be stored in plaintext.');
  }

  const prodServerPath = path.join(__dirname, '..', 'dist-server', 'server.cjs');
  const devServerPath = path.join(__dirname, '..', 'server', 'server.ts');
  const tsxPath = path.join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

  // Production/packaged: use the bundled backend. Development: ALWAYS run the
  // TypeScript source so edits take effect on relaunch (a leftover dist-server
  // bundle must never shadow source changes). Set NDM_FORCE_BUNDLED=1 to test
  // the bundle from a dev checkout.
  if (app.isPackaged || process.env.NDM_FORCE_BUNDLED === '1') {
    console.log('[NDM Engine] Launching standalone bundled backend:', prodServerPath);
    // Windowed apps on Windows have no console handles — stdio:'inherit'
    // makes fork() fail silently and the crash-recovery loop spins forever.
    // Route backend stdout/stderr to a log file we can actually read.
    try {
      const logDir = path.join(os.homedir(), '.ndm');
      fs.mkdirSync(logDir, { recursive: true });
      engineLogFd = fs.openSync(path.join(logDir, 'backend.log'), 'a');
    } catch {
      engineLogFd = 'ignore';
    }
    try {
      engineProcess = fork(prodServerPath, [], {
        // fork() REQUIRES an IPC channel as one of the stdio entries (verified
        // empirically: ERR_CHILD_PROCESS_IPC_REQUIRED without it). Numeric fds
        // DO survive fork on Windows — the child's stdout/stderr land in
        // backend.log, which is how we diagnose it from a windowed app.
        stdio: ['ignore', engineLogFd, engineLogFd, 'ipc'],
        execPath: process.execPath,
        env: { ...process.env, PORT: '5005', ELECTRON_RUN_AS_NODE: '1', NDM_SECRET_KEY: engineSecretKey || undefined },
      });
    } catch (err) {
      console.error('[NDM Engine] Fork failed:', err);
      return;
    }
  } else {
    console.log('[NDM Engine] Launching development backend via tsx:', devServerPath);
    engineProcess = fork(tsxPath, [devServerPath], {
      stdio: 'inherit',
      env: { ...process.env, PORT: '5005', NDM_SECRET_KEY: engineSecretKey || undefined },
    });
  }

  engineProcess.on('error', (err) => {
    console.error('[NDM Engine] Process error:', err);
  });

  engineProcess.on('exit', (code, signal) => {
    console.log(`[NDM Engine] Process terminated with code ${code}, signal ${signal}`);
    engineProcess = null;
    if (typeof engineLogFd === 'number') {
      try { fs.closeSync(engineLogFd); } catch (e) {}
      engineLogFd = 'ignore';
    }
    // Crash recovery: restart backend if app is running and not shutting down.
    // Bounded: if the backend keeps dying immediately, stop after 5 attempts
    // so we don't spin forever (each attempt is logged to backend.log).
    if (mainWindow && !mainWindow.isDestroyed() && !isAppQuitting) {
      const now = Date.now();
      if (now - lastEngineCrashAt > 30000) engineCrashCount = 0;
      lastEngineCrashAt = now;
      engineCrashCount++;
      if (engineCrashCount > 5) {
        console.error('[NDM Engine] Crash loop detected (5 fast exits) — giving up. See ~/.ndm/backend.log');
        return;
      }
      console.log(`[NDM Engine] Crash recovery scheduled in 1500ms (attempt ${engineCrashCount}/5)...`);
      setTimeout(() => {
        if (!isAppQuitting) startEngine();
      }, 1500);
    }
  });
}

// Robust engine teardown: bare .kill() frequently fails to terminate the
// forked backend tree on Windows, leaving an orphaned server holding port
// 5005 (running stale code). taskkill /T /F takes down the whole tree.
function killEngine() {
  if (!engineProcess) return;
  const pid = engineProcess.pid;
  try {
    if (process.platform === 'win32' && pid) {
      require('child_process').execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      engineProcess.kill('SIGTERM');
    }
  } catch (e) {}
  engineProcess = null;
  if (typeof engineLogFd === 'number') {
    try { fs.closeSync(engineLogFd); } catch (e) {}
    engineLogFd = 'ignore';
  }
}

// Dev-mode guard: if a stale backend (from a previous crashed/killed session)
// occupies port 5005, evict it — dev must always run the current source.
// Packaged builds attach to a healthy existing backend instead.
async function evictStaleBackend() {
  if (app.isPackaged || process.env.NDM_FORCE_BUNDLED === '1') return;
  if (!(await checkPortInUse(5005, '/'))) return;
  console.log('[NDM Engine] Port 5005 occupied in dev mode — requesting graceful shutdown of stale backend...');
  try {
    await new Promise((resolve) => {
      const req = http.request('http://127.0.0.1:5005/api/shutdown', { method: 'POST', headers: { 'X-NDM-Token': NDM_LOCAL_TOKEN } }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => resolve());
      req.end();
    });
  } catch (e) {}
  // Wait for the port to free up
  for (let i = 0; i < 12 && (await checkPortInUse(5005, '/')); i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (await checkPortInUse(5005, '/')) {
    // Fallback: force-kill whatever holds the port
    try {
      const { execSync } = require('child_process');
      const out = execSync('netstat -ano | findstr :5005 | findstr LISTENING', { shell: 'cmd.exe' }).toString();
      const pids = [...new Set(out.split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop()).filter(Boolean))];
      for (const pid of pids) {
        try { execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
      }
      for (let i = 0; i < 8 && (await checkPortInUse(5005, '/')); i++) {
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (e) {}
  }
  console.log('[NDM Engine] Stale backend evicted. Starting current source.');
}

// 3. Application Base URL Resolution
async function resolveAppUrl() {
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    const viteRunning = await checkPortInUse(5173, '/');
    if (viteRunning) {
      return { type: 'url', target: 'http://localhost:5173' };
    }
  }

  // The local engine serves the dist directory statically on port 5005
  const backendRunning = await checkPortInUse(5005, '/api/diagnostics');
  if (backendRunning) {
    return { type: 'url', target: 'http://127.0.0.1:5005' };
  }

  const distPath = path.join(__dirname, '..', 'dist', 'index.html');
  return { type: 'file', target: distPath };
}

const iconPath = process.platform === 'win32'
  ? path.join(__dirname, '..', 'public', 'icon.ico')
  : path.join(__dirname, '..', 'public', 'logo.png');

// 3.5 Native context menu — right-click must never show the raw Chromium menu.
// Text fields get edit actions; selections get Copy; everything else: nothing.
function buildContextMenu(props) {
  const items = [];
  const hasSelection = Boolean(props.selectionText && props.selectionText.trim().length > 0);
  const flags = props.editFlags || {};

  if (props.isEditable) {
    items.push(
      { role: 'undo', enabled: Boolean(flags.canUndo) },
      { role: 'redo', enabled: Boolean(flags.canRedo) },
      { type: 'separator' },
      { role: 'cut', enabled: Boolean(flags.canCut) },
      { role: 'copy', enabled: Boolean(flags.canCopy) },
      { role: 'paste', enabled: Boolean(flags.canPaste) },
      { type: 'separator' },
      { role: 'selectAll', enabled: Boolean(flags.canSelectAll) }
    );
  } else if (hasSelection) {
    items.push({ role: 'copy', label: 'Copy' });
  }
  return items.length > 0 ? Menu.buildFromTemplate(items) : null;
}

function attachContextMenuHandler(win) {
  win.webContents.on('context-menu', (event, props) => {
    event.preventDefault();
    const menu = buildContextMenu(props);
    if (menu) menu.popup({ window: win });
  });
}

// 4. Main Window Creation
async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 850,
    minHeight: 550,
    frame: false,
    icon: iconPath,
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  const appTarget = await resolveAppUrl();
  console.log('[Electron] Loading application target:', appTarget);

  if (appTarget.type === 'url') {
    mainWindow.loadURL(appTarget.target);
  } else {
    mainWindow.loadFile(appTarget.target);
  }

  // Fallback and diagnostics logging
  attachContextMenuHandler(mainWindow);

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Electron] Failed to load:', errorCode, errorDescription, validatedURL);
    const distPath = path.join(__dirname, '..', 'dist', 'index.html');
    if (fs.existsSync(distPath)) {
      console.log('[Electron] Falling back to local loadFile:', distPath);
      mainWindow.loadFile(distPath);
    }
  });

  // Restrict child popups and navigation to trusted local origin
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (
      !targetUrl.startsWith('http://localhost:5173') &&
      !targetUrl.startsWith('http://127.0.0.1:5005') &&
      !targetUrl.startsWith('file://')
    ) {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    for (const win of childWindows.values()) {
      if (win && !win.isDestroyed()) win.close();
    }
    childWindows.clear();
  });
}

// 5. Window Configurations for Native OS Windows (Fixed Size, Generous Dimensions)
const WINDOW_SPECS = {
  'settings': { width: 700, height: 660, minHeight: 320, resizable: false, modal: true },
  'new-download': { width: 580, height: 460, minHeight: 300, resizable: false, modal: true },
  // Tiny step-1 dialog: stays above the browser while the user
  // copies a link into it (clipboard auto-grab), so it must be non-modal and
  // always-on-top.
  'address-input': { width: 560, height: 193, minHeight: 140, resizable: false, modal: false, alwaysOnTop: true },
  'batch': { width: 660, height: 540, minHeight: 320, resizable: false, modal: true },
  'site-grabber': { width: 780, height: 660, minHeight: 360, resizable: false, modal: true },
  'scheduler': { width: 720, height: 600, minHeight: 360, resizable: false, modal: true },
  'history': { width: 560, height: 500, minHeight: 280, resizable: false, modal: true },
  'diagnostics': { width: 680, height: 560, minHeight: 280, resizable: false, modal: true },
  'about': { width: 500, height: 440, minHeight: 300, resizable: false, modal: true },
  'properties': { width: 620, height: 540, minHeight: 320, resizable: false, modal: true },
  'download-status': { width: 640, height: 560, minHeight: 240, resizable: false, modal: false },
  'refresh-url': { width: 520, height: 260, minHeight: 220, resizable: false, modal: true },
  'advanced-settings': { width: 520, height: 380, minHeight: 260, resizable: false, modal: true },
  'help-center': { width: 880, height: 660, resizable: false, modal: true },
};

async function openChildWindow(windowType, queryParams = {}) {
  const spec = WINDOW_SPECS[windowType] || { width: 560, height: 460, resizable: false, modal: true };
  const queryStr = new URLSearchParams(queryParams).toString();
  const windowKey = queryParams.id ? `${windowType}:${queryParams.id}` : windowType;

  if (childWindows.has(windowKey)) {
    const existing = childWindows.get(windowKey);
    if (existing && !existing.isDestroyed()) {
      // Re-point the window at the new params (e.g. "Get help" opening a
      // specific guide while Help Center is already open), then focus it.
      const routeHash = `/window/${windowType}${queryStr ? '?' + queryStr : ''}`;
      const currentUrl = existing.webContents.getURL();
      if (!currentUrl.endsWith('#' + routeHash)) {
        existing.webContents.executeJavaScript(
          `window.location.hash = ${JSON.stringify('#' + routeHash)};`
        );
      }
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return;
    }
  }

  const isModal = Boolean(spec.modal && mainWindow && !mainWindow.isDestroyed());

  const win = new BrowserWindow({
    width: spec.width,
    height: spec.height,
    minWidth: spec.minWidth || spec.width,
    minHeight: spec.minHeight || spec.height,
    useContentSize: true,
    resizable: spec.resizable,
    frame: false,
    icon: iconPath,
    parent: isModal ? mainWindow : null,
    modal: isModal,
    show: false,
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Tiny helper dialogs (address-input) float above every window — including
  // the browser the user is copying a link from.
  if (spec.alwaysOnTop) {
    win.setAlwaysOnTop(true, 'floating');
  }

  attachContextMenuHandler(win);

  const appTarget = await resolveAppUrl();
  const routeHash = `/window/${windowType}${queryStr ? '?' + queryStr : ''}`;
  if (appTarget.type === 'url') {
    win.loadURL(`${appTarget.target}#${routeHash}`);
  } else {
    win.loadFile(appTarget.target, { hash: routeHash });
  }

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    const distPath = path.join(__dirname, '..', 'dist', 'index.html');
    if (fs.existsSync(distPath)) {
      win.loadFile(distPath, { hash: routeHash });
    }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    childWindows.delete(windowKey);
  });

  childWindows.set(windowKey, win);
}

// 6. Auto-Update Subsystem (Section 9 - 19)
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;

let updateState = {
  status: 'idle', // 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  channel: 'latest',
  updateInfo: null,
  progress: null,
  error: null,
};

// Update Policy (Settings → Updates tab), persisted per-machine in userData
const updaterPolicyPath = () => path.join(app.getPath('userData'), 'updater-policy.json');
let updatePolicy = { checkAutomatically: true, notifyWhenReady: true, installAutomatically: false };

function loadUpdatePolicy() {
  try {
    Object.assign(updatePolicy, JSON.parse(fs.readFileSync(updaterPolicyPath(), 'utf8')));
  } catch {}
}

function saveUpdatePolicy() {
  try {
    const p = updaterPolicyPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(updatePolicy, null, 2), 'utf8');
  } catch {}
}

function applyUpdatePolicy() {
  // "Install automatically" = fully silent: download without asking, then
  // install on quit. Otherwise downloads are user-prompted, but any update
  // the user explicitly downloaded still installs on restart (default).
  autoUpdater.autoDownload = updatePolicy.installAutomatically;
  autoUpdater.autoInstallOnAppQuit = true;
}

function broadcastUpdateState() {
  const payload = { ...updateState, policy: { ...updatePolicy } };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-state-changed', payload);
  }
  for (const win of childWindows.values()) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater-state-changed', payload);
    }
  }
}

function setupAutoUpdater() {
  loadUpdatePolicy();
  applyUpdatePolicy();
  autoUpdater.on('checking-for-update', () => {
    updateState.status = 'checking';
    updateState.error = null;
    broadcastUpdateState();
  });

  autoUpdater.on('update-available', (info) => {
    updateState.status = 'available';
    updateState.updateInfo = info;
    broadcastUpdateState();
    if (Notification.isSupported()) {
      new Notification({
        title: 'NDM Update Available',
        body: `Version ${info.version} is available.`,
      }).show();
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    updateState.status = 'not-available';
    updateState.updateInfo = info;
    broadcastUpdateState();
  });

  autoUpdater.on('download-progress', (progressObj) => {
    updateState.status = 'downloading';
    updateState.progress = progressObj;
    broadcastUpdateState();
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateState.status = 'downloaded';
    updateState.updateInfo = info;
    broadcastUpdateState();
    if (updatePolicy.notifyWhenReady && Notification.isSupported()) {
      new Notification({
        title: 'NDM Update Ready',
        body: `Version ${info.version} is downloaded and will install on restart.`,
      }).show();
    }
  });

  autoUpdater.on('error', (err) => {
    updateState.status = 'error';
    updateState.error = err ? err.message || String(err) : 'Unknown update error';
    broadcastUpdateState();
  });

  // Check on startup with reasonable delay (Section 10), gated by policy
  setTimeout(() => {
    if (app.isPackaged && updatePolicy.checkAutomatically) {
      autoUpdater.checkForUpdates().catch(() => {});
    }
  }, 6000);
}

// 7. IPC Handlers
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  // With active downloads, minimize hides the window and the tray
  // icon keeps the session alive & visible.
  if (activeDownloadIds.size > 0 && tray && win === mainWindow) {
    win.hide();
    showTrayBalloon('NDM is still downloading', `${activeDownloadIds.size} download${activeDownloadIds.size === 1 ? '' : 's'} in progress. Click the tray icon to restore.`);
  } else {
    win.minimize();
  }
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  // With active downloads, close = minimize to tray (downloads keep running).
  if (activeDownloadIds.size > 0 && tray && win === mainWindow) {
    win.hide();
    showTrayBalloon('NDM is still downloading', `${activeDownloadIds.size} download${activeDownloadIds.size === 1 ? '' : 's'} in progress. Use the tray icon to exit.`);
    return;
  }
  win.close();
});

ipcMain.on('window-resize-step', (event, { deltaX, deltaY }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isMaximized()) {
    const [w, h] = win.getSize();
    win.setSize(Math.max(450, Math.round(w + (deltaX || 0))), Math.max(300, Math.round(h + (deltaY || 0))));
  }
});

// Auto-fit: child dialogs (e.g. download-status with its collapsible details
// table) report their natural content height so the OS window shrinks/grows
// with the DOM instead of leaving dead space above the footer.
ipcMain.on('window-autofit-height', (event, contentHeight) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  const target = Math.round(Number(contentHeight));
  if (!Number.isFinite(target) || target <= 0) return;
  try {
    const display = screen.getDisplayMatching(win.getBounds());
    const maxH = Math.max(240, display.workAreaSize.height - 48);
    const clamped = Math.min(maxH, Math.max(140, target));
    const [w] = win.getContentSize();
    if (clamped !== win.getContentSize()[1]) {
      win.setContentSize(w, clamped);
    }
  } catch {}
});

ipcMain.on('open-window', (event, { windowType, params }) => {
  openChildWindow(windowType, params || {});
});

ipcMain.on('open-download-window', (event, downloadId) => {
  openChildWindow('download-status', { id: downloadId });
});

// A child window (e.g. the scheduler) cannot spawn siblings, so it asks the
// main process to open the tiny always-on-top address dialog instead.
ipcMain.on('show-address-dialog', () => {
  openChildWindow('address-input');
});

ipcMain.on('system-beep', () => {
  shell.beep();
});

// Appearance sync: the renderer's theme mode (light/dark/system) drives
// nativeTheme so the frameless window background, context menus and scrollbars
// match, and new windows are created with the right backdrop color.
ipcMain.on('set-native-theme', (event, mode) => {
  try {
    const m = mode === 'light' || mode === 'dark' ? mode : 'system';
    nativeTheme.themeSource = m;
  } catch {}
});

// Track the last-known dark state so windows created later get the right
// background without waiting for the renderer's first paint.
let nativeDark = false;
function windowBackgroundColor() {
  return nativeDark ? '#17181c' : '#f9fafb';
}
function watchNativeTheme() {
  try {
    const { nativeTheme } = require('electron');
    nativeDark = nativeTheme.shouldUseDarkColors;
    nativeTheme.on('updated', () => {
      nativeDark = nativeTheme.shouldUseDarkColors;
      // Repaint open windows' backdrop so edges never flash light-on-dark.
      for (const win of BrowserWindow.getAllWindows()) {
        try { win.setBackgroundColor(windowBackgroundColor()); } catch {}
      }
    });
  } catch {}
}

ipcMain.on('window-flash', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.flashFrame(true);
});

ipcMain.handle('show-native-message-box', async (event, options) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showMessageBox(senderWin, {
    type: options.type || 'info',
    buttons: options.buttons || ['OK'],
    defaultId: options.defaultId || 0,
    cancelId: options.cancelId ?? (options.buttons?.length > 1 ? 1 : 0),
    title: options.title || 'NDM',
    message: options.message || '',
    detail: options.detail || '',
    noLink: true,
  });
  return result.response;
});

ipcMain.on('show-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

// Auto-Updater IPC
ipcMain.handle('updater-check', async () => {
  if (!app.isPackaged) {
    updateState = {
      status: 'not-available',
      channel: autoUpdater.channel || 'latest',
      updateInfo: { version: app.getVersion() },
      progress: null,
      error: null,
    };
    broadcastUpdateState();
    return updateState;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return result;
  } catch (err) {
    updateState.status = 'error';
    updateState.error = err.message;
    broadcastUpdateState();
    return { error: err.message };
  }
});

ipcMain.handle('updater-download', async () => {
  if (!app.isPackaged) return { success: true };
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// Download Safety Check Before Install (Section 12 & 27)
ipcMain.handle('updater-install', async () => {
  let activeDownloadsCount = 0;
  try {
    activeDownloadsCount = await new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:5005/api/downloads', { headers: { 'X-NDM-Token': NDM_LOCAL_TOKEN } }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            const active = (parsed.downloads || []).filter(d => d.status === 'downloading');
            resolve(active.length);
          } catch { resolve(0); }
        });
      });
      req.on('error', () => resolve(0));
      req.setTimeout(500, () => { req.destroy(); resolve(0); });
    });
  } catch {}

  return { activeDownloadsCount };
});  ipcMain.handle('updater-quit-and-install', () => {
  isAppQuitting = true;
  killEngine();
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('updater-get-state', () => {
  return {
    ...updateState,
    policy: { ...updatePolicy },
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
  };
});

ipcMain.handle('updater-set-policy', (_event, policy) => {
  if (!policy || typeof policy !== 'object') {
    return { success: false, error: 'Invalid policy payload' };
  }
  if (policy.checkAutomatically !== undefined) updatePolicy.checkAutomatically = Boolean(policy.checkAutomatically);
  if (policy.notifyWhenReady !== undefined) updatePolicy.notifyWhenReady = Boolean(policy.notifyWhenReady);
  if (policy.installAutomatically !== undefined) updatePolicy.installAutomatically = Boolean(policy.installAutomatically);
  applyUpdatePolicy();
  saveUpdatePolicy();
  broadcastUpdateState();
  return { success: true, policy: { ...updatePolicy } };
});

ipcMain.handle('updater-set-channel', (event, channel) => {
  if (['latest', 'beta', 'alpha'].includes(channel)) {
    autoUpdater.channel = channel;
    updateState.channel = channel;
    broadcastUpdateState();
    return { success: true, channel };
  }
  return { success: false };
});


// Sanitized Diagnostics Export (Section 39)
ipcMain.handle('export-diagnostics', async () => {
  let engineData = null;
  try {
    engineData = await new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:5005/api/diagnostics', { headers: { 'X-NDM-Token': NDM_LOCAL_TOKEN } }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(800, () => { req.destroy(); resolve(null); });
    });
  } catch {}

  const report = {
    product: 'Nogadex Download Manager',
    version: app.getVersion(),
    arch: process.arch,
    platform: process.platform,
    osRelease: os.release(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    uptimeSeconds: Math.round(process.uptime()),
    memoryUsageMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    updater: {
      status: updateState.status,
      channel: updateState.channel,
      isPackaged: app.isPackaged,
    },
    engine: engineData || { status: 'offline or unreachable' },
    exportTimestamp: new Date().toISOString(),
  };

  const senderWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const { filePath } = await dialog.showSaveDialog(senderWin, {
    title: 'Export NDM Diagnostics',
    defaultPath: `ndm_diagnostics_${Date.now()}.json`,
    filters: [{ name: 'JSON Reports', extensions: ['json'] }],
  });

  if (filePath) {
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    return { success: true, filePath };
  }
  return { success: false, cancelled: true };
});

ipcMain.handle('open-external-url', async (event, rawUrl) => {
  try {
    if (typeof rawUrl !== 'string') return { success: false };
    const parsed = new URL(rawUrl);
    // Only allow web and mail links — never file:// or custom schemes.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'mailto:') {
      return { success: false, error: 'blocked protocol' };
    }
    await shell.openExternal(parsed.toString());
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// Native Folder Selection & Management IPC Handlers
ipcMain.handle('select-folder', async (event, defaultPath) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showOpenDialog(senderWin, {
    title: 'Select Download Folder',
    defaultPath: defaultPath || undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { canceled: true, folderPath: null };
  }
  return { canceled: false, folderPath: result.filePaths[0] };
});

ipcMain.handle('select-file', async (event, defaultPath) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showOpenDialog(senderWin, {
    title: 'Select Sound File',
    defaultPath: defaultPath || undefined,
    properties: ['openFile'],
    filters: [
      { name: 'Audio Files', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { canceled: true, filePath: null };
  }
  return { canceled: false, filePath: result.filePaths[0] };
});

ipcMain.handle('check-folder-exists', (event, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') {
    return { exists: false, isDirectory: false };
  }
  try {
    const exists = fs.existsSync(folderPath);
    if (!exists) return { exists: false, isDirectory: false };
    const stat = fs.statSync(folderPath);
    return { exists: true, isDirectory: stat.isDirectory() };
  } catch {
    return { exists: false, isDirectory: false };
  }
});

ipcMain.handle('create-folder', (event, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') {
    return { success: false, error: 'Invalid folder path' };
  }
  try {
    fs.mkdirSync(folderPath, { recursive: true });
    return { success: true, folderPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-downloads-path', () => {
  try {
    return app.getPath('downloads');
  } catch {
    return path.join(os.homedir(), 'Downloads');
  }
});

// Cache for extracted base64 icons to avoid repeated disk/shell queries
const nativeFileIconCache = new Map();

ipcMain.handle('get-file-icon', async (event, opts) => {
  const { filePath, filename } = opts || {};
  try {
    // 1. If file exists on disk, extract its direct icon (critical for .exe, .msi, etc.)
    if (filePath && typeof filePath === 'string' && fs.existsSync(filePath)) {
      if (nativeFileIconCache.has(filePath)) {
        return nativeFileIconCache.get(filePath);
      }
      const icon = await app.getFileIcon(filePath, { size: 'normal' });
      if (icon && !icon.isEmpty()) {
        const dataUrl = icon.toDataURL();
        nativeFileIconCache.set(filePath, dataUrl);
        return dataUrl;
      }
    }

    // 2. Otherwise extract the registered Windows application icon for this file extension
    const targetName = filename || filePath || '';
    const parts = targetName.toLowerCase().split('.');
    const ext = parts.length > 1 ? parts.pop() : '';

    if (ext) {
      const cacheKey = `ext:${ext}`;
      if (nativeFileIconCache.has(cacheKey)) {
        return nativeFileIconCache.get(cacheKey);
      }

      // Create a 0-byte dummy file in temp so Windows shell can resolve the registered app icon
      const dummyPath = path.join(os.tmpdir(), `ndm_dummy_${ext}.${ext}`);
      if (!fs.existsSync(dummyPath)) {
        try {
          fs.writeFileSync(dummyPath, '');
        } catch {}
      }

      if (fs.existsSync(dummyPath)) {
        const icon = await app.getFileIcon(dummyPath, { size: 'normal' });
        if (icon && !icon.isEmpty()) {
          const dataUrl = icon.toDataURL();
          nativeFileIconCache.set(cacheKey, dataUrl);
          return dataUrl;
        }
      }
    }
  } catch (err) {
    console.warn('[GetFileIcon] Could not extract file icon:', err.message);
  }
  return null;
});

// 8. Application Initialization
if (process.platform === 'win32') {
  app.setAppUserModelId('com.nogadex.ndm');
}

// Launch-on-startup: mirror the engine's general.startupWithWindows setting
// onto the OS login items. Applied at boot and whenever settings change —
// one source of truth (the engine's settings file), applied natively.
let lastStartupPref = null;
function applyStartupWithWindows() {
  fetch('http://127.0.0.1:5005/api/settings')
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
      const want = Boolean(s?.general?.startupWithWindows);
      if (want === lastStartupPref) return;
      lastStartupPref = want;
      try {
        app.setLoginItemSettings({ openAtLogin: want, path: process.execPath });
        console.log(`[NDM] Launch-on-startup ${want ? 'enabled' : 'disabled'}.`);
      } catch (err) {
        console.error('[NDM] Failed to set login item:', err);
      }
    })
    .catch(() => {});
}

app.whenReady().then(async () => {
  watchNativeTheme();
  await startEngine();

  // Wait for backend to be listening so port 5005 is ready
  for (let i = 0; i < 15; i++) {
    const alive = await checkPortInUse(5005, '/api/diagnostics');
    if (alive) break;
    await new Promise(r => setTimeout(r, 100));
  }

  applyStartupWithWindows();
  // Re-check when the user flips the toggle in Settings (settings change
  // broadcasts land on the UI, so poll lightly after a change window).
  setInterval(applyStartupWithWindows, 10000);

  await createMainWindow();
  createTray();
  startTrayPolling();
  startSoundEvents();
  setupAutoUpdater();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIcon(iconPath);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Tray keeps the app alive with active downloads even when every window is
  // hidden/closed — matching the tray behavior above. Otherwise, legacy quit.
  if (activeDownloadIds.size > 0 && tray && !isAppQuitting) return;
  killEngine();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isAppQuitting = true;
  stopTrayPolling();
  if (tray) { try { tray.destroy(); } catch (e) {} tray = null; }
  killEngine();
});
