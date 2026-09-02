import { DownloadItem } from './types';

export interface HistoryFilter {
  query?: string;
  status?: string;
  category?: string;
  startDate?: number;
  endDate?: number;
}

export interface ImportedDownload {
  url: string;
  filename?: string;
  destinationFolder?: string;
  category?: string;
  connections?: number;
}

export class HistoryExportEngine {
  public filterHistory(items: DownloadItem[], filter: HistoryFilter): DownloadItem[] {
    return items.filter(item => {
      if (filter.status && filter.status !== 'all' && item.status !== filter.status) {
        return false;
      }
      if (filter.category && filter.category !== 'all' && item.category !== filter.category) {
        return false;
      }
      if (filter.startDate && item.createdAt < filter.startDate) {
        return false;
      }
      if (filter.endDate && item.createdAt > filter.endDate) {
        return false;
      }
      if (filter.query) {
        const q = filter.query.toLowerCase();
        const matchesName = item.filename?.toLowerCase().includes(q);
        const matchesUrl = item.url.toLowerCase().includes(q);
        if (!matchesName && !matchesUrl) return false;
      }
      return true;
    });
  }

  public exportToCsv(items: DownloadItem[]): string {
    const headers = ['ID', 'Filename', 'URL', 'Status', 'TotalBytes', 'DownloadedBytes', 'Category', 'CreatedAt', 'CompletedAt'];
    const rows = items.map(i => [
      i.id,
      `"${(i.filename || '').replace(/"/g, '""')}"`,
      `"${i.url.replace(/"/g, '""')}"`,
      i.status,
      i.totalBytes,
      i.downloadedBytes,
      i.category || 'other',
      new Date(i.createdAt).toISOString(),
      i.completedAt ? new Date(i.completedAt).toISOString() : '',
    ]);
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  public exportToJson(items: DownloadItem[]): string {
    return JSON.stringify(items, null, 2);
  }

  public exportToTxt(items: DownloadItem[]): string {
    return items.map(i => i.url).join('\n');
  }

  public exportToEf2(items: DownloadItem[]): string {
    // IDM Export File Format (.ef2)
    return items.map(i => {
      return `<\n${i.url}\nfile: ${i.filename || ''}\nfilepath: ${i.destinationPath || ''}\n>`;
    }).join('\n');
  }

  public importFromTxt(content: string): ImportedDownload[] {
    const lines = content.split(/\r?\n/);
    const results: ImportedDownload[] = [];
    const urlRegex = /^https?:\/\/[^\s]+$/i;

    for (const raw of lines) {
      const line = raw.trim();
      if (line && urlRegex.test(line)) {
        results.push({ url: line });
      }
    }
    return results;
  }

  public importFromJson(content: string): ImportedDownload[] {
    try {
      const parsed = JSON.parse(content);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list
        .filter(item => item && typeof item.url === 'string' && item.url.startsWith('http'))
        .map(item => ({
          url: item.url.trim(),
          filename: item.filename,
          destinationFolder: item.destinationFolder || item.destinationPath,
          category: item.category,
          connections: item.connections,
        }));
    } catch {
      return [];
    }
  }

  public importFromEf2(content: string): ImportedDownload[] {
    const results: ImportedDownload[] = [];
    const blocks = content.split('<');

    for (const block of blocks) {
      const clean = block.replace('>', '').trim();
      if (!clean) continue;
      const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        const url = lines[0];
        if (url.startsWith('http')) {
          let filename: string | undefined;
          let destinationFolder: string | undefined;

          for (const line of lines.slice(1)) {
            if (line.toLowerCase().startsWith('file:')) {
              filename = line.slice(5).trim();
            } else if (line.toLowerCase().startsWith('filepath:')) {
              destinationFolder = line.slice(9).trim();
            }
          }

          results.push({ url, filename, destinationFolder });
        }
      }
    }
    return results;
  }
}
