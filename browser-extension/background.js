const NDM_BRIDGE_URL = 'http://127.0.0.1:5005';
let bridgeToken = 'ndm_local_secret_token';

// ---------------------------------------------------------------------------
// Policy cache: refreshed from NDM settings so capture keys, per-browser
// toggles, context-menu items, and the in-page panel all react live to
// changes made in NDM's Options → Browser tab.
// ---------------------------------------------------------------------------
let policy = {
  forceKeys: [],
  preventKeys: [],
  showDownloadPanel: true,
  contextMenu: { downloadLink: true, downloadMedia: true, downloadAllLinks: true },
  browsers: {},
  autoInterceptDownloads: true,
};

// ---------------------------------------------------------------------------
// All-sites access is OPTIONAL. Core features (download interception, context
// menus) need no site access; the in-page panel, capture keys and cookie
// passthrough need "<all_urls>" + "cookies", which the user grants by clicking
// the toolbar action. When granted, the content script is registered
// dynamically instead of being declared in the manifest, so the extension
// stays inert on every page until the user opts in.
// ---------------------------------------------------------------------------
const ALL_SITES_ORIGIN = '<all_urls>';
const PAGE_SCRIPT_ID = 'ndm-page-integration';
const PAGE_SCRIPT = {
  id: PAGE_SCRIPT_ID,
  matches: [ALL_SITES_ORIGIN],
  js: ['content.js'],
  runAt: 'document_end'
};

async function hasAllSitesAccess() {
  try {
    return await chrome.permissions.contains({ origins: [ALL_SITES_ORIGIN], permissions: ['cookies'] });
  } catch (e) {
    return false;
  }
}

async function syncPageIntegration() {
  const granted = await hasAllSitesAccess();
  try {
    if (granted) {
      await chrome.scripting.registerContentScripts([PAGE_SCRIPT]);
    } else {
      await chrome.scripting.unregisterContentScripts({ ids: [PAGE_SCRIPT_ID] });
    }
  } catch (e) {} // duplicate registration / never-registered are both fine
  try {
    chrome.action.setBadgeText({ text: granted ? 'ON' : '' });
    chrome.action.setTitle({ title: granted
      ? 'NDM — enabled on all sites (click to disable)'
      : 'NDM — click to enable on all sites' });
  } catch (e) {}
  return granted;
}

// Toolbar icon = explicit opt-in/out for all-sites access (permissions.request
// requires a user gesture; the action click is one).
chrome.action.onClicked.addListener(async () => {
  if (await hasAllSitesAccess()) {
    try { await chrome.permissions.remove({ origins: [ALL_SITES_ORIGIN], permissions: ['cookies'] }); } catch (e) {}
  } else {
    try { await chrome.permissions.request({ origins: [ALL_SITES_ORIGIN], permissions: ['cookies'] }); } catch (e) {}
  }
  await syncPageIntegration();
});

chrome.permissions.onAdded.addListener(() => { syncPageIntegration(); });
chrome.permissions.onRemoved.addListener(() => { syncPageIntegration(); });

function detectBrowserName() {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'edge';
  if (/OPR\//.test(ua)) return 'opera';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\//.test(ua)) return 'chrome';
  return 'chrome';
}

const BROWSER_NAME = detectBrowserName();

async function refreshPolicy() {
  try {
    // browser= doubles as a heartbeat so NDM's Browser tab can show which
    // extensions are currently connected.
    const res = await fetch(`${NDM_BRIDGE_URL}/api/bridge/policy?browser=${encodeURIComponent(BROWSER_NAME)}`, {
      headers: { 'X-NDM-Token': bridgeToken },
    });
    if (res.ok) {
      policy = { ...policy, ...(await res.json()) };
    }
  } catch {
    // NDM not running: keep last known policy; capture attempts will fail
    // on connection anyway.
  }
  // Context-menu items follow the policy directly.
  rebuildContextMenus();
}

// ---------------------------------------------------------------------------
// Context menus: rebuilt from policy — items are customizable in NDM's
// Options → Browser → Context Menu.
// ---------------------------------------------------------------------------
function rebuildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    if (policy.contextMenu.downloadLink) {
      chrome.contextMenus.create({
        id: 'ndm-download-link',
        title: 'Download with NDM',
        contexts: ['link']
      });
    }
    if (policy.contextMenu.downloadMedia) {
      chrome.contextMenus.create({
        id: 'ndm-download-media',
        title: 'Download Media with NDM',
        contexts: ['image', 'video', 'audio']
      });
    }
    if (policy.contextMenu.downloadAllLinks) {
      chrome.contextMenus.create({
        id: 'ndm-download-page-links',
        title: 'Download all links with NDM',
        contexts: ['page']
      });
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  rebuildContextMenus();
  refreshPolicy();
  syncPageIntegration();
});

chrome.runtime.onStartup.addListener(() => {
  refreshPolicy();
  syncPageIntegration();
});

// MV3 service workers are ephemeral; poll on an alarm so menu/panel changes
// in NDM apply without reloading the extension. 2-minute cadence.
chrome.alarms.create('ndm-policy-poll', { periodInMinutes: 2 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ndm-policy-poll') refreshPolicy();
});
// Initial policy load (also covers browser restarts where onInstalled
// doesn't fire).
refreshPolicy();
// Re-sync content-script registration + badge on every service-worker cold
// start (MV3 workers are ephemeral; registered content scripts persist).
syncPageIntegration();

// Keep the in-page panel's policy fresh and answer its questions.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_POLICY') {
    sendResponse({ policy, browserName: BROWSER_NAME });
    return false;
  }
  if (msg?.type === 'CAPTURE_URL') {
    sendToNDM(msg.url, msg.referrer, msg.filename, msg.heldKeys || []).then((ok) => sendResponse({ ok }));
    return true; // async response
  }
  return false;
});

// Handle Context Menu Clicks
// Context menus carry no modifier state; menu sends are treated as explicit
// user intent, so capture keys don't apply to them.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'ndm-download-link' && info.linkUrl) {
    await sendToNDM(info.linkUrl, tab?.url);
  } else if (info.menuItemId === 'ndm-download-media' && info.srcUrl) {
    await sendToNDM(info.srcUrl, tab?.url);
  } else if (info.menuItemId === 'ndm-download-page-links') {
    const links = await collectPageLinks(tab);
    if (links.length === 0) return;
    for (const link of links) {
      await sendToNDM(link, tab.url);
      await new Promise((r) => setTimeout(r, 120));
    }
  }
});

async function collectPageLinks(tab) {
  if (!tab?.id) return [];
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const out = new Set();
        for (const a of document.querySelectorAll('a[href]')) {
          try {
            const u = new URL(a.href, location.href);
            if (/^https?:$/.test(u.protocol)) out.add(u.href);
          } catch {}
        }
        return Array.from(out).slice(0, 100);
      },
    });
    return (results && results[0] && results[0].result) || [];
  } catch {
    return [];
  }
}

// Intercept browser downloads and hand them to the NDM engine.
chrome.downloads.onDeterminingFilename.addListener(async (downloadItem, suggest) => {
  // Let the browser continue naming; we only mirror the download into NDM.
  suggest({ filename: downloadItem.filename });
  const success = await sendToNDM(
    downloadItem.url,
    downloadItem.referrer,
    downloadItem.filename
  );
  if (success) {
    try { chrome.downloads.cancel(downloadItem.id); } catch (e) {}
  }
});

async function sendToNDM(url, referrer, filename, heldKeys) {
  try {
    // Per-browser kill switch: skip immediately when this browser's capture
    // is disabled in NDM settings (saves the round-trip).
    if (policy.browsers && policy.browsers[BROWSER_NAME] === false) {
      return false;
    }

    // Capture session credentials for the target URL so cookie-gated and
    // signed downloads work in NDM. Cookies are forwarded over the local
    // loopback bridge only and stay host-scoped inside the engine.
    let cookies;
    let userAgent;
    try {
      if (chrome.cookies && url.startsWith('http')) {
        const jar = await chrome.cookies.getAll({ url });
        if (jar && jar.length > 0) {
          cookies = jar.map(c => `${c.name}=${c.value}`).join('; ');
        }
      }
    } catch (e) {
      // Cookies permission missing or URL not cookie-eligible: proceed without.
    }
    try {
      userAgent = navigator.userAgent;
    } catch (e) {}

    const res = await fetch(`${NDM_BRIDGE_URL}/api/bridge/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NDM-Token': bridgeToken
      },
      body: JSON.stringify({
        url,
        referrer,
        filename,
        cookies,
        userAgent,
        heldKeys: Array.isArray(heldKeys) ? heldKeys : [],
        browserName: BROWSER_NAME,
        source: 'browser_extension'
      })
    });
    return res.ok;
  } catch (err) {
    console.warn('[NDM Extension] Bridge connection failed:', err);
    return false;
  }
}
