import { DownloadEngine } from './engine';

export interface SystemTelemetry {
  rssMemoryMB: number;
  heapUsedMB: number;
  uptimeSec: number;
  activeDownloads: number;
  totalThroughputMBps: number;
  platform: string;
  nodeVersion: string;
}

export interface CdnProbeResult {
  name: string;
  url: string;
  status: 'online' | 'unreachable' | 'degraded';
  latencyMs: number;
}

export interface DiagnosticBundle {
  timestamp: number;
  system: SystemTelemetry;
  cdnHealth: CdnProbeResult[];
  activeStreamsSummary: {
    totalChunks: number;
    activeChunks: number;
    completedChunks: number;
  };
}

export class DiagnosticsEngine {
  private engine: DownloadEngine;

  constructor(engine: DownloadEngine) {
    this.engine = engine;
  }

  public getSystemTelemetry(): SystemTelemetry {
    const mem = process.memoryUsage();
    const downloads = this.engine.getAllDownloads();
    const active = downloads.filter(d => d.status === 'downloading');
    const totalSpeedBytes = active.reduce((acc, d) => acc + (d.speedBps || 0), 0);

    return {
      rssMemoryMB: Math.round((mem.rss / (1024 * 1024)) * 100) / 100,
      heapUsedMB: Math.round((mem.heapUsed / (1024 * 1024)) * 100) / 100,
      uptimeSec: Math.floor(process.uptime()),
      activeDownloads: active.length,
      totalThroughputMBps: Math.round((totalSpeedBytes / (1024 * 1024)) * 100) / 100,
      platform: process.platform,
      nodeVersion: process.version,
    };
  }

  public async probeCdnLatency(target: { name: string; url: string }): Promise<CdnProbeResult> {
    const start = Date.now();
    try {
      const response = await fetch(target.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(4000),
      });
      const latencyMs = Date.now() - start;
      const status = response.ok ? 'online' : 'degraded';
      return { name: target.name, url: target.url, status, latencyMs };
    } catch {
      return { name: target.name, url: target.url, status: 'unreachable', latencyMs: Date.now() - start };
    }
  }

  public async generateDiagnosticBundle(mockProbes = false): Promise<DiagnosticBundle> {
    const sys = this.getSystemTelemetry();
    const downloads = this.engine.getAllDownloads();

    let totalChunks = 0;
    let activeChunks = 0;
    let completedChunks = 0;

    for (const d of downloads) {
      if (d.chunks) {
        totalChunks += d.chunks.length;
        activeChunks += d.chunks.filter(c => c.status === 'downloading').length;
        completedChunks += d.chunks.filter(c => c.status === 'done').length;
      }
    }

    let cdnHealth: CdnProbeResult[] = [];
    if (mockProbes) {
      cdnHealth = [
        { name: 'Google Global Edge', url: 'https://www.google.com/generate_204', status: 'online', latencyMs: 25 },
        { name: 'AWS CloudFront', url: 'https://aws.amazon.com', status: 'online', latencyMs: 38 },
      ];
    } else {
      const targets = [
        { name: 'Google Global Edge', url: 'https://www.google.com/generate_204' },
      ];
      for (const t of targets) {
        cdnHealth.push(await this.probeCdnLatency(t));
      }
    }

    return {
      timestamp: Date.now(),
      system: sys,
      cdnHealth,
      activeStreamsSummary: {
        totalChunks,
        activeChunks,
        completedChunks,
      },
    };
  }
}
