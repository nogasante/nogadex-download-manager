export interface DownloadChunk {
  id: number;
  start: number;
  end: number;
  downloaded: number;
  status: 'idle' | 'downloading' | 'completed' | 'error';
  speedBps?: number;
  workerId?: string;
}

export type ChunkProgress = DownloadChunk;

export interface DownloadItem {
  id: string;
  url: string;
  filename: string;
  destinationPath: string;
  status: 'queued' | 'probing' | 'downloading' | 'paused' | 'completed' | 'error';
  totalBytes: number;
  downloadedBytes: number;
  speedBps: number;
  etaSeconds: number;
  connections: number;
  chunks: DownloadChunk[];
  error?: string | null;
  resumable: boolean;
  createdAt: number;
}

export interface EngineStats {
  totalSpeedBps: number;
  activeDownloadsCount: number;
  completedCount: number;
  queuedCount: number;
  speedHistory: number[];
}

export interface NewDownloadPayload {
  url: string;
  filename?: string;
  destinationFolder?: string;
  connections?: number;
  startImmediate?: boolean;
}

export interface AppSettings {
  defaultDownloadFolder: string;
  defaultFolder?: string;
  tempDownloadFolder: string;
  tempDir?: string;
  autoCategorize?: boolean;
  rememberLastFolder?: boolean;
  maxConcurrentDownloads: number;
  defaultConnections: number;
  autoStartDownloads: boolean;
  overwriteExisting: boolean;
  doubleClickAction: 'open_file' | 'open_folder' | 'properties';
  speedLimitBps: number;
}
