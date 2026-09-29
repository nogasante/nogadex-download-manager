import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { DownloadEngine } from './engine';
import { SettingsManager } from './settings_store';
import { RulesEngine } from './rules_engine';
import { QueueSchedulerEngine } from './queue_scheduler_engine';
import { NativeBridgeManager, NDM_LOCAL_TOKEN } from './native_bridge';
import { ClipboardMonitorEngine } from './clipboard_monitor';
import { HistoryExportEngine } from './history_export_engine';
import { SiteGrabberEngine, SiteGrabberConfig } from './site_grabber_engine';
import { ProxyAuthManager } from './proxy_auth_manager';
import { DiagnosticsEngine } from './diagnostics_engine';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getNativeAppIcon } from './native_icon_extractor';

const app = express();
const port = parseInt(process.env.PORT || '5005', 10);

app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    // Gracefully ignored, handled by HTTP server listener
  } else {
    console.error('[WebSocketServer] Error:', err);
  }
});

let speedHistory: number[] = new Array(30).fill(0);

// Event-sound log: Electron's main process polls this to play sounds without
// depending on renderer state. Bounded, newest-first.
const soundEventLog: Array<{ event: string; id: string; filename: string; at: number; preview?: boolean; previewFile?: string }> = [];
const previousStatuses: Map<string, string> = new Map();
const previousDownloadedBytes: Map<string, number> = new Map();
function recordSoundEvent(event: 'downloadComplete' | 'downloadFailed' | 'queueStarted' | 'queueStopped', id: string, filename: string) {
  soundEventLog.unshift({ event, id, filename, at: Date.now() });
  if (soundEventLog.length > 50) soundEventLog.pop();
}

// Initialize Core Engine and Subsystems
const engine = new DownloadEngine(() => {
  // Detect download completion/failure transitions for the sound log. The
  // engine's notify() fires on every state change; we diff statuses here.
  for (const d of engine.downloads.values()) {
    const prev = previousStatuses.get(d.id);
    if (prev !== d.status) {
      if (prev !== d.status && (d.status === 'downloading' || prev === 'downloading')) {
        // Volume ledger accounting: charge the byte delta between status
        // transitions of active downloads (approximate but monotonic per item
        // via downloadedBytes diffs below).
      }
      if (d.status === 'completed') recordSoundEvent('downloadComplete', d.id, d.filename);
      else if (d.status === 'error') recordSoundEvent('downloadFailed', d.id, d.filename);
      previousStatuses.set(d.id, d.status);
    }
    // Download limits: charge bytes actually delivered to disk in
    // this tick for downloading items against the sliding-window quota.
    const prevBytes = previousDownloadedBytes.get(d.id) || 0;
    const delta = (d.downloadedBytes || 0) - prevBytes;
    if (d.status === 'downloading' && delta > 0) recordVolumeBytes(delta);
    previousDownloadedBytes.set(d.id, d.downloadedBytes || 0);
  }
  broadcastState();
});

const settingsManager = new SettingsManager();

// Hydrate the Proxy & Site-Logins subsystem from persisted settings so the
// Settings dialog reflects and the engine uses the saved configuration.
const proxyAuth = new ProxyAuthManager();
{
  const persisted = settingsManager.getSettings();
  if (persisted.proxy) proxyAuth.setGlobalProxy(persisted.proxy);
  for (const cred of persisted.siteCredentials || []) {
    proxyAuth.addCredential(cred);
  }
}
engine.proxyAuth = proxyAuth;
proxyAuth.on('proxyUpdated', (cfg: any) => {
  settingsManager.updateSettings({ proxy: { enabled: cfg.enabled, type: cfg.type, host: cfg.host, port: cfg.port, username: cfg.username, password: cfg.password } });
});
proxyAuth.on('credentialUpdated', () => {
  settingsManager.updateSettings({ siteCredentials: proxyAuth.getCredentials() });
});
proxyAuth.on('credentialRemoved', () => {
  settingsManager.updateSettings({ siteCredentials: proxyAuth.getCredentials() });
});

const rulesEngine = new RulesEngine();
const queueScheduler = new QueueSchedulerEngine();

// Hydrate persisted queues (incl. schedules) and re-persist on changes so the
// Scheduler dialog's Apply survives restarts.
{
  const persistedQueues = settingsManager.getSettings().queues || [];
  for (const pq of persistedQueues) {
    if (!pq || pq.id === 'default' || queueScheduler.getQueue(pq.id)) continue;
    queueScheduler.createQueue(pq.id, pq.name, pq.maxConcurrent, pq.schedule);
  }
  const persistQueues = () => {
    try {
      settingsManager.updateSettings({
        queues: queueScheduler.getQueues().map((q) => ({
          id: q.id,
          name: q.name,
          maxConcurrent: q.maxConcurrent,
          schedule: { ...q.schedule },
        })),
      });
    } catch { /* best-effort persistence */ }
  };
  queueScheduler.on('queueCreated', persistQueues);
  queueScheduler.on('queueDeleted', persistQueues);
  queueScheduler.on('queueUpdated', persistQueues);
}

// "Download limits": stop/hold downloads once the sliding-window
// volume quota (N MB per M hours) is exhausted. The ledger counts bytes
// delivered to disk and persists so the quota survives app restarts.
let volumeHoldActive = false;
function recordVolumeBytes(bytes: number): void {
  const s = settingsManager.getSettings();
  if (!s.volumeLimits?.enabled) return;
  const ledger = Array.isArray(s.volumeLedger) ? [...s.volumeLedger] : [];
  const cutoff = Date.now() - Math.max(1, s.volumeLimits.periodHours) * 3600_000;
  ledger.push({ at: Date.now(), bytes });
  const trimmed = ledger.filter((e) => e.at >= cutoff).slice(-5000);
  settingsManager.updateSettings({ volumeLedger: trimmed });
}

function volumeUsedBytes(): number {
  const s = settingsManager.getSettings();
  if (!s.volumeLimits?.enabled) return 0;
  const cutoff = Date.now() - Math.max(1, s.volumeLimits.periodHours) * 3600_000;
  return (s.volumeLedger || []).filter((e) => e.at >= cutoff).reduce((a, e) => a + (Number(e.bytes) || 0), 0);
}

setInterval(() => {
  try {
    const s = settingsManager.getSettings();
    if (!s.volumeLimits?.enabled) {
      if (volumeHoldActive) {
        volumeHoldActive = false;
        queueScheduler.startQueue('default');
        broadcastState();
      }
      return;
    }
    const quotaBytes = Math.max(1, s.volumeLimits.limitMB) * 1024 * 1024;
    const used = volumeUsedBytes();
    if (!volumeHoldActive && used >= quotaBytes) {
      volumeHoldActive = true;
      queueScheduler.stopQueue('default');
      broadcastState();
    } else if (volumeHoldActive && used < quotaBytes) {
      volumeHoldActive = false;
      queueScheduler.startQueue('default');
      broadcastState();
    }
  } catch { /* enforcement is best-effort */ }
}, 5000).unref();

const nativeBridge = new NativeBridgeManager(engine, rulesEngine, settingsManager, (downloadId, ruleQueueId) => {
  queueScheduler.autoAssignDownload(downloadId, ruleQueueId);
});
const clipboardMonitor = new ClipboardMonitorEngine(settingsManager);
const historyExport = new HistoryExportEngine();
const siteGrabber = new SiteGrabberEngine();
const diagnosticsEngine = new DiagnosticsEngine(engine);

// Reactively apply settings to engine
settingsManager.on('change', (newSettings: any) => {
  const downloadFolder = newSettings.defaultDownloadFolder || newSettings.downloads?.defaultDownloadFolder;
  if (downloadFolder) {
    engine.defaultDownloadDir = downloadFolder;
  }
  const speedLimit = newSettings.speedLimitBps ?? (newSettings.network?.globalSpeedLimitEnabled ? (newSettings.network?.globalSpeedLimitKB * 1024) : 0);
  if (typeof speedLimit === 'number' && speedLimit > 0) {
    engine.setGlobalSpeedLimit(Math.round(speedLimit / 1024));
  } else {
    engine.setGlobalSpeedLimit(0);
  }
  const maxConc = newSettings.maxConcurrentDownloads ?? newSettings.downloads?.maxConcurrentDownloads;
  if (typeof maxConc === 'number') {
    engine.setMaxConcurrentDownloads(maxConc);
  }
  broadcastState();
});

// Initial settings synchronization
const initialSettings: any = settingsManager.getSettings();
const initialFolder = initialSettings.defaultDownloadFolder || initialSettings.downloads?.defaultDownloadFolder;
if (initialFolder) {
  engine.defaultDownloadDir = initialFolder;
}
const initialMaxConc = initialSettings.maxConcurrentDownloads ?? initialSettings.downloads?.maxConcurrentDownloads;
if (typeof initialMaxConc === 'number') {
  engine.setMaxConcurrentDownloads(initialMaxConc);
}
// Apply the persisted global speed limit at startup — previously it was only
// applied reactively on settings changes, so a saved limit was ignored after a restart.
{
  const initialSpeedLimit = initialSettings.speedLimitBps ?? (initialSettings.network?.globalSpeedLimitEnabled ? (initialSettings.network?.globalSpeedLimitKB * 1024) : 0);
  engine.setGlobalSpeedLimit(typeof initialSpeedLimit === 'number' && initialSpeedLimit > 0 ? Math.round(initialSpeedLimit / 1024) : 0);
}

// Reactively execute queue start / stop on underlying downloads
queueScheduler.on('queueStarted', async (q) => {
  recordSoundEvent('queueStarted', q.id, q.name);
  if (q.id === 'default') {
    for (const item of engine.downloads.values()) {
      if (item.status === 'paused' || item.status === 'error') {
        await engine.resumeDownload(item.id);
      } else if (item.status === 'queued') {
        await engine.startDownload(item.id);
      }
    }
  } else {
    for (const dId of q.downloadIds) {
      const di = engine.downloads.get(dId);
      if (!di) continue;
      if (di.status === 'paused' || di.status === 'error') {
        await engine.resumeDownload(dId);
      } else if (di.status === 'queued') {
        await engine.startDownload(dId);
      }
    }
  }
  broadcastState();
});

queueScheduler.on('queueStopped', async (q) => {
  recordSoundEvent('queueStopped', q.id, q.name);
  if (q.id === 'default') {
    for (const item of engine.downloads.values()) {
      if (item.status === 'downloading' || item.status === 'probing') {
        await engine.pauseDownload(item.id);
      }
    }
  } else {
    for (const dId of q.downloadIds) {
      if (engine.downloads.has(dId)) {
        await engine.pauseDownload(dId);
      }
    }
  }
  broadcastState();
});

function broadcastState() {
  const items = Array.from(engine.downloads.values());
  const totalSpeed = items.reduce((acc, i) => acc + (i.status === 'downloading' ? i.speedBps : 0), 0);
  
  speedHistory.push(Math.round(totalSpeed / 1024)); // Store in KB/s
  if (speedHistory.length > 30) speedHistory.shift();

  const payload = JSON.stringify({
    type: 'STATE_UPDATE',
    downloads: items,
    settings: settingsManager.getSettings(),
    queues: queueScheduler.getQueues(),
    stats: {
      totalSpeedBps: totalSpeed,
      activeDownloadsCount: items.filter(i => i.status === 'downloading').length,
      completedCount: items.filter(i => i.status === 'completed').length,
      queuedCount: items.filter(i => i.status === 'queued' || i.status === 'paused').length,
      speedHistory,
    },
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// 1-second pulse for idle speed updates
const pulseInterval = setInterval(() => {
  broadcastState();
}, 1000);

wss.on('connection', (ws, req) => {
  // Token gate: the renderer always connects via getWsUrl(), which appends it.
  try {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (u.searchParams.get('token') !== NDM_LOCAL_TOKEN) {
      ws.close(4403, 'Unauthorized');
      return;
    }
  } catch {
    ws.close(4403, 'Unauthorized');
    return;
  }
  // Send immediate state on connection
  broadcastState();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch (e) {}
  });
});

// Settings REST API Endpoints
// Local-API lockdown: every /api route requires the shared local token. The
// engine binds to 127.0.0.1 only; the token additionally stops drive-by web
// pages, since a browser cannot attach this custom header cross-origin
// without a CORS preflight the server refuses to grant (no CORS is enabled).
app.use('/api', (req, res, next) => {
  const auth = nativeBridge.validateRequest(req);
  if (!auth.valid) {
    return res.status(403).json({ error: auth.error || 'Unauthorized' });
  }
  next();
});

app.get('/api/settings', (_req, res) => {
  const full = settingsManager.getSettings() as any;
  res.json({
    ...full,
    maxConcurrentDownloads: full.downloads?.maxConcurrentDownloads ?? full.maxConcurrentDownloads ?? 0,
    defaultDownloadFolder: full.downloads?.defaultDownloadFolder || full.defaultDownloadFolder || '',
    defaultConnections: full.downloads?.defaultConnections ?? full.defaultConnections ?? 32,
    autoStartDownloads: full.downloads?.autoStartDownloads ?? full.autoStartDownloads ?? true,
    speedLimitBps: full.network?.globalSpeedLimitEnabled ? ((full.network?.globalSpeedLimitKB || 0) * 1024) : (full.speedLimitBps || 0),
    overwriteExisting: full.downloads?.duplicateHandling === 'overwrite',
    autoCategorize: full.autoCategorize ?? true,
    rememberLastFolder: full.rememberLastFolder ?? true,
    monitorClipboard: full.clipboard?.autoCapture ?? true,
    tempDownloadFolder: full.downloads?.tempDownloadFolder || full.tempDownloadFolder || '',
  });
});

app.post('/api/settings', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid settings payload' });
  }
  try {
    const payload = req.body;
    const flatSettings: any = {
      defaultDownloadFolder: payload.downloads?.defaultDownloadFolder || payload.defaultDownloadFolder || payload.defaultFolder,
      tempDownloadFolder: payload.downloads?.tempDownloadFolder || payload.tempDownloadFolder || payload.tempDir,
      maxConcurrentDownloads: payload.downloads?.maxConcurrentDownloads !== undefined ? payload.downloads.maxConcurrentDownloads : payload.maxConcurrentDownloads,
      defaultConnections: payload.downloads?.defaultConnections !== undefined ? payload.downloads.defaultConnections : payload.defaultConnections,
      autoStartDownloads: payload.downloads?.autoStartDownloads !== undefined ? payload.downloads.autoStartDownloads : payload.autoStartDownloads,
      overwriteExisting: payload.downloads?.duplicateHandling === 'overwrite' || payload.overwriteExisting,
      doubleClickAction: payload.general?.doubleClickAction || payload.doubleClickAction,
      speedLimitBps: payload.network?.globalSpeedLimitEnabled ? ((payload.network?.globalSpeedLimitKB || 0) * 1024) : (payload.speedLimitBps || 0),
      autoCategorize: payload.autoCategorize,
      rememberLastFolder: payload.rememberLastFolder,
      clipboard: payload.monitorClipboard !== undefined ? { autoCapture: Boolean(payload.monitorClipboard) } : undefined,
    };
    if (flatSettings.clipboard === undefined) delete flatSettings.clipboard;

    // Strip undefined keys
    Object.keys(flatSettings).forEach(key => {
      if (flatSettings[key] === undefined) delete flatSettings[key];
    });

    const updated = settingsManager.updateSettings({ ...payload, ...flatSettings }) as any;
    const effectiveMaxConcurrent = updated.downloads?.maxConcurrentDownloads ?? updated.maxConcurrentDownloads ?? 0;
    engine.setMaxConcurrentDownloads(effectiveMaxConcurrent);
    broadcastState();
    res.json({
      ...updated,
      maxConcurrentDownloads: effectiveMaxConcurrent,
      defaultDownloadFolder: updated.downloads?.defaultDownloadFolder || updated.defaultDownloadFolder || '',
      defaultConnections: updated.downloads?.defaultConnections ?? updated.defaultConnections ?? 32,
      autoStartDownloads: updated.downloads?.autoStartDownloads ?? updated.autoStartDownloads ?? true,
      speedLimitBps: updated.network?.globalSpeedLimitEnabled ? ((updated.network?.globalSpeedLimitKB || 0) * 1024) : (updated.speedLimitBps || 0),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update settings' });
  }
});

app.post('/api/settings/reset', (_req, res) => {
  const reset = settingsManager.resetDefaults();
  broadcastState();
  res.json(reset);
});


// Queue & Scheduler REST Endpoints
app.get('/api/queues', (_req, res) => {
  res.json(queueScheduler.getQueues());
});

app.post('/api/queues', (req, res) => {
  const { id, name, maxConcurrent, schedule } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Queue name is required' });
  }
  const queueId = id || `q_${Date.now()}`;
  const created = queueScheduler.createQueue(queueId, name, maxConcurrent, schedule);
  broadcastState();
  res.json(created);
});

app.delete('/api/queues/:id', (req, res) => {
  const { id } = req.params;
  const deleted = queueScheduler.deleteQueue(id);
  if (!deleted) {
    return res.status(400).json({ error: 'Cannot delete default queue or non-existent queue' });
  }
  broadcastState();
  res.json({ success: true });
});

app.post('/api/queues/:id/start', (req, res) => {
  const { id } = req.params;
  const started = queueScheduler.startQueue(id);
  broadcastState();
  res.json({ success: started });
});

app.post('/api/queues/:id/stop', (req, res) => {
  const { id } = req.params;
  const stopped = queueScheduler.stopQueue(id);
  broadcastState();
  res.json({ success: stopped });
});

// Persist a queue's schedule + metadata (Scheduler Apply).
app.post('/api/queues/:id/schedule', (req, res) => {
  const { id } = req.params;
  const { schedule, name, maxConcurrent } = req.body || {};
  const existing = queueScheduler.getQueue(id);
  if (!existing) {
    return res.status(404).json({ error: 'Queue not found' });
  }
  if (schedule && typeof schedule === 'object') {
    queueScheduler.updateQueueSchedule(id, {
      enabled: Boolean(schedule.enabled),
      startAtTime: schedule.startAtTime || undefined,
      stopAtTime: schedule.stopAtTime || undefined,
      daysOfWeek: Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length > 0
        ? schedule.daysOfWeek.map((n: unknown) => Math.max(0, Math.min(6, Number(n) || 0)))
        : [0, 1, 2, 3, 4, 5, 6],
      actionOnComplete: schedule.actionOnComplete || 'none',
      maxRetries: Math.max(0, Math.min(20, Number(schedule.maxRetries) || 0)),
      once: Boolean(schedule.once),
      onceDate: /^\d{4}-\d{2}-\d{2}$/.test(String(schedule.onceDate || '')) ? String(schedule.onceDate) : undefined,
    });
  }
  if (name !== undefined || maxConcurrent !== undefined) {
    queueScheduler.updateQueueMeta(id, {
      name: name !== undefined ? String(name) : undefined,
      maxConcurrent: maxConcurrent !== undefined ? Number(maxConcurrent) : undefined,
    });
  }
  broadcastState();
  res.json(queueScheduler.getQueue(id));
});

// "Download limits" (N MB per M hours) — get + set.
app.get('/api/volume-limits', (_req, res) => {
  const s = settingsManager.getSettings();
  res.json({
    ...s.volumeLimits,
    usedMB: Math.round((volumeUsedBytes() / (1024 * 1024)) * 10) / 10,
  });
});

app.post('/api/volume-limits', (req, res) => {
  const { enabled, limitMB, periodHours, showWarning } = req.body || {};
  const current = settingsManager.getSettings().volumeLimits;
  const next = {
    enabled: enabled !== undefined ? Boolean(enabled) : current.enabled,
    limitMB: limitMB !== undefined ? Math.max(1, Math.floor(Number(limitMB) || 0)) : current.limitMB,
    periodHours: periodHours !== undefined ? Math.max(1, Math.min(168, Math.floor(Number(periodHours) || 0))) : current.periodHours,
    showWarning: showWarning !== undefined ? Boolean(showWarning) : current.showWarning,
  };
  settingsManager.updateSettings({ volumeLimits: next });
  broadcastState();
  res.json({ success: true, volumeLimits: next, usedMB: Math.round((volumeUsedBytes() / (1024 * 1024)) * 10) / 10 });
});

// Queue membership management (main-table "move to queue" parity):
app.post('/api/downloads/:id/queue', (req, res) => {
  const { id } = req.params;
  const queueId = req.body?.queueId;
  if (!queueId || typeof queueId !== 'string') {
    return res.status(400).json({ error: 'queueId is required' });
  }
  queueScheduler.removeFromAllQueues(id);
  const added = queueScheduler.addToQueue(queueId, id);
  if (!added) {
    return res.status(400).json({ error: `Cannot add to queue '${queueId}' (missing queue or download)` });
  }
  broadcastState();
  res.json({ success: true, queueId });
});

app.delete('/api/downloads/:id/queue', (req, res) => {
  const { id } = req.params;
  queueScheduler.removeFromAllQueues(id);
  broadcastState();
  res.json({ success: true });
});

// Per-download queue id map for the table's Queue column (one round trip).
app.get('/api/queue-assignments', (_req, res) => {
  const map: Record<string, string> = {};
  for (const q of queueScheduler.getQueues()) {
    for (const dlId of q.downloadIds) map[dlId] = q.id;
  }
  res.json(map);
});

// Event-sounds configuration. The engine resolves
// which sound should play; Electron's main process performs playback.
app.get('/api/sounds', (_req, res) => {
  res.json((settingsManager.getSettings() as any).sounds);
});

app.post('/api/sounds', (req, res) => {
  try {
    const updated = settingsManager.updateSettings({ sounds: req.body });
    res.json((updated as any).sounds);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Invalid sound settings' });
  }
});

// Sound-event feed for Electron (since=timestamp filter, newest-first).
app.get('/api/sound-events', (req, res) => {
  const since = Number(req.query.since) || 0;
  res.json(soundEventLog.filter((e) => e.at > since));
});

// Sound-test ping (Settings → Sounds → Test button): emits a one-shot event
// that Electron's main process plays through the SAME playback path as real
// events — so what you hear is exactly what a completed download will sound
// like. `preview` bypasses the enabled/mute check (that's the point of Test).
app.post('/api/sound-test', (req, res) => {
  try {
    const event = String(req.body?.event || 'downloadComplete');
    const allowed = ['downloadComplete', 'downloadFailed', 'queueStarted', 'queueStopped'];
    if (!allowed.includes(event)) {
      return res.status(400).json({ error: `Unknown sound event: ${event}` });
    }
    const previewFile = typeof req.body?.file === 'string' ? req.body.file : '';
    soundEventLog.unshift({ event, id: 'test', filename: '(test)', at: Date.now(), preview: true, previewFile });
    if (soundEventLog.length > 50) soundEventLog.pop();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to queue test sound' });
  }
});


// Phase 9.4 Browser Extension & Native Bridge REST Endpoints
app.post('/api/bridge/download', async (req, res) => {
  const auth = nativeBridge.validateRequest(req);
  if (!auth.valid) {
    return res.status(403).json({ error: auth.error });
  }

  try {
    const item = await nativeBridge.handleDownloadCapture(req.body || {});
    broadcastState();
    res.json({ success: true, downloadId: item.id, filename: item.filename });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to capture browser download' });
  }
});

app.get('/api/bridge/diagnostics', (_req, res) => {
  res.json(nativeBridge.getDiagnostics());
});

// Bridge policy snapshot for the browser extension: capture keys, per-browser
// toggles, context-menu item visibility, and the in-page panel switch.
// Token-gated like every other bridge endpoint (same X-NDM-Token header).
app.get('/api/bridge/policy', (req, res) => {
  const auth = nativeBridge.validateRequest(req);
  if (!auth.valid) {
    return res.status(403).json({ error: auth.error });
  }
  // Each policy poll doubles as an extension heartbeat (the extension polls
  // every 2 minutes), which powers the Browser-tab connection status row.
  const hb = typeof req.query.browser === 'string' ? req.query.browser : '';
  if (hb) nativeBridge.recordHeartbeat(hb);
  const b = settingsManager.getSettings().browser;
  res.json({
    forceKeys: b.forceKeys,
    preventKeys: b.preventKeys,
    showDownloadPanel: b.showDownloadPanel,
    contextMenu: b.contextMenu,
    browsers: {
      chrome: b.chromeEnabled,
      edge: b.edgeEnabled,
      firefox: b.firefoxEnabled,
      opera: b.operaEnabled,
      brave: b.braveEnabled,
      vivaldi: b.vivaldiEnabled,
    },
    autoInterceptDownloads: b.autoInterceptDownloads,
  });
});

// Live extension presence for the Settings → Browser status row.
app.get('/api/bridge/connections', (_req, res) => {
  res.json({ connected: nativeBridge.getConnectedBrowsers() });
});


// Phase 9.5 Clipboard & Drag/Drop REST Endpoints
app.post('/api/clipboard/parse', (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'Text string required' });
  }
  const matches = clipboardMonitor.parseClipboardText(text);
  res.json({ urls: matches.map(m => m.url) });
});


// Phase 9.6 History & Import/Export REST Endpoints
app.get('/api/history/export', (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase();
  const downloads = engine.getAllDownloads();

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="ndm_history.csv"');
    return res.send(historyExport.exportToCsv(downloads));
  } else if (format === 'txt') {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="ndm_links.txt"');
    return res.send(historyExport.exportToTxt(downloads));
  } else if (format === 'ef2') {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="ndm_export.ef2"');
    return res.send(historyExport.exportToEf2(downloads));
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="ndm_history.json"');
    return res.send(historyExport.exportToJson(downloads));
  }
});

app.post('/api/history/import', async (req, res) => {
  const { content, format } = req.body || {};
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Import content string required' });
  }

  let items: any[] = [];
  const fmt = (format || 'txt').toLowerCase();
  if (fmt === 'json') {
    items = historyExport.importFromJson(content);
  } else if (fmt === 'ef2') {
    items = historyExport.importFromEf2(content);
  } else {
    items = historyExport.importFromTxt(content);
  }

  const addedIds: string[] = [];
  for (const item of items) {
    try {
      const added = await engine.addDownload(item.url, item.filename, item.destinationFolder, item.connections);
      queueScheduler.autoAssignDownload(added.id);
      addedIds.push(added.id);
    } catch {}
  }

  broadcastState();
  res.json({ success: true, count: addedIds.length, importedCount: addedIds.length, downloadIds: addedIds });
});


// Phase 9.7 Site Grabber REST Endpoints
app.post('/api/grabber/explore', async (req, res) => {
  const config: SiteGrabberConfig = req.body;
  if (!config || !config.startUrl || !config.startUrl.startsWith('http')) {
    return res.status(400).json({ error: 'Valid HTTP/HTTPS startUrl required' });
  }

  try {
    const response = await fetch(config.startUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NDMSiteGrabber/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(400).json({ error: `Server returned HTTP ${response.status}` });
    }

    const html = await response.text();
    const result = siteGrabber.extractAssetsFromHtml(html, config.startUrl, 1, {
      startUrl: config.startUrl,
      maxDepth: config.maxDepth || 1,
      domainScope: config.domainScope || 'same_host',
      fileCategories: config.fileCategories || ['all'],
      customExtensions: config.customExtensions,
      ignorePatterns: config.ignorePatterns,
    });

    res.json({
      startUrl: config.startUrl,
      totalAssets: result.assets.length,
      assets: result.assets,
      discoveredPages: result.nextPages,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to explore site' });
  }
});


// Phase 9.8 Proxy & Site Auth REST Endpoints
app.get('/api/proxy', (_req, res) => {
  res.json({
    proxy: proxyAuth.getGlobalProxy(),
    credentials: proxyAuth.getCredentials(),
  });
});

app.post('/api/proxy', (req, res) => {
  proxyAuth.setGlobalProxy(req.body || {});
  res.json({ success: true, proxy: proxyAuth.getGlobalProxy() });
});

app.post('/api/credentials', (req, res) => {
  const cred = req.body;
  if (!cred || !cred.domain) {
    return res.status(400).json({ error: 'Domain required for credential' });
  }
  proxyAuth.addCredential({
    id: cred.id || `cred_${Date.now()}`,
    domain: cred.domain,
    authType: cred.authType || 'basic',
    username: cred.username,
    password: cred.password,
    token: cred.token,
    cookies: cred.cookies,
    customHeaders: cred.customHeaders,
  });
  res.json({ success: true, credentials: proxyAuth.getCredentials() });
});

app.delete('/api/credentials/:domain', (req, res) => {
  const deleted = proxyAuth.removeCredential(req.params.domain);
  res.json({ success: deleted });
});


// Phase 10.8 Integrity Scanner: re-verify all completed downloads
app.post('/api/integrity-scan', async (_req, res) => {
  try {
    const report = await engine.scanIntegrity();
    broadcastState();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: 'Integrity scan failed: ' + (err.message || String(err)) });
  }
});

// Phase 9.9 Diagnostics & Telemetry REST Endpoints
app.get('/api/diagnostics', async (req, res) => {
  try {
    const doProbe = req.query.probe === 'true';
    const bundle = await diagnosticsEngine.generateDiagnosticBundle(!doProbe);
    res.json(bundle);
  } catch (err) {
    res.json(engine.getDiagnosticSnapshot());
  }
});

// File System & Category Folder Management Endpoints
// ---- Category management (Options → Categories) ----
// Categories live in settings (`categories`), auto-route files into
// subfolders, and are fully editable from the sidebar context menu.
app.get('/api/categories', (_req, res) => {
  res.json(settingsManager.getSettings().categories);
});

app.post('/api/categories', (req, res) => {
  const c = req.body || {};
  const name = String(c.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  const settings = settingsManager.getSettings();
  const categories = [...(settings.categories || [])];
  const id = c.id && typeof c.id === 'string' ? c.id : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `cat_${Date.now()}`;
  const existingIdx = categories.findIndex((x) => x.id === id);
  const entry = {
    id,
    name,
    extensions: Array.isArray(c.extensions)
      ? c.extensions.map((e: unknown) => String(e).replace(/^\.+/, '').trim().toLowerCase()).filter(Boolean)
      : String(c.extensions || '').split(/[\s,;]+/).map((e) => e.replace(/^\.+/, '').trim().toLowerCase()).filter(Boolean),
    defaultFolder: String(c.defaultFolder || '').trim(),
    /** "Automatically put in this category the files from the following sites only" (glob hosts). */
    sitesOnly: Array.isArray(c.sitesOnly)
      ? c.sitesOnly.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean)
      : String(c.sitesOnly || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
    /** "Remember last save path" per category. */
    rememberLastFolder: Boolean(c.rememberLastFolder),
  };
  if (!entry.extensions.length && !entry.sitesOnly.length) {
    return res.status(400).json({ error: 'A category needs at least one file type or one site' });
  }
  if (existingIdx >= 0) categories[existingIdx] = entry;
  else categories.push(entry);
  settingsManager.updateSettings({ categories });
  broadcastState();
  res.json({ success: true, categories });
});

app.delete('/api/categories/:id', (req, res) => {
  const { id } = req.params;
  const settings = settingsManager.getSettings();
  const categories = (settings.categories || []).filter((c) => c.id !== id);
  if (categories.length === (settings.categories || []).length) {
    return res.status(404).json({ error: 'Category not found' });
  }
  settingsManager.updateSettings({ categories });
  broadcastState();
  res.json({ success: true, categories });
});

// Open a folder in the OS file explorer (sidebar "Browse").
app.post('/api/fs/open-folder', (req, res) => {
  const { folderPath } = req.body || {};
  if (!folderPath || typeof folderPath !== 'string') {
    return res.status(400).json({ error: 'Valid folderPath string required' });
  }
  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    const ok = openPathInExplorer(folderPath);
    res.json({ success: ok });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/fs/check-folder', (req, res) => {
  const { folderPath } = req.body || {};
  if (!folderPath || typeof folderPath !== 'string') {
    return res.status(400).json({ error: 'Valid folderPath string required' });
  }
  try {
    const exists = fs.existsSync(folderPath);
    if (!exists) {
      return res.json({ exists: false, isDirectory: false, path: folderPath });
    }
    const stat = fs.statSync(folderPath);
    return res.json({ exists: true, isDirectory: stat.isDirectory(), path: folderPath });
  } catch (err: any) {
    return res.json({ exists: false, isDirectory: false, path: folderPath, error: err.message });
  }
});

app.post('/api/fs/create-folder', (req, res) => {
  const { folderPath } = req.body || {};
  if (!folderPath || typeof folderPath !== 'string') {
    return res.status(400).json({ error: 'Valid folderPath string required' });
  }
  try {
    fs.mkdirSync(folderPath, { recursive: true });
    return res.json({ success: true, path: folderPath });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Real-time server probe for filename and size extraction
app.get('/api/probe', async (req, res) => {
  const { url } = req.query || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Valid URL parameter is required' });
  }
  try {
    const probe = await (engine as any).probeUrl(url.trim());
    res.json(probe);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Probe failed' });
  }
});

// REST API Endpoints
app.get('/api/downloads', (_req, res) => {
  res.json({
    downloads: Array.from(engine.downloads.values()),
    defaultPath: engine.defaultDownloadDir,
    settings: settingsManager.getSettings(),
    queues: queueScheduler.getQueues(),
  });
});

app.get('/api/downloads/:id', (req, res) => {
  const item = engine.downloads.get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Download not found' });
  }
  res.json(item);
});

app.post('/api/downloads', async (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { url, destinationFolder, connections } = req.body;
  let filename = req.body.filename;
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return res.status(400).json({ error: 'Valid URL is required' });
  }

  if (filename !== undefined && typeof filename !== 'string') {
    return res.status(400).json({ error: 'filename must be a string' });
  }

  if (destinationFolder !== undefined && typeof destinationFolder !== 'string') {
    return res.status(400).json({ error: 'destinationFolder must be a string' });
  }

  if (connections !== undefined) {
    // 0 is allowed: it (or autoStreams=true) selects Auto mode where the engine
    // picks the optimal stream count per download.
    if (typeof connections !== 'number' || isNaN(connections) || connections < 0 || connections > 64) {
      return res.status(400).json({ error: 'connections must be an integer between 0 (auto) and 64' });
    }
  }

  try {
    const trimmedUrl = url.trim();
    if (!/^https?:\/\/|^ftp:\/\//i.test(trimmedUrl)) {
      return res.status(400).json({
        error: "Cannot download this file.\n\nDetails: The address '" + trimmedUrl + "' is not a valid URL (must start with http://, https://, or ftp://)."
      });
    }

    try {
      new URL(trimmedUrl);
    } catch {
      return res.status(400).json({
        error: "Cannot download this file.\n\nDetails: The address '" + trimmedUrl + "' is malformed or contains invalid characters."
      });
    }

    const currentSettings = settingsManager.getSettings();
    // Auto mode (autoStreams) lets the engine pick the optimal stream count per
    // download (size, range support, host caps) — expressed as 0, a sentinel
    // meaning "app decides". Manual mode uses the user's number.
    const autoStreams = req.body.autoStreams === true || connections === 0;
    let        conn = autoStreams ? 0 : (connections ? Math.floor(connections) : (currentSettings.downloads.defaultConnections ?? 32));
    let dest = destinationFolder || currentSettings.downloads.defaultDownloadFolder || engine.defaultDownloadDir;

    // Apply Rules Engine routing (auto-categorization & queues)
    const ruleMatch = rulesEngine.evaluate(trimmedUrl, filename || '');
    if (ruleMatch) {
      if (ruleMatch.destinationFolder && !destinationFolder) {
        dest = ruleMatch.destinationFolder;
      }
      if (ruleMatch.maxConnections && !connections) {
        conn = autoStreams ? 0 : ruleMatch.maxConnections;
      }
    }

    // Custom per-download User-Agent ("User-Agent for manually added
    // downloads" parity): forwarded to the engine's browserCredentials.
    const customUserAgent = typeof req.body.userAgent === 'string' && req.body.userAgent.trim()
      ? req.body.userAgent.trim()
      : undefined;

    // Duplicate policy: explicit per-download user choice.
    //   skip     => an existing row for this URL/file short-circuits with 200
    //   rename   => force a non-colliding filename before handing to engine
    //   default  => the engine's safe one-row-per-URL policy
    const dupPolicy = req.body.duplicatePolicy;
    if (dupPolicy !== undefined && !['overwrite', 'skip', 'rename'].includes(dupPolicy)) {
      return res.status(400).json({ error: 'duplicatePolicy must be overwrite | skip | rename' });
    }
    if (dupPolicy === 'skip' || dupPolicy === 'rename') {
      const existing = engine.getAllDownloads().find((d) => d.url === trimmedUrl);
      if (existing) {
        if (dupPolicy === 'skip') {
          return res.status(200).json({ ...existing, skipped: true, reason: 'duplicatePolicy=skip: download already exists' });
        }
        // rename: derive a non-colliding name from the requested/existing one.
        const base = filename || existing.filename || 'download.bin';
        const dot = base.lastIndexOf('.');
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const ext = dot > 0 ? base.slice(dot) : '';
        let n = 1;
        const fsMod = await import('fs');
        const pathMod = await import('path');
        let candidate = base;
        while (
          engine.getAllDownloads().some((d) => d.filename === candidate) ||
          fsMod.existsSync(pathMod.join(dest, candidate))
        ) {
          candidate = `${stem} (${n})${ext}`;
          n++;
          if (n > 999) break;
        }
        filename = candidate;
      }
    }

    const item = await engine.addDownload(trimmedUrl, filename, dest, conn, customUserAgent
      ? { userAgent: customUserAgent }
      : undefined);
    if (req.body.startImmediate === false) {
      engine.pauseDownload(item.id);
    }
    // Auto-assign to a queue: rule-matched queue wins, otherwise the default
    // queue owns the download so queue start/stop govern it.
    queueScheduler.autoAssignDownload(item.id, ruleMatch?.queueId);

    broadcastState();
    res.json(item);
  } catch (err: any) {
    res.status(400).json({ error: "Cannot start download.\n\nDetails: " + (err.message || String(err)) });
  }
});

app.post('/api/downloads/:id/connections', (req, res) => {
  const { id } = req.params;
  const { connections } = req.body || {};
  const n = Number(connections);
  if (!Number.isFinite(n) || n < 1 || n > 64) {
    return res.status(400).json({ error: 'connections must be a number between 1 and 64 (or 0 for Auto)' });
  }
  try {
    const updated = engine.setDownloadConnections(id, n);
    broadcastState();
    return res.json({ success: true, download: updated });
  } catch (e: any) {
    return res.status(404).json({ error: e.message || 'Download not found' });
  }
});

app.post('/api/downloads/:id/speed-limit', (req, res) => {
  const { id } = req.params;
  const { speedLimitKB } = req.body || {};
  if (typeof speedLimitKB !== 'number' || speedLimitKB < 0) {
    return res.status(400).json({ error: 'speedLimitKB must be a non-negative number' });
  }
  engine.setDownloadSpeedLimit(id, speedLimitKB);
  broadcastState();
  res.json({ success: true, speedLimitKB });
});

app.get('/api/rules', (_req, res) => {
  res.json({ rules: rulesEngine.getRules() });
});

app.post('/api/rules', (req, res) => {
  const { rules } = req.body || {};
  if (Array.isArray(rules)) {
    rulesEngine.setRules(rules);
    broadcastState();
    return res.json({ success: true, count: rules.length });
  }
  res.status(400).json({ error: 'Rules array required' });
});

// NOTE: GET /api/settings is served by the single handler near the top of
// this file (line ~307). Do not add a second GET handler here — Express runs
// both, and the second res.json() throws "headers after they are sent".

// NOTE: POST /api/settings is handled once, near the top of this file
// (line ~324). Do not add a second handler — Express runs both and the
// second res.json() throws "headers after they are sent".




app.post('/api/downloads/:id/pause', async (req, res) => {
  const { id } = req.params;
  if (!engine.downloads.has(id)) {
    return res.status(404).json({ error: 'Download not found' });
  }
  await engine.pauseDownload(id);
  res.json({ success: true });
});

app.post('/api/downloads/:id/resume', async (req, res) => {
  const { id } = req.params;
  if (!engine.downloads.has(id)) {
    return res.status(404).json({ error: 'Download not found' });
  }
  await engine.resumeDownload(id);
  res.json({ success: true });
});

app.post('/api/downloads/retry-failed', async (_req, res) => {
  try {
    const retried = await engine.retryAllFailed();
    broadcastState();
    res.json({ success: true, retried, queued: engine.getAllDownloads().filter((d) => d.status === 'queued').length });
  } catch (err: any) {
    res.status(500).json({ error: 'Retry-all failed: ' + (err.message || String(err)) });
  }
});

app.post('/api/downloads/:id/update-url', async (req, res) => {
  const { id } = req.params;
  const { url } = req.body || {};
  if (!url || typeof url !== 'string' || !url.trim().startsWith('http')) {
    return res.status(400).json({ error: 'Valid URL is required' });
  }
  if (!engine.downloads.has(id)) {
    return res.status(404).json({ error: 'Download not found' });
  }
  try {
    const updated = await engine.updateDownloadUrl(id, url.trim());
    await engine.resumeDownload(id);
    broadcastState();
    res.json({ success: true, download: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update download URL' });
  }
});

app.delete('/api/downloads/:id', async (req, res) => {
  const { id } = req.params;
  if (!engine.downloads.has(id)) {
    return res.status(404).json({ error: 'Download not found' });
  }
  const deleteFile = req.query.deleteFile === 'true';
  await engine.removeDownload(id, deleteFile);
  queueScheduler.removeFromAllQueues(id);
  res.json({ success: true });
});

// Safe file / folder opener using execFile with strict path validation
function resolveTargetFilePath(rawTarget?: string): string | null {
  if (!rawTarget || typeof rawTarget !== 'string') return null;
  const clean = rawTarget.trim();
  if (engine.downloads.has(clean)) {
    const item = engine.downloads.get(clean);
    return item?.destinationPath || null;
  }
  return clean;
}

function openPathInExplorer(targetPath?: string | null, isFile = false): boolean {
  const defaultDir = engine.defaultDownloadDir;
  let target = targetPath ? path.normalize(targetPath) : defaultDir;

  if (process.platform === 'win32') {
    if (target && fs.existsSync(target)) {
      if (isFile) {
        execFile('explorer.exe', [target], (err) => {
          if (err) console.error('Failed to open file:', err);
        });
      } else {
        const isDir = fs.statSync(target).isDirectory();
        if (isDir) {
          execFile('explorer.exe', [target], (err) => {
            if (err) console.error('Failed to open explorer directory:', err);
          });
        } else {
          execFile('explorer.exe', [`/select,${target}`], (err) => {
            if (err) console.error('Failed to select file in explorer:', err);
          });
        }
      }
    } else {
      const fallbackDir = fs.existsSync(defaultDir) ? defaultDir : process.cwd();
      execFile('explorer.exe', [fallbackDir], (err) => {
        if (err) console.error('Failed to open fallback directory:', err);
      });
    }
    return true;
  } else if (process.platform === 'darwin') {
    const valid = target && fs.existsSync(target) ? target : defaultDir;
    execFile('open', [valid], () => {});
    return true;
  } else {
    const valid = target && fs.existsSync(target) ? target : defaultDir;
    execFile('xdg-open', [valid], () => {});
    return true;
  }
}

app.post('/api/open-folder', (req, res) => {
  const filePath = resolveTargetFilePath(req.body?.filePath || req.body?.id || req.body?.destinationPath);
  openPathInExplorer(filePath, false);
  res.json({ success: true });
});

app.post('/api/open-file', (req, res) => {
  const filePath = resolveTargetFilePath(req.body?.filePath || req.body?.id || req.body?.destinationPath);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File does not exist or has not finished downloading' });
  }
  openPathInExplorer(filePath, true);
  res.json({ success: true });
});

app.post('/api/downloads/:id/open-file', (req, res) => {
  const item = engine.downloads.get(req.params.id);
  const filePath = item?.destinationPath;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File does not exist or has not finished downloading' });
  }
  openPathInExplorer(filePath, true);
  res.json({ success: true });
});

app.post('/api/downloads/:id/open-folder', (req, res) => {
  const item = engine.downloads.get(req.params.id);
  const filePath = item?.destinationPath || engine.defaultDownloadDir;
  openPathInExplorer(filePath, false);
  res.json({ success: true });
});

// OS Registered Application & File Icon API
app.get('/api/icon', async (req, res) => {
  const ext = req.query.ext ? String(req.query.ext) : undefined;
  const filename = req.query.filename ? String(req.query.filename) : (ext ? `file.${ext}` : undefined);
  const filePath = req.query.filePath ? String(req.query.filePath) : undefined;

  try {
    const icon = await getNativeAppIcon(filePath, filename);
    res.json({ icon: icon || null });
  } catch {
    res.json({ icon: null });
  }
});

// Global JSON Error Handler Middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON request payload' });
  }
  console.error('[API Unhandled Error]:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Graceful Shutdown Handler
let isShuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`
[HyperDownloader Engine] Received ${signal}. Starting graceful shutdown...`);

  clearInterval(pulseInterval);

  try {
    wss.clients.forEach(client => {
      try { client.close(1001, 'Server shutting down'); } catch (e) {}
    });
    wss.close();

    await engine.shutdown();

    server.close(() => {
      console.log('[HyperDownloader Engine] Graceful shutdown completed cleanly.');
      process.exit(0);
    });

    setTimeout(() => {
      console.warn('[HyperDownloader Engine] Forced shutdown after timeout.');
      process.exit(0);
    }, 4000).unref();
  } catch (err) {
    console.error('[HyperDownloader Engine] Error during graceful shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));


// Live Dynamic Windows Default Application Icon Resolver
const dynamicIconCache = new Map<string, { buffer: Buffer; timestamp: number }>();
const ICON_CACHE_TTL = 30 * 1000; // 30s cache for high performance while dynamically tracking user app associations

app.get('/api/file-icons/:ext', async (req, res) => {
  const ext = (req.params.ext || 'default').toLowerCase().replace(/[^a-z0-9]/g, '');
  const now = Date.now();
  const cached = dynamicIconCache.get(ext);

  if (cached && (now - cached.timestamp < ICON_CACHE_TTL)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.send(cached.buffer);
  }

  if (process.platform === 'win32') {
    try {
      const { execFile } = await import('child_process');
      const psScript = `
Add-Type -AssemblyName System.Drawing
$temp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "live_icon_${ext}.${ext}")
if (-not (Test-Path $temp)) { [System.IO.File]::WriteAllText($temp, "") }
try {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($temp)
    if ($icon) {
        $bmp = $icon.ToBitmap()
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        [Convert]::ToBase64String($ms.ToArray())
    }
} catch {} finally {
    Remove-Item -Force $temp -ErrorAction SilentlyContinue
}
`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          try {
            const buf = Buffer.from(stdout.trim(), 'base64');
            if (buf.length > 50) {
              dynamicIconCache.set(ext, { buffer: buf, timestamp: now });
              res.setHeader('Content-Type', 'image/png');
              res.setHeader('Cache-Control', 'public, max-age=30');
              return res.send(buf);
            }
          } catch {}
        }
        res.redirect(`/file-icons/${ext}.png`);
      });
      return;
    } catch {}
  }

  res.redirect(`/file-icons/${ext}.png`);
});

// Static frontend serving (Production standalone mode)
// Packaged apps must resolve the UI relative to this bundle (inside app.asar),
// because process.cwd() is the install dir, not the app root. Works under both
// tsx (ESM dev) and the CJS esbuild bundle.
const moduleDirname =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname((function () { return process.argv[1]; })());
const distDir = [path.join(moduleDirname, '..', 'dist'), path.join(process.cwd(), 'dist')]
  .find((candidate) => fs.existsSync(candidate)) ?? path.join(moduleDirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[NDM Backend] Port ${port} is already active, reusing existing instance.`);
    process.exit(0);
  } else {
    console.error('[NDM Backend] Server error:', err);
  }
});

const cleanShutdown = () => {
  console.log('[NDM Backend] Shutting down cleanly...');
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
};

process.on('SIGINT', cleanShutdown);
process.on('SIGTERM', cleanShutdown);
process.on('disconnect', cleanShutdown);

// Controlled teardown endpoint for the Electron launcher (dev-mode stale-backend
// eviction). Bound to 127.0.0.1 only, so this is not reachable externally.
app.post('/api/shutdown', (_req, res) => {
  res.json({ success: true, message: 'shutting down' });
  setTimeout(cleanShutdown, 100);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[NDM Backend] FATAL: port ${port} is already in use by another process. Refusing to run stale/second instance — kill the other backend or restart.`);
    process.exit(1);
  } else {
    console.error('[NDM Backend] Server error:', err);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[NDM Backend] Running strictly on http://127.0.0.1:${port}`);
  console.log(`[Storage] Default directory: ${engine.defaultDownloadDir}`);
});
