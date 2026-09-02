import { EventEmitter } from 'events';

export type DomainScope = 'same_host' | 'subdomains' | 'any';

export interface SiteGrabberConfig {
  startUrl: string;
  maxDepth: number;
  domainScope: DomainScope;
  fileCategories: string[]; // ['pictures', 'video', 'audio', 'documents', 'archives', 'all']
  customExtensions?: string[];
  ignorePatterns?: string[];
  maxAssets?: number;
}

export interface GrabbedAsset {
  url: string;
  filename: string;
  category: string;
  foundOnPage: string;
  depth: number;
  sizeBytes?: number;
}

export class SiteGrabberEngine extends EventEmitter {
  private categoryExts: Record<string, string[]> = {
    pictures: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'],
    audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
    video: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv'],
    documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub'],
    archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso'],
  };

  public extractAssetsFromHtml(html: string, pageUrl: string, depth: number, config: SiteGrabberConfig): { assets: GrabbedAsset[]; nextPages: string[] } {
    const assets: GrabbedAsset[] = [];
    const nextPages: string[] = [];
    const seenUrls = new Set<string>();

    const hrefRegex = /href=["']([^"']+)["']/gi;
    const srcRegex = /src=["']([^"']+)["']/gi;

    const findCandidates = (regex: RegExp) => {
      let match;
      while ((match = regex.exec(html)) !== null) {
        const raw = match[1].trim();
        if (raw.startsWith('javascript:') || raw.startsWith('#') || raw.startsWith('mailto:')) continue;
        try {
          const resolved = new URL(raw, pageUrl).toString();
          if (!seenUrls.has(resolved)) {
            seenUrls.add(resolved);
            this.categorizeCandidate(resolved, pageUrl, depth, config, assets, nextPages);
          }
        } catch {}
      }
    };

    findCandidates(hrefRegex);
    findCandidates(srcRegex);

    return { assets, nextPages };
  }

  public isAllowedDomain(url: string, baseDomainUrl: string, scope: DomainScope): boolean {
    try {
      const uHost = new URL(url).hostname.toLowerCase();
      const bHost = new URL(baseDomainUrl).hostname.toLowerCase();

      if (scope === 'any') return true;
      if (scope === 'same_host') return uHost === bHost;
      if (scope === 'subdomains') {
        return uHost === bHost || uHost.endsWith('.' + bHost);
      }
    } catch {}
    return false;
  }

  private categorizeCandidate(
    url: string,
    pageUrl: string,
    depth: number,
    config: SiteGrabberConfig,
    assets: GrabbedAsset[],
    nextPages: string[]
  ): void {
    if (!this.isAllowedDomain(url, config.startUrl, config.domainScope)) {
      return;
    }

    // Ignore pattern check
    if (config.ignorePatterns) {
      for (const pattern of config.ignorePatterns) {
        try {
          if (new RegExp(pattern, 'i').test(url)) return;
        } catch {}
      }
    }

    const ext = this.extractExtension(url);
    const category = this.matchCategory(ext, config);

    if (category) {
      assets.push({
        url,
        filename: this.extractFilename(url),
        category,
        foundOnPage: pageUrl,
        depth,
      });
    } else if (this.isHtmlPage(url, ext)) {
      nextPages.push(url);
    }
  }

  private matchCategory(ext: string, config: SiteGrabberConfig): string | null {
    if (!ext) return null;
    const cleanExt = ext.toLowerCase();

    // Check custom extensions
    if (config.customExtensions && config.customExtensions.includes(cleanExt)) {
      return 'custom';
    }

    if (config.fileCategories.includes('all')) {
      for (const [cat, exts] of Object.entries(this.categoryExts)) {
        if (exts.includes(cleanExt)) return cat;
      }
      return 'other';
    }

    for (const cat of config.fileCategories) {
      if (this.categoryExts[cat] && this.categoryExts[cat].includes(cleanExt)) {
        return cat;
      }
    }

    return null;
  }

  private isHtmlPage(url: string, ext: string): boolean {
    if (!ext || ext === 'html' || ext === 'htm' || ext === 'php' || ext === 'asp' || ext === 'aspx') {
      return true;
    }
    return false;
  }

  private extractExtension(url: string): string {
    try {
      const clean = url.split('?')[0].split('#')[0];
      const basename = clean.substring(clean.lastIndexOf('/') + 1);
      const dotIndex = basename.lastIndexOf('.');
      if (dotIndex > 0 && dotIndex < basename.length - 1) {
        return basename.slice(dotIndex + 1);
      }
    } catch {}
    return '';
  }

  private extractFilename(url: string): string {
    try {
      const clean = url.split('?')[0].split('#')[0];
      return clean.substring(clean.lastIndexOf('/') + 1) || 'file';
    } catch {
      return 'file';
    }
  }
}
