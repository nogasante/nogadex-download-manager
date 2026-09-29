/**
 * Error-reason → help-guide mapping.
 *
 * The engine already humanizes error messages (see server/engine.ts
 * humanizeError), so we classify on stable substrings of those human
 * sentences plus the raw Node error codes that slip through. UI-only:
 * no engine changes, purely picking which guide the "Get help" link opens.
 */

export type ErrorHelpCategory =
  | 'auth' // server said no / login expired / bot-blocked
  | 'notfound' // file gone (404/410)
  | 'network' // dropped, timed out, refused, DNS
  | 'other';

export interface ErrorHelpInfo {
  /** Guide id in HelpCenterDialog's GUIDES array. */
  guideId: string;
  /** Tooltip shown on the "Get help" link. */
  title: string;
}

/** Guide ids must match HelpCenterDialog's GUIDES. */
const CATEGORY_GUIDES: Record<ErrorHelpCategory, ErrorHelpInfo> = {
  auth: {
    guideId: 'logins',
    title: 'Open the logins & refresh link guide',
  },
  notfound: {
    guideId: 'logins',
    title: 'Open the logins & refresh link guide',
  },
  network: {
    guideId: 'pause-resume',
    title: 'Open the pause, resume & retry guide',
  },
  other: {
    guideId: 'pause-resume',
    title: 'Open the pause, resume & retry guide',
  },
};

/** Substring patterns tested (case-insensitive) against the raw error text. */
const AUTH_PATTERNS = [
  '403',
  '401',
  '407',
  'authorization expired',
  'server refused',
  'forbidden',
  'unauthorized',
  'paywall',
  'login',
  'sign in',
  'sign-in',
  'cookie',
  'proxy authentication',
];

const NOTFOUND_PATTERNS = ['404', '410', 'file not found', 'not found on remote'];

const NETWORK_PATTERNS = [
  'econnrefused',
  'econnreset',
  'econnaborted',
  'etimedout',
  'timeout',
  'timed out',
  'enotfound',
  'eai_again',
  'epipe',
  'ehostunreach',
  'enetunreach',
  'socket hang up',
  'connection dropped',
  'connection reset',
  'connection refused',
  'reconnect',
  'network',
  'dns',
  'internet connection',
];

/** Classify a failed download's error text. Exported for tests. */
export function classifyErrorHelp(raw?: string | null): ErrorHelpCategory {
  const text = (raw || '').toLowerCase();
  if (!text) return 'other';

  // Most specific first: a 404 must not be swallowed by broader patterns.
  if (NOTFOUND_PATTERNS.some((p) => text.includes(p))) return 'notfound';
  if (AUTH_PATTERNS.some((p) => text.includes(p))) return 'auth';
  if (NETWORK_PATTERNS.some((p) => text.includes(p))) return 'network';

  return 'other';
}

/** Pick the guide the "Get help" link should open for this error. */
export function pickHelpGuideForError(raw?: string | null): ErrorHelpInfo {
  return CATEGORY_GUIDES[classifyErrorHelp(raw)];
}
