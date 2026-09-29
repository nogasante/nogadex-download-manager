// ---------------------------------------------------------------------------
// NDM in-page integration: floating download panel + capture-key reporting.
//
// The panel lists media/links on the page with one-click "send to NDM".
// Visibility is policy-driven (NDM Options → Browser → "Show in-page
// download panel") and the panel asks the background worker for fresh
// policy on load and on extension message.
// ---------------------------------------------------------------------------

(() => {
  if (window.__ndmContentLoaded) return;
  window.__ndmContentLoaded = true;

  let policy = null;
  let panel = null;
  let panelMinimized = false;

  // ---- policy plumbing -----------------------------------------------------
  function askPolicy() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_POLICY' }, (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function captureKeyHeld(e) {
    const held = [];
    if (e.altKey) held.push('alt');
    if (e.ctrlKey) held.push('ctrl');
    if (e.shiftKey) held.push('shift');
    if (e.metaKey) held.push('meta');
    return held;
  }

  // Track held modifier keys globally so plain clicks (not just keydown
  // combos) can carry capture-key state to the engine.
  let liveKeys = new Set();
  function syncKeys(e) {
    liveKeys = new Set(captureKeyHeld(e));
  }
  window.addEventListener('keydown', syncKeys, true);
  window.addEventListener('keyup', syncKeys, true);
  window.addEventListener('mousedown', syncKeys, true);

  async function sendToNdm(url, filename, heldKeys) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'CAPTURE_URL', url, referrer: location.href, filename, heldKeys: heldKeys || Array.from(liveKeys) },
          (res) => resolve(!chrome.runtime.lastError && !!res?.ok)
        );
      } catch {
        resolve(false);
      }
    });
  }

  // ---- media/link discovery -------------------------------------------------
  function discoverMedia() {
    const items = [];
    const seen = new Set();
    const push = (url, label, kind) => {
      if (!url || !/^https?:/i.test(url) || seen.has(url)) return;
      seen.add(url);
      items.push({ url, label: label || decodeURIComponent(url.split('/').pop() || url), kind });
    };
    for (const v of document.querySelectorAll('video[src], video > source[src]')) push(v.src, v.getAttribute('data-title'), 'video');
    for (const a of document.querySelectorAll('audio[src], audio > source[src]')) push(a.src, a.getAttribute('data-title'), 'audio');
    for (const img of document.querySelectorAll('img[src]')) {
      const r = img.getBoundingClientRect();
      if (r.width >= 200 && r.height >= 200) push(img.src, img.alt, 'image');
    }
    for (const a of document.querySelectorAll('a[download], a[href$=".zip"], a[href$=".rar"], a[href$=".7z"], a[href$=".exe"], a[href$=".msi"], a[href$=".pdf"], a[href$=".mp4"], a[href$=".mkv"], a[href$=".iso"]')) {
      push(a.href, a.textContent?.trim().slice(0, 60), 'file');
    }
    return items.slice(0, 12);
  }

  // ---- panel ----------------------------------------------------------------
  function buildPanel() {
    if (panel || !policy?.policy?.showDownloadPanel) return;
    const items = discoverMedia();
    if (items.length === 0) return;

    panel = document.createElement('div');
    panel.id = 'ndm-download-panel';
    panel.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483646',
      'width:320px', 'background:#171717', 'color:#e5e5e5',
      'border:1px solid #404040', 'border-radius:6px',
      'font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif',
      'box-shadow:0 8px 24px rgba(0,0,0,.4)', 'overflow:hidden'
    ].join(';');

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#262626;cursor:move;user-select:none';
    head.innerHTML = `
      <span style="font-weight:600;font-size:12px">NDM — ${items.length} downloadable item${items.length === 1 ? '' : 's'}</span>
      <span style="display:flex;gap:6px">
        <button data-act="min" style="all:unset;cursor:pointer;padding:0 4px" title="Minimize">—</button>
        <button data-act="close" style="all:unset;cursor:pointer;padding:0 4px" title="Close">×</button>
      </span>`;

    const body = document.createElement('div');
    body.style.cssText = 'max-height:240px;overflow-y:auto';
    for (const it of items) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid #262626';
      const label = document.createElement('span');
      label.textContent = `${it.kind === 'video' ? '▶' : it.kind === 'audio' ? '♪' : it.kind === 'image' ? '🖼' : '📄'} ${it.label}`;
      label.title = it.url;
      label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const btn = document.createElement('button');
      btn.textContent = 'NDM';
      btn.title = 'Download with NDM (hold your force-capture keys to override rules)';
      btn.style.cssText = 'all:unset;cursor:pointer;background:#2563eb;color:#fff;font-size:10.5px;padding:2px 8px;border-radius:3px';
      btn.onclick = async (e) => {
        e.stopPropagation();
        btn.textContent = '…';
        const ok = await sendToNdm(it.url, it.filename || undefined, captureKeyHeld(e));
        btn.textContent = ok ? '✓' : '✗';
        setTimeout(() => { btn.textContent = 'NDM'; }, 1500);
      };
      row.append(label, btn);
      body.appendChild(row);
    }

    panel.append(head, body);
    document.documentElement.appendChild(panel);

    // Drag + collapse behavior
    let dragging = null;
    head.addEventListener('mousedown', (e) => {
      if ((e.target.dataset?.act)) return;
      const r = panel.getBoundingClientRect();
      dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging || !panel) return;
      panel.style.left = Math.max(0, e.clientX - dragging.dx) + 'px';
      panel.style.top = Math.max(0, e.clientY - dragging.dy) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => { dragging = null; });
    head.querySelector('[data-act="close"]').onclick = () => { panel?.remove(); panel = null; };
    head.querySelector('[data-act="min"]').onclick = () => {
      panelMinimized = !panelMinimized;
      body.style.display = panelMinimized ? 'none' : '';
    };
  }

  function destroyPanel() {
    panel?.remove();
    panel = null;
  }

  // React to policy: show/hide the panel accordingly.
  async function applyPolicy() {
    policy = await askPolicy();
    if (policy?.policy?.showDownloadPanel) buildPanel();
    else destroyPanel();
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'POLICY_REFRESH') {
      applyPolicy();
      sendResponse({ ok: true });
    }
    if (msg?.action === 'EXTRACT_ALL_LINKS') {
      const elements = Array.from(document.querySelectorAll('a[href]'));
      const validLinks = elements.map(el => el.href).filter(h => /^https?:/i.test(h));
      sendResponse({ links: Array.from(new Set(validLinks)) });
    }
    return false;
  });

  // Boot: wait for the page to settle, then apply policy and (re)scan as the
  // DOM changes — media sites inject players late.
  const boot = () => setTimeout(applyPolicy, 400);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  let scanTimer = null;
  const mo = new MutationObserver(() => {
    if (!policy?.policy?.showDownloadPanel || panel) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => { if (policy?.policy?.showDownloadPanel) buildPanel(); }, 1500);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
