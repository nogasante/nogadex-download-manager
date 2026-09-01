export type DownloadStatus = 
  | 'queued' 
  | 'probing' 
  | 'downloading' 
  | 'paused' 
  | 'completed' 
  | 'error' 
  | 'cancelled';

export interface ChunkProgress {
  id: number;
  startByte: number;
  endByte: number;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  status: 'idle' | 'active' | 'done' | 'error';
}

export interface DownloadItem {
  id: string;
  url: string;
  filename: string;
  destinationPath: string;
  totalBytes: number;
  downloadedBytes: number;
  status: DownloadStatus;
  speedBps: number;
  connections: number;
  chunks: ChunkProgress[];
  category: 'all' | 'video' | 'audio' | 'compressed' | 'program' | 'document' | 'other';
  resumable: boolean;
  etaSeconds: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface EngineStats {
  totalSpeedBps: number;
  activeDownloadsCount: number;
  completedCount: number;
  queuedCount: number;
  speedHistory: number[]; // Last 30 data points in KB/s
}

export interface NewDownloadPayload {
  url: string;
  filename?: string;
  destinationFolder?: string;
  connections?: number;
}
