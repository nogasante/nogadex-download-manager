const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  resizeStep: (deltaX, deltaY) => ipcRenderer.send('window-resize-step', { deltaX, deltaY }),
  autoFitWindowHeight: (contentHeight) => ipcRenderer.send('window-autofit-height', contentHeight),
  openWindow: (windowType, params) => ipcRenderer.send('open-window', { windowType, params }),
  openDownloadWindow: (id) => ipcRenderer.send('open-download-window', id),
  beep: () => ipcRenderer.send('system-beep'),
  flashWindow: () => ipcRenderer.send('window-flash'),
  showNativeMessageBox: (options) => ipcRenderer.invoke('show-native-message-box', options),
  notify: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  isNative: true,

  // Auto-Update Subsystem APIs
  checkForUpdates: () => ipcRenderer.invoke('updater-check'),
  downloadUpdate: () => ipcRenderer.invoke('updater-download'),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
  quitAndInstall: () => ipcRenderer.invoke('updater-quit-and-install'),
  getUpdateState: () => ipcRenderer.invoke('updater-get-state'),
  setUpdateChannel: (channel) => ipcRenderer.invoke('updater-set-channel', channel),
  setUpdatePolicy: (policy) => ipcRenderer.invoke('updater-set-policy', policy),
  onUpdaterStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('updater-state-changed', handler);
    return () => ipcRenderer.removeListener('updater-state-changed', handler);
  },

  // Diagnostics Export API
  exportDiagnostics: () => ipcRenderer.invoke('export-diagnostics'),

  // External Links (hardened shell.openExternal via main process)
  openExternal: (url) => ipcRenderer.invoke('open-external-url', url),

  // Single-Instance Takeover URL Listener
  onOpenNewDownload: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('open-new-download', handler);
    return () => ipcRenderer.removeListener('open-new-download', handler);
  },

  // Step-1 address dialog request from a child window (forwarded to main)
  requestAddressDialog: () => ipcRenderer.send('show-address-dialog'),
  onShowAddressDialog: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('show-address-dialog', handler);
    return () => ipcRenderer.removeListener('show-address-dialog', handler);
  },

  // Appearance: keep Electron's nativeTheme + window backgrounds in step
  // with the in-app theme (Settings → Appearance).
  setNativeTheme: (mode) => ipcRenderer.send('set-native-theme', String(mode)),

  // Directory Selection & Management APIs
  selectFolder: (defaultPath) => ipcRenderer.invoke('select-folder', defaultPath),
  // Sound-file picker (Settings → Sounds → Browse…)
  selectFile: (defaultPath) => ipcRenderer.invoke('select-file', defaultPath),
  checkFolderExists: (folderPath) => ipcRenderer.invoke('check-folder-exists', folderPath),
  createFolder: (folderPath) => ipcRenderer.invoke('create-folder', folderPath),
  getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),
  getFileIcon: (opts) => ipcRenderer.invoke('get-file-icon', opts),
});
