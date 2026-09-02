const { app, BrowserWindow, ipcMain, shell, Tray, Menu, Notification } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow = null;
let engineProcess = null;
const downloadWindows = new Map(); // id -> BrowserWindow

function startEngine() {
  const serverPath = path.join(__dirname, '..', 'server', 'server.ts');
  const tsxPath = path.join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

  engineProcess = fork(tsxPath, [serverPath], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '5005' },
  });

  engineProcess.on('error', (err) => {
    console.error('Engine process error:', err);
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 850,
    minHeight: 550,
    frame: false,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Restrict child popups and navigation to trusted local origin
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith('http://localhost:5173') && !targetUrl.startsWith('file://')) {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Open Real Separate Native OS Download Window
function openDownloadWindow(downloadId) {
  if (downloadWindows.has(downloadId)) {
    const existing = downloadWindows.get(downloadId);
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 580,
    height: 480,
    minWidth: 500,
    minHeight: 400,
    frame: false,
    backgroundColor: '#121215',
    title: 'HyperDownloader - File Progress',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  const isDev = process.env.NODE_ENV !== 'production';
  const url = isDev 
    ? `http://localhost:5173/?popup=${downloadId}`
    : `file://${path.join(__dirname, '..', 'dist', 'index.html')}?popup=${downloadId}`;

  win.loadURL(url);

  win.on('closed', () => {
    downloadWindows.delete(downloadId);
  });

  downloadWindows.set(downloadId, win);
}

// IPC Handlers
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
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
  if (win) win.close();
});

ipcMain.on('open-download-window', (event, downloadId) => {
  openDownloadWindow(downloadId);
});

ipcMain.on('show-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

app.whenReady().then(() => {
  startEngine();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (engineProcess) engineProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (engineProcess) engineProcess.kill();
});
