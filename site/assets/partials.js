/* Shared page partials — the nav is the app's Toolbar: a neutral-100 strip of
   stacked 3D icon-over-label command buttons. Footer is the site's own. */
'use strict';

/* 3D command icons — same glossy, gradient-and-outline style as the app's
   Icons3D set. 48x48 viewBox, drawn inline so no assets are needed. */
const ICONS = {
  home: `
<svg class="c3d" viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
  <defs>
    <linearGradient id="g3d-home-roof" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8ecbf7"/><stop offset=".5" stop-color="#2f7fc4"/><stop offset="1" stop-color="#0d5a9c"/>
    </linearGradient>
    <linearGradient id="g3d-home-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c3d8ec"/>
    </linearGradient>
  </defs>
  <path d="M24 5 45 25 H38 V42.5 A1.5 1.5 0 0 1 36.5 44 H11.5 A1.5 1.5 0 0 1 10 42.5 V25 H3 Z"
        fill="url(#g3d-home-body)" stroke="#35506b" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M24 5 45 25 H36.5 L24 13.5 L11.5 25 H3 Z"
        fill="url(#g3d-home-roof)" stroke="#35506b" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M20.5 44 V31 a2 2 0 0 1 2-2 h3 a2 2 0 0 1 2 2 v13 Z"
        fill="url(#g3d-home-roof)" stroke="#0d5a9c" stroke-width="1"/>
  <ellipse cx="19" cy="11.5" rx="9" ry="3" fill="#ffffff" opacity=".35" transform="rotate(-43 19 11.5)"/>
</svg>`,
  download: `
<svg class="c3d" viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
  <defs>
    <linearGradient id="g3d-dl-arrow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8ef0a4"/><stop offset=".5" stop-color="#2fbf5e"/><stop offset="1" stop-color="#157a37"/>
    </linearGradient>
    <linearGradient id="g3d-dl-tray" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e8eef4"/><stop offset="1" stop-color="#93a5b8"/>
    </linearGradient>
  </defs>
  <rect x="20.5" y="4" width="7" height="15" rx="1.5" fill="url(#g3d-dl-arrow)" stroke="#0f6b2d" stroke-width="1.2"/>
  <path d="M13.5 18.5 H34.5 L24 30.5 Z" fill="url(#g3d-dl-arrow)" stroke="#0f6b2d" stroke-width="1.2" stroke-linejoin="round"/>
  <rect x="22" y="6" width="1.8" height="11" rx=".9" fill="#ffffff" opacity=".55"/>
  <path d="M6 30 H14 L18 34 H30 L34 30 H42 V40 A3 3 0 0 1 39 43 H9 A3 3 0 0 1 6 40 Z"
        fill="url(#g3d-dl-tray)" stroke="#4b5d70" stroke-width="1.4" stroke-linejoin="round"/>
  <rect x="8" y="31.2" width="32" height="1.6" rx=".8" fill="#ffffff" opacity=".5"/>
</svg>`,
  screens: `
<svg class="c3d" viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
  <defs>
    <linearGradient id="g3d-scr-frame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#dfe7ef"/><stop offset=".5" stop-color="#9fb0c2"/><stop offset="1" stop-color="#5f7286"/>
    </linearGradient>
    <linearGradient id="g3d-scr-glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#bfe3fb"/><stop offset="1" stop-color="#4d9ad4"/>
    </linearGradient>
  </defs>
  <rect x="20" y="33" width="8" height="5" fill="#7a8ca0"/>
  <rect x="13" y="37" width="22" height="4" rx="1.6" fill="url(#g3d-scr-frame)" stroke="#4b5d70" stroke-width="1.2"/>
  <rect x="4.5" y="7" width="39" height="27" rx="2.5" fill="url(#g3d-scr-frame)" stroke="#4b5d70" stroke-width="1.4"/>
  <rect x="7.5" y="10" width="33" height="21" rx="1" fill="url(#g3d-scr-glass)"/>
  <path d="M8 10 H26 L14 31 H8 Z" fill="#ffffff" opacity=".28"/>
</svg>`,
  features: `
<svg class="c3d" viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
  <defs>
    <radialGradient id="g3d-ft-blue" cx=".35" cy=".3" r=".9">
      <stop offset="0" stop-color="#7db9f0"/><stop offset="1" stop-color="#0d5a9c"/>
    </radialGradient>
    <radialGradient id="g3d-ft-amber" cx=".35" cy=".3" r=".9">
      <stop offset="0" stop-color="#ffd97e"/><stop offset="1" stop-color="#c07f0a"/>
    </radialGradient>
    <radialGradient id="g3d-ft-green" cx=".35" cy=".3" r=".9">
      <stop offset="0" stop-color="#8ef0a4"/><stop offset="1" stop-color="#1a8a3f"/>
    </radialGradient>
  </defs>
  <g stroke="#7d8fa2" stroke-width="1">
    <rect x="7" y="11.5" width="34" height="4.5" rx="2.25" fill="#dfe7ef"/>
    <rect x="7" y="22" width="34" height="4.5" rx="2.25" fill="#dfe7ef"/>
    <rect x="7" y="32.5" width="34" height="4.5" rx="2.25" fill="#dfe7ef"/>
  </g>
  <circle cx="19" cy="13.75" r="5.5" fill="url(#g3d-ft-blue)" stroke="#0a4a80" stroke-width="1.2"/>
  <circle cx="31" cy="24.25" r="5.5" fill="url(#g3d-ft-amber)" stroke="#96630a" stroke-width="1.2"/>
  <circle cx="15" cy="34.75" r="5.5" fill="url(#g3d-ft-green)" stroke="#136b31" stroke-width="1.2"/>
  <ellipse cx="17.2" cy="11.9" rx="2" ry="1.2" fill="#ffffff" opacity=".7"/>
  <ellipse cx="29.2" cy="22.4" rx="2" ry="1.2" fill="#ffffff" opacity=".7"/>
  <ellipse cx="13.2" cy="32.9" rx="2" ry="1.2" fill="#ffffff" opacity=".7"/>
</svg>`,
  faq: `
<svg class="c3d" viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
  <defs>
    <linearGradient id="g3d-fq-bub" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe9a8"/><stop offset=".5" stop-color="#f0b429"/><stop offset="1" stop-color="#b97e08"/>
    </linearGradient>
  </defs>
  <path d="M6 10 A4 4 0 0 1 10 6 H38 A4 4 0 0 1 42 10 V28 A4 4 0 0 1 38 32 H23 L13 42 V32 H10 A4 4 0 0 1 6 28 Z"
        fill="url(#g3d-fq-bub)" stroke="#8f6206" stroke-width="1.4" stroke-linejoin="round"/>
  <ellipse cx="16" cy="10.5" rx="9" ry="2.6" fill="#ffffff" opacity=".4"/>
  <text x="24" y="28.5" font-family="'Segoe UI', sans-serif" font-size="19" font-weight="800" fill="#ffffff"
        stroke="#8f6206" stroke-width=".6" text-anchor="middle">?</text>
</svg>`,
  mail: `
<svg class="c3d" viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
  <defs>
    <linearGradient id="g3d-ml-env" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#bfe3fb"/><stop offset=".5" stop-color="#4d9ad4"/><stop offset="1" stop-color="#0d5a9c"/>
    </linearGradient>
    <linearGradient id="g3d-ml-flap" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e8f4fd"/><stop offset="1" stop-color="#9cc8e8"/>
    </linearGradient>
  </defs>
  <rect x="5" y="10" width="38" height="28" rx="3" fill="url(#g3d-ml-env)" stroke="#0a4a80" stroke-width="1.4"/>
  <path d="M6.5 12.5 L24 26 L41.5 12.5" fill="url(#g3d-ml-flap)" stroke="#0a4a80" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M6.5 35.5 L19 24.5 M41.5 35.5 L29 24.5" fill="none" stroke="#0a4a80" stroke-width="1.1" opacity=".55"/>
  <ellipse cx="15" cy="13" rx="9" ry="2.2" fill="#ffffff" opacity=".4" transform="rotate(-16 15 13)"/>
</svg>`,
  github: `
<svg class="c3d" viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
  <defs>
    <radialGradient id="g3d-gh-sph" cx=".35" cy=".28" r=".95">
      <stop offset="0" stop-color="#5d7186"/><stop offset="1" stop-color="#22303f"/>
    </radialGradient>
  </defs>
  <circle cx="24" cy="24" r="19" fill="url(#g3d-gh-sph)" stroke="#141d27" stroke-width="1.4"/>
  <ellipse cx="24" cy="24" rx="8.5" ry="19" fill="none" stroke="#ffffff" stroke-width="1.1" opacity=".4"/>
  <path d="M5.5 24 H42.5" stroke="#ffffff" stroke-width="1.1" opacity=".4"/>
  <ellipse cx="17.5" cy="12.5" rx="8" ry="3.4" fill="#ffffff" opacity=".35" transform="rotate(-32 17.5 12.5)"/>
  <text x="24" y="30" font-family="Consolas, monospace" font-size="14" font-weight="700" fill="#ffffff"
        text-anchor="middle">&lt;/&gt;</text>
</svg>`,
};

const cmd = (href, icon, label) => `
      <a class="cmd3d" href="${href}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>
        ${ICONS[icon]}
        <span>${label}</span>
      </a>`;

const NAV = (repoUrl) => `
    <div class="appbar">
      <button class="nav-burger" type="button" aria-label="Menu" aria-expanded="false" aria-controls="mobile-nav">
        <span></span><span></span>
      </button>
      <nav class="cmd-row nav-pages" aria-label="Pages">
${cmd('index.html', 'home', 'Home')}
${cmd('download.html', 'download', 'Download')}
${cmd('screens.html', 'screens', 'Screens')}
${cmd('features.html', 'features', 'Features')}
${cmd('faq.html', 'faq', 'FAQ')}
${cmd('contact.html', 'mail', 'Contact')}
      </nav>
      <div class="appbar-right cmd-row">
        <div class="theme-switch" role="radiogroup" aria-label="Theme">
          <button class="theme-opt" type="button" data-scheme="light" aria-label="Light theme">Light</button>
          <button class="theme-opt" type="button" data-scheme="dark" aria-label="Dark theme">Dark</button>
        </div>
${cmd(repoUrl, 'github', 'GitHub')}
      </div>
      <nav class="mobile-nav" id="mobile-nav" aria-label="Pages" hidden>
        <a href="index.html">Home</a>
        <a href="download.html">Download</a>
        <a href="screens.html">Screens</a>
        <a href="features.html">Features</a>
        <a href="faq.html">FAQ</a>
        <a href="contact.html">Contact</a>
        <a href="${repoUrl}" target="_blank" rel="noopener">GitHub ↗</a>
      </nav>
    </div>`;

const FOOTER = (repoUrl) => `
    <div class="wrap">
      <div class="foot-grid">
        <div class="foot-brand">
          <img src="assets/logo.png" alt="">
          <div>
            <div class="fn">Nogadex Download Manager</div>
            <div class="fd">A free, open-source download manager for Windows with multi-connection downloads, resume support, file verification, scheduling, and more.</div>
          </div>
        </div>
        <div class="foot-links">
          <div class="col">
            <h5>Product</h5>
            <a href="index.html">Home</a>
            <a href="download.html">Download</a>
            <a href="screens.html">Screens</a>
            <a href="features.html">Features</a>
            <a href="faq.html">FAQ</a>
            <a href="contact.html">Contact</a>
            <a href="changelog.html">Changelog</a>
            <a href="privacy.html">Privacy</a>
          </div>
          <div class="col">
            <h5>Project</h5>
            <a href="${repoUrl}" target="_blank" rel="noopener">GitHub</a>
            <a href="${repoUrl}/releases" target="_blank" rel="noopener">Releases</a>
            <a href="${repoUrl}/issues" target="_blank" rel="noopener">Issues</a>
            <a href="${repoUrl}/blob/master/LICENSE" target="_blank" rel="noopener">License (MIT)</a>
            <a href="privacy.html">Privacy</a>
          </div>
        </div>
      </div>
      <div class="foot-legal">© 2026 Nogadex Systems, MIT License.</div>
    </div>`;

const here = location.pathname.split('/').pop() || 'index.html';
const mount = (id, html) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = html;
  el.querySelectorAll('a[href]').forEach(a => {
    if (a.getAttribute('href') === here) a.classList.add('active');
  });
};

/* Repo URL for nav/footer comes from app-config.json (shared with the app);
   falls back to the baked repo while the fetch is in flight or offline. */
const BAKED_REPO_URL = 'https://github.com/nogasante/nogadex-download-manager';
let repoUrl = BAKED_REPO_URL;

const renderPartials = () => {
  mount('site-nav', NAV(repoUrl));
  mount('site-footer', FOOTER(repoUrl));
};

(async () => {
  try {
    const res = await fetch('app-config.json', { cache: 'no-store' });
    if (res.ok) {
      const c = await res.json();
      if (c && c.github && c.github.repoUrl) repoUrl = c.github.repoUrl;
    }
  } catch { /* baked fallback already set */ }
  renderPartials();
})();
