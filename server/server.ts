import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { DownloadEngine } from './engine';
import { SettingsManager } from './settings_store';
import { RulesEngine } from './rules_engine';
import { QueueSchedulerEngine } from './queue_scheduler_engine';
import { NativeBridgeManager } from './native_bridge';
import { ClipboardMonitorEngine } from './clipboard_monitor';
import { HistoryExportEngine } from './history_export_engine';
import { SiteGrabberEngine, SiteGrabberConfig } from './site_grabber_engine';
import { ProxyAuthManager } from './proxy_auth_manager';
import { DiagnosticsEngine } from './diagnostics_engine';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

const app = express();
const port = parseInt(process.env.PORT || '5005', 10);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let speedHistory: number[] = new Array(30).fill(0);

// Initialize Core Engine and Subsystems
const engine = new DownloadEngine(() => {
  broadcastState();
});

const settingsManager = new SettingsManager();
const rulesEngine = new RulesEngine();
const queueScheduler = new QueueSchedulerEngine();
const nativeBridge = new NativeBridgeManager(engine, rulesEngine, settingsManager);
const clipboardMonitor = new ClipboardMonitorEngine(settingsManager);
const historyExport = new HistoryExportEngine();
const siteGrabber = new SiteGrabberEngine();
const proxyAuth = new ProxyAuthManager();
const diagnosticsEngine = new DiagnosticsEngine(engine);

// Reactively apply settings to engine
settingsManager.on('change', (newSettings) => {
  if (newSettings.downloads.defaultDownloadFolder) {
    engine.defaultDownloadDir = newSettings.downloads.defaultDownloadFolder;
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

wss.on('connection', (ws) => {
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
app.get('/api/settings', (req, res) => {
  res.json(settingsManager.getSettings());
});

app.post('/api/settings', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid settings payload' });
  }
  try {
    const updated = settingsManager.updateSettings(req.body);
    broadcastState();
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update settings' });
  }
});

app.post('/api/settings/reset', (req, res) => {
  const reset = settingsManager.resetDefaults();
  broadcastState();
  res.json(reset);
});


// Queue & Scheduler REST Endpoints
app.get('/api/queues', (req, res) => {
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

app.get('/api/bridge/diagnostics', (req, res) => {
  res.json(nativeBridge.getDiagnostics());
});


// Phase 9.5 Clipboard & Drag/Drop REST Endpoints
app.post('/api/clipboard/parse', (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'Text string required' });
  }
  const matches = clipboardMonitor.parseClipboardText(text);
  res.json({ matches });
});


// Phase 9.6 History & Import/Export REST Endpoints
app.get('/api/history/export', (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase();
  const downloads = engine.getAllDownloads();

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="nogadex_history.csv"');
    return res.send(historyExport.exportToCsv(downloads));
  } else if (format === 'txt') {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="nogadex_links.txt"');
    return res.send(historyExport.exportToTxt(downloads));
  } else if (format === 'ef2') {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="nogadex_export.ef2"');
    return res.send(historyExport.exportToEf2(downloads));
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="nogadex_history.json"');
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
      addedIds.push(added.id);
    } catch {}
  }

  broadcastState();
  res.json({ success: true, count: addedIds.length, downloadIds: addedIds });
});


// Phase 9.7 Site Grabber REST Endpoints
app.post('/api/grabber/explore', async (req, res) => {
  const config: SiteGrabberConfig = req.body;
  if (!config || !config.startUrl || !config.startUrl.startsWith('http')) {
    return res.status(400).json({ error: 'Valid HTTP/HTTPS startUrl required' });
  }

  try {
    const response = await fetch(config.startUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NogadexSiteGrabber/1.0' },
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
app.get('/api/proxy', (req, res) => {
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


// Phase 9.9 Diagnostics & Telemetry REST Endpoints
app.get('/api/diagnostics', async (req, res) => {
  const bundle = await diagnosticsEngine.generateDiagnosticBundle(false);
  res.json(bundle);
});

// REST API Endpoints
app.get('/api/downloads', (req, res) => {
  res.json({
    downloads: Array.from(engine.downloads.values()),
    defaultPath: engine.defaultDownloadDir,
    settings: settingsManager.getSettings(),
    queues: queueScheduler.getQueues(),
  });
});

app.get('/api/diagnostics', (req, res) => {
  res.json(engine.getDiagnosticSnapshot());
});

app.post('/api/downloads', async (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { url, filename, destinationFolder, connections } = req.body;
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
    if (typeof connections !== 'number' || isNaN(connections) || connections < 1 || connections > 64) {
      return res.status(400).json({ error: 'connections must be an integer between 1 and 64' });
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
    const conn = connections ? Math.floor(connections) : (currentSettings.downloads.defaultConnections || 32);
    const dest = destinationFolder || currentSettings.downloads.defaultDownloadFolder || engine.defaultDownloadDir;
    const item = await engine.addDownload(trimmedUrl, filename, dest, conn);
    res.json(item);
  } catch (err: any) {
    res.status(400).json({ error: "Cannot start download.\n\nDetails: " + (err.message || String(err)) });
  }
});

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

app.delete('/api/downloads/:id', async (req, res) => {
  const { id } = req.params;
  if (!engine.downloads.has(id)) {
    return res.status(404).json({ error: 'Download not found' });
  }
  const deleteFile = req.query.deleteFile === 'true';
  await engine.removeDownload(id, deleteFile);
  res.json({ success: true });
});

// Safe file / folder opener using execFile with strict path validation
app.post('/api/open-folder', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid JSON request payload' });
  }

  const { filePath } = req.body;
  let targetDir = engine.defaultDownloadDir;

  if (filePath && typeof filePath === 'string') {
    const cleanPath = filePath.replace(/[ -]/g, '').trim();
    const normalized = path.normalize(cleanPath);
    if (fs.existsSync(normalized)) {
      targetDir = fs.statSync(normalized).isDirectory() ? normalized : path.dirname(normalized);
    }
  }

  if (process.platform === 'win32') {
    if (filePath && typeof filePath === 'string') {
      const cleanPath = filePath.replace(/[ -]/g, '').trim();
      if (fs.existsSync(cleanPath)) {
        execFile('explorer.exe', [`/select,${path.normalize(cleanPath)}`], (err) => {
          if (err) console.error('Failed to open explorer:', err);
        });
      } else {
        execFile('explorer.exe', [path.normalize(targetDir)], (err) => {
          if (err) console.error('Failed to open explorer:', err);
        });
      }
    } else {
      execFile('explorer.exe', [path.normalize(targetDir)], (err) => {
        if (err) console.error('Failed to open explorer:', err);
      });
    }
  } else if (process.platform === 'darwin') {
    execFile('open', [targetDir], (err) => {
      if (err) console.error('Failed to open finder:', err);
    });
  } else {
    execFile('xdg-open', [targetDir], (err) => {
      if (err) console.error('Failed to open file manager:', err);
    });
  }
  res.json({ success: true });
});

app.post('/api/open-file', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid JSON request payload' });
  }

  const { filePath } = req.body;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'Valid filePath is required' });
  }

  const cleanPath = filePath.replace(/[ -]/g, '').trim();
  const normalized = path.normalize(cleanPath);
  if (!fs.existsSync(normalized)) {
    return res.status(404).json({ error: 'File does not exist' });
  }

  if (process.platform === 'win32') {
    execFile('explorer.exe', [normalized], (err) => {
      if (err) console.error('Failed to open file:', err);
    });
  } else if (process.platform === 'darwin') {
    execFile('open', [normalized], (err) => {
      if (err) console.error('Failed to open file:', err);
    });
  } else {
    execFile('xdg-open', [normalized], (err) => {
      if (err) console.error('Failed to open file:', err);
    });
  }
  res.json({ success: true });
});

// Global JSON Error Handler Middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
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

server.listen(port, () => {
  console.log(`[HyperDownloader Engine] Running on http://localhost:${port}`);
  console.log(`[Storage] Default directory: ${engine.defaultDownloadDir}`);
});
