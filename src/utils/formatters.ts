/**
 * Unified Formatting Utilities for Nogadex Download Manager (NDM)
 */

/**
 * Format bytes into human-readable file size (B, KB, MB, GB, TB)
 * @param bytes Number of bytes
 * @param detailed If true, includes the exact byte count in parentheses
 */
export function formatSize(bytes: number, detailed: boolean = false): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) {
    return detailed ? '0 KB (0 bytes)' : '0 B';
  }

  const k = 1024;
  const m = k * k;
  const g = m * k;

  if (bytes < k) {
    return detailed ? `${bytes} B (${bytes.toLocaleString()} bytes)` : `${bytes} B`;
  }
  if (bytes < m) {
    const kb = (bytes / k).toFixed(1);
    return detailed ? `${kb} KB (${bytes.toLocaleString()} bytes)` : `${kb} KB`;
  }
  if (bytes < g) {
    const mb = (bytes / m).toFixed(2);
    return detailed ? `${mb} MB (${bytes.toLocaleString()} bytes)` : `${mb} MB`;
  }

  const gb = (bytes / g).toFixed(2);
  return detailed ? `${gb} GB (${bytes.toLocaleString()} bytes)` : `${gb} GB`;
}

/**
 * Format transfer rate in bits/bytes per second
 * @param bps Bytes per second
 */
export function formatSpeed(bps?: number): string {
  if (!bps || isNaN(bps) || bps <= 0) return '0.00 KB/s';
  const mbps = bps / (1024 * 1024);
  if (mbps >= 1) return `${mbps.toFixed(2)} MB/s`;
  return `${(bps / 1024).toFixed(2)} KB/s`;
}

/**
 * Format estimated time remaining in seconds to human-readable string
 * @param sec Estimated remaining seconds
 */
export function formatEta(sec?: number): string {
  if (!sec || isNaN(sec) || sec <= 0 || !isFinite(sec)) return '--';
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = Math.floor(sec % 60);

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Calculate download percentage (0 to 100)
 */
export function formatPercentage(downloaded: number, total: number, decimals: number = 0): number {
  if (!total || total <= 0 || !downloaded || downloaded <= 0) return 0;
  const pct = Math.min(100, (downloaded / total) * 100);
  if (decimals === 0) return Math.round(pct);
  const factor = Math.pow(10, decimals);
  return Math.round(pct * factor) / factor;
}

/**
 * Format timestamp to localized Windows Explorer style date and time
 */
export function formatDateTime(timestamp?: number | string | Date): string {
  const d = timestamp ? new Date(timestamp) : new Date();
  if (isNaN(d.getTime())) return '--';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
