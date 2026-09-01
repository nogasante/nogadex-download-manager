const { app, BrowserWindow, ipcMain, shell, Tray, Menu, Notification } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow = null;
let engineProcess = null;
let tray = null;

// Start the internal 64-Thread Engine server
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
    frame: false, // Frameless for custom native dark titlebar
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Window Controls
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
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
