/**
 * Wire format for a single byte-range chunk. Field names mirror what the
 * engine's DynamicRangeScheduler emits (see server/scheduler.ts) so UI
 * consumers can use server chunks directly.
 */
export interface DownloadChunk {
  id: number;
  startByte: number;
  endByte: number;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  status: 'idle' | 'active' | 'downloading' | 'done' | 'error';
}

export type ChunkProgress = DownloadChunk;

export interface IntegrityScanReport {
  scanned: number;
  verified: number;
  mismatch: number;
  unverified: number;
  missing: number;
  unreadable: number;
  results: Array<{
    id: string;
    filename: string;
    path: string;
    status: 'verified' | 'mismatch' | 'unverified' | 'missing' | 'unreadable';
    size: number;
    expectedSha256?: string;
    actualSha256?: string;
    error?: string;
  }>;
}

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
  /**
   * True when the engine picks the optimal stream count per download (Auto
   * mode): stream count adapts to file size, range support and host caps.
   * False when the user picked an explicit stream count (Manual mode), which
   * the engine honors up to host caps.
   */
  autoStreams?: boolean;
  /**
   * True when the filename came from explicit user input (dialog field,
   * batch entry, API customFilename). A user-typed name wins over any
   * Content-Disposition/URL basename the probe discovers. False when the
   * name was derived automatically, so probe hints may still refine it.
   */
  userFilename?: boolean;
  /**
   * Result of the last integrity scan for this row (only meaningful for
   * completed downloads): verdict plus expected/actual SHA-256 when known.
   */
  integrity?: {
    status: 'verified' | 'mismatch' | 'unverified' | 'missing' | 'unreadable';
    checkedAt: number;
    expectedSha256?: string;
    actualSha256?: string;
  };
  speedLimitKB?: number;
  createdAt: number;
  completedAt?: number;
  category?: string;
  /**
   * Credentials captured by the browser extension for cookie-gated or
   * signed URLs. Cookies are host-scoped: they are only sent to requests
   * matching the captured origin (browser semantics) and are never
   * persisted to the engine state file.
   */
  browserCredentials?: {
    cookies?: string;
    userAgent?: string;
    referrer?: string;
    origin?: string;
  };
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
  /**
   * When true, the engine ignores any requested stream count and picks the
   * optimal connection count per download (file size, range support, host
   * caps). This is the recommended default — a user-picked number can slow
   * small files down (handshake overhead) or overwhelm rate-limiting hosts.
   */
  autoStreams?: boolean;
  startImmediate?: boolean;
  /** Custom per-download User-Agent (empty/undefined = engine default). */
  userAgent?: string;
  /** What to do when the URL/file already exists. Undefined = engine's
   *  safe default (one row per URL, retry-in-place). */
  duplicatePolicy?: 'overwrite' | 'skip' | 'rename';
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
  /** General tab: monitor clipboard for downloadable links (server: clipboard.autoCapture) */
  monitorClipboard?: boolean;
  /** Browser tab: capture exception lists */
  browser?: {
    excludedExtensions?: string[];
    excludedDomains?: string[];
  };
}
