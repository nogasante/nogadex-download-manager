/// <reference types="vite/client" />

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.ico' {
  const src: string;
  export default src;
}

interface Window {
  electronAPI?: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    resizeStep: (deltaX: number, deltaY: number) => void;
    openWindow: (windowType: string, params?: Record<string, any>) => void;
    openDownloadWindow: (id: string) => void;
    beep: () => void;
    flashWindow: () => void;
    showNativeMessageBox: (options: any) => Promise<any>;
    notify: (title: string, body: string) => void;
    isNative?: boolean;
    checkForUpdates: () => Promise<any>;
    downloadUpdate: () => Promise<any>;
    installUpdate: () => Promise<any>;
    quitAndInstall: () => Promise<void>;
    getUpdateState: () => Promise<any>;
    setUpdateChannel: (channel: string) => Promise<any>;
    onUpdaterStateChanged: (cb: (state: any) => void) => () => void;
    exportDiagnostics: () => Promise<{ success: boolean; filePath?: string; cancelled?: boolean }>;
    onOpenNewDownload: (cb: (data: { url: string }) => void) => () => void;
    onShowAddressDialog?: (cb: () => void) => () => void;
    selectFolder: (defaultPath?: string) => Promise<{ canceled: boolean; folderPath: string | null }>;
    checkFolderExists: (folderPath: string) => Promise<{ exists: boolean; isDirectory: boolean }>;
    createFolder: (folderPath: string) => Promise<{ success: boolean; folderPath?: string; error?: string }>;
    getDownloadsPath: () => Promise<string>;
    getFileIcon?: (opts: { filePath?: string; filename?: string }) => Promise<string | null>;
    openFile?: (filePath: string) => void;
    openFolder?: (filePath: string) => void;
  };
}
