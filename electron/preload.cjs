const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  openDownloadWindow: (id) => ipcRenderer.send('open-download-window', id),
  notify: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  isNative: true,
});
