/**
 * Dynamic API & WebSocket URL resolver for dual web / native electron environments
 */

/** Shared local bridge token — required by every /api route and the /ws endpoint. */
export const NDM_LOCAL_TOKEN = 'ndm_local_secret_token';

export const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined' && (window.location.protocol === 'file:' || (window as any).electronAPI?.isNative)) {
    return 'http://127.0.0.1:5005';
  }
  return '';
};

export const getWsUrl = (): string => {
  if (typeof window !== 'undefined' && (window.location.protocol === 'file:' || (window as any).electronAPI?.isNative)) {
    return `ws://127.0.0.1:5005/ws?token=${NDM_LOCAL_TOKEN}`;
  }
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof window !== 'undefined' && window.location.host ? window.location.host : '127.0.0.1:5005';
  return `${protocol}//${host}/ws?token=${NDM_LOCAL_TOKEN}`;
};
