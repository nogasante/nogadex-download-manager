import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { DownloadEngine } from './engine';
import { exec } from 'child_process';
import path from 'path';

const app = express();
const port = 5005;

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let speedHistory: number[] = new Array(30).fill(0);

const engine = new DownloadEngine(() => {
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
setInterval(() => {
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

// REST API Endpoints
app.get('/api/downloads', (req, res) => {
  res.json({
    downloads: Array.from(engine.downloads.values()),
    defaultPath: engine.defaultDownloadDir,
  });
});

app.post('/api/downloads', async (req, res) => {
  const { url, filename, destinationFolder, connections } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const item = await engine.addDownload(url, filename, destinationFolder, connections || 32);
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/downloads/:id/pause', (req, res) => {
  engine.pauseDownload(req.params.id);
  res.json({ success: true });
});

app.post('/api/downloads/:id/resume', (req, res) => {
  engine.resumeDownload(req.params.id);
  res.json({ success: true });
});

app.delete('/api/downloads/:id', (req, res) => {
  const deleteFile = req.query.deleteFile === 'true';
  engine.removeDownload(req.params.id, deleteFile);
  res.json({ success: true });
});

app.post('/api/open-folder', (req, res) => {
  const { filePath } = req.body;
  const targetDir = filePath ? path.dirname(filePath) : engine.defaultDownloadDir;
  
  if (process.platform === 'win32') {
    if (filePath) {
      exec(`explorer.exe /select,"${filePath}"`);
    } else {
      exec(`explorer.exe "${targetDir}"`);
    }
  } else if (process.platform === 'darwin') {
    exec(`open "${targetDir}"`);
  } else {
    exec(`xdg-open "${targetDir}"`);
  }
  res.json({ success: true });
});

app.post('/api/open-file', (req, res) => {
  const { filePath } = req.body;
  if (filePath) {
    if (process.platform === 'win32') {
      exec(`start "" "${filePath}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${filePath}"`);
    } else {
      exec(`xdg-open "${filePath}"`);
    }
  }
  res.json({ success: true });
});

server.listen(port, () => {
  console.log(`[HyperDownloader Engine] Running on http://localhost:${port}`);
  console.log(`[Storage] Default directory: ${engine.defaultDownloadDir}`);
});
