// Listen for Link Extraction Requests from Background Service Worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'EXTRACT_ALL_LINKS') {
    const elements = Array.from(document.querySelectorAll('a[href]'));
    const validLinks = elements
      .map(el => el.href)
      .filter(href => href.startsWith('http://') || href.startsWith('https://'));
    const unique = Array.from(new Set(validLinks));
    sendResponse({ links: unique });
  }
});

// Automatic Downloadable Media Inspection
function inspectPageMedia() {
  const mediaElements = Array.from(document.querySelectorAll('video[src], audio[src], a[download]'));
  if (mediaElements.length > 0) {
    // Media detection ready
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inspectPageMedia);
} else {
  inspectPageMedia();
}
