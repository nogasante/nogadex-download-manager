/**
 * Central app particulars, loaded from site/app-config.json.
 *
 * The JSON file is (a) baked into the build as offline defaults and (b)
 * fetched at runtime (by the server) so links/contact/site URL can be
 * updated by editing one file in the repo — no app rebuild needed.
 *
 * Remote sources, tried in order:
 *   1. site.baseUrl from the baked config (set once the site is on Vercel)
 *   2. raw.githubusercontent.com (works today, no domain required)
 */
import baked from '../site/app-config.json';

export interface NdmAppConfig {
  configVersion: number;
  site: { baseUrl: string };
  branding: { appName: string; shortName: string; company: string };
  github: {
    owner: string;
    repo: string;
    branch: string;
    repoUrl: string;
    releasesUrl: string;
    issuesUrl: string;
    newIssueUrl: string;
    licenseUrl: string;
  };
  contact: { email: string; subjectPrefix: string };
  links: { signPath: string; signPathFoundation: string };
}

/** Defaults baked at build time; always available (offline, first boot). */
export const BAKED_APP_CONFIG: NdmAppConfig = baked as NdmAppConfig;

export const rawConfigUrl = (cfg: NdmAppConfig = BAKED_APP_CONFIG): string =>
  `https://raw.githubusercontent.com/${cfg.github.owner}/${cfg.github.repo}/${cfg.github.branch}/site/app-config.json`;

export const siteConfigUrl = (cfg: NdmAppConfig = BAKED_APP_CONFIG): string => {
  const base = cfg.site.baseUrl.replace(/\/+$/, '');
  return base ? `${base}/app-config.json` : '';
};

const CONFIG_TTL_MS = 24 * 60 * 60 * 1000; // re-fetch at most once a day
const FETCH_TIMEOUT_MS = 8000;

let remoteConfig: NdmAppConfig | null = null;
let lastFetchAt = 0;
let refreshInFlight: Promise<NdmAppConfig> | null = null;

/** Shape check: never trust remote JSON blindly; fall back on any doubt. */
const looksValid = (v: unknown): v is NdmAppConfig => {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<NdmAppConfig>;
  return !!(
    c.github && typeof c.github.repoUrl === 'string' && c.github.repoUrl.startsWith('https://') &&
    c.contact && typeof c.contact.email === 'string' && c.contact.email.includes('@') &&
    c.branding && typeof c.branding.appName === 'string' &&
    c.site && typeof c.site.baseUrl === 'string' &&
    c.links && typeof c.links.signPath === 'string'
  );
};

const fetchJson = async (url: string): Promise<NdmAppConfig> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      // Never let a proxy or the browser cache pin stale config
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: unknown = await res.json();
    if (!looksValid(json)) throw new Error('Invalid config shape');
    return json;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Fetch remote config once per TTL. Tries the (future) site URL first, then
 * GitHub raw. On failure the previous value (or baked defaults) stays in use.
 */
export const refreshAppConfig = async (force = false): Promise<NdmAppConfig> => {
  const now = Date.now();
  if (!force && remoteConfig && now - lastFetchAt < CONFIG_TTL_MS) return remoteConfig;
  if (refreshInFlight) return refreshInFlight;

  const bakedCfg = BAKED_APP_CONFIG;
  const candidates = [siteConfigUrl(bakedCfg), rawConfigUrl(bakedCfg)].filter(Boolean);

  refreshInFlight = (async () => {
    for (const url of candidates) {
      try {
        const cfg = await fetchJson(url);
        // A stale site file must not let the site URL pointer rot
        remoteConfig = cfg.site.baseUrl ? cfg : { ...cfg, site: { baseUrl: bakedCfg.site.baseUrl } };
        lastFetchAt = Date.now();
        return remoteConfig;
      } catch {
        // try next source
      }
    }
    lastFetchAt = Date.now(); // avoid hammering when offline
    return remoteConfig || bakedCfg;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
};

/** Config for rendering: remote if loaded, otherwise baked defaults. */
export const getAppConfig = (): NdmAppConfig => remoteConfig || BAKED_APP_CONFIG;

/** Fire-and-forget warm-up so the first UI read usually has remote data. */
export const warmAppConfig = (): void => {
  void refreshAppConfig().catch(() => {});
};
