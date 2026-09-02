const NOGADEX_BRIDGE_URL = 'http://127.0.0.1:5005';
let bridgeToken = 'nogadex_local_secret_token';

// Context Menus Initialization
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'nogadex-download-link',
    title: 'Download with Nogadex',
    contexts: ['link']
  });

  chrome.contextMenus.create({
    id: 'nogadex-download-media',
    title: 'Download Media with Nogadex',
    contexts: ['image', 'video', 'audio']
  });

  chrome.contextMenus.create({
    id: 'nogadex-download-page-links',
    title: 'Download all links with Nogadex',
    contexts: ['page']
  });
});

// Handle Context Menu Clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'nogadex-download-link' && info.linkUrl) {
    await sendToNogadex(info.linkUrl, tab?.url);
  } else if (info.menuItemId === 'nogadex-download-media' && info.srcUrl) {
    await sendToNogadex(info.srcUrl, tab?.url);
  } else if (info.menuItemId === 'nogadex-download-page-links' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_ALL_LINKS' }, async (response) => {
      if (response && response.links && response.links.length > 0) {
        for (const link of response.links) {
          await sendToNogadex(link, tab.url);
        }
      }
    });
  }
});

// Intercept Native Browser Downloads
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  if (downloadItem.url.startsWith('blob:') || downloadItem.url.startsWith('data:')) {
    return; // Skip inline objects
  }

  // Check if extension takeover is enabled in storage
  const settings = await chrome.storage.local.get(['takeoverEnabled']);
  if (settings.takeoverEnabled === false) return;

  // Intercept and send to Nogadex Engine
  const success = await sendToNogadex(downloadItem.url, downloadItem.referrer, downloadItem.filename);
  if (success) {
    try {
      chrome.downloads.cancel(downloadItem.id);
      chrome.downloads.erase({ id: downloadItem.id });
    } catch (e) {}
  }
});

async function sendToNogadex(url, referrer, filename) {
  try {
    const res = await fetch(`${NOGADEX_BRIDGE_URL}/api/bridge/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nogadex-Token': bridgeToken
      },
      body: JSON.stringify({
        url,
        referrer,
        filename,
        source: 'browser_extension'
      })
    });
    return res.ok;
  } catch (err) {
    console.warn('[Nogadex Extension] Bridge connection failed:', err);
    return false;
  }
}
