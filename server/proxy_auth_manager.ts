import { EventEmitter } from 'events';

export type ProxyType = 'http' | 'https' | 'socks4' | 'socks5';
export type AuthType = 'basic' | 'bearer' | 'cookie' | 'custom';

export interface ProxyConfig {
  enabled: boolean;
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
  bypassHosts?: string[];
}

export interface SiteCredential {
  id: string;
  domain: string;
  authType: AuthType;
  username?: string;
  password?: string;
  token?: string;
  cookies?: string;
  customHeaders?: Record<string, string>;
}

export const USER_AGENT_PRESETS: Record<string, string> = {
  chrome_windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  firefox_windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  edge_windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  safari_mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  downloader_native: 'Mozilla/5.0 (compatible; NDMDownloader/2.0; +https://nogadex.org)',
};

export class ProxyAuthManager extends EventEmitter {
  private globalProxy: ProxyConfig = {
    enabled: false,
    type: 'http',
    host: '127.0.0.1',
    port: 8080,
    bypassHosts: ['localhost', '127.0.0.1'],
  };

  private siteCredentials: Map<string, SiteCredential> = new Map();

  public setGlobalProxy(config: Partial<ProxyConfig>): void {
    this.globalProxy = { ...this.globalProxy, ...config };
    this.emit('proxyUpdated', this.globalProxy);
  }

  public getGlobalProxy(): ProxyConfig {
    return { ...this.globalProxy };
  }

  public addCredential(cred: SiteCredential): void {
    this.siteCredentials.set(cred.domain.toLowerCase(), cred);
    this.emit('credentialUpdated', cred);
  }

  public removeCredential(domain: string): boolean {
    const res = this.siteCredentials.delete(domain.toLowerCase());
    if (res) this.emit('credentialRemoved', domain);
    return res;
  }

  public getCredentials(): SiteCredential[] {
    return Array.from(this.siteCredentials.values());
  }

  public shouldBypassProxy(url: string): boolean {
    if (!this.globalProxy.enabled) return true;
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const bypassList = this.globalProxy.bypassHosts || [];
      return bypassList.some(b => {
        const cleanB = b.toLowerCase().trim();
        if (cleanB.startsWith('*.')) {
          const root = cleanB.slice(2);
          return hostname === root || hostname.endsWith('.' + root);
        }
        return hostname === cleanB || hostname.endsWith('.' + cleanB);
      });
    } catch {
      return true;
    }
  }

  public resolveHeadersForUrl(url: string, userAgentPreset = 'chrome_windows'): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT_PRESETS[userAgentPreset] || USER_AGENT_PRESETS.chrome_windows,
    };

    try {
      const hostname = new URL(url).hostname.toLowerCase();
      let matchedCred: SiteCredential | undefined;

      for (const [domain, cred] of this.siteCredentials.entries()) {
        if (hostname === domain || hostname.endsWith('.' + domain)) {
          matchedCred = cred;
          break;
        }
      }

      if (matchedCred) {
        if (matchedCred.authType === 'basic' && matchedCred.username && matchedCred.password) {
          const authStr = Buffer.from(`${matchedCred.username}:${matchedCred.password}`).toString('base64');
          headers['Authorization'] = `Basic ${authStr}`;
        } else if (matchedCred.authType === 'bearer' && matchedCred.token) {
          headers['Authorization'] = `Bearer ${matchedCred.token}`;
        } else if (matchedCred.authType === 'cookie' && matchedCred.cookies) {
          headers['Cookie'] = matchedCred.cookies;
        }

        if (matchedCred.customHeaders) {
          Object.assign(headers, matchedCred.customHeaders);
        }
      }
    } catch {}

    return headers;
  }
}
