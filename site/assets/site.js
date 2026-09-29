/* NDM site shared JS — vanilla, no dependencies. */
'use strict';

/* Repo coordinates come from app-config.json (single source of truth shared
   with the desktop app) so a repo move is a one-file edit. */
let REPO = 'https://github.com/nogasante/nogadex-download-manager';
let REPO_API = 'https://api.github.com/repos/nogasante/nogadex-download-manager';
let LATEST_DL = `${REPO}/releases/latest/download`;

(() => {
  const apply = (c) => {
    if (!c || !c.github || !c.github.repoUrl) return;
    REPO = c.github.repoUrl;
    REPO_API = `https://api.github.com/repos/${c.github.owner}/${c.github.repo}`;
    LATEST_DL = `${REPO}/releases/latest/download`;
  };
  fetch('app-config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then(apply)
    .catch(() => {});
})();

/* Contact email now lives in app-config.json; the block below overrides it
   once fetched. The baked value keeps pages correct before fetch resolves. */
let CONTACT_EMAIL = 'nanasante2000@gmail.com';
let CONTACT_SUBJECT = '[NDM]';
(() => {
  fetch('app-config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => {
      if (!c || !c.contact || !c.contact.email) return;
      CONTACT_EMAIL = c.contact.email;
      CONTACT_SUBJECT = c.contact.subjectPrefix || '[NDM]';
      document.querySelectorAll('[data-mail-text]').forEach((el) => { el.textContent = CONTACT_EMAIL; });
      document.querySelectorAll('[data-mail-link]').forEach((a) => {
        a.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`${CONTACT_SUBJECT} Hello`)}`;
      });
    })
    .catch(() => {});
})();

/* fill every [data-mail-text] / [data-mail-link] from the constant above */
(() => {
  document.querySelectorAll('[data-mail-text]').forEach(el => { el.textContent = CONTACT_EMAIL; });
  document.querySelectorAll('[data-mail-link]').forEach(a => {
    a.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`${CONTACT_SUBJECT} Hello`)}`;
  });
})();

/* Link particulars (checksums, code-signing) from app-config.json */
(() => {
  fetch('app-config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => {
      if (!c || !c.github) return;
      const set = (id, href) => {
        const el = document.getElementById(id);
        if (el && href) el.href = href;
      };
      set('checksums-link', `${c.github.repoUrl}/releases/latest/download/CHECKSUMS.sha256`);
      set('signing-policy-link', `${c.github.repoUrl}/blob/${c.github.branch || 'master'}/CODE_SIGNING_POLICY.md`);
      set('contact-issues-link', c.github.issuesUrl);
      set('contact-discussions-link', `${c.github.repoUrl}/discussions`);
      set('privacy-repo-link', c.github.repoUrl);
      if (c.links) {
        set('signpath-link', c.links.signPath);
        set('signpath-foundation-link', c.links.signPathFoundation);
      }
    })
    .catch(() => {});
})();
/* =====================================================================
   Release data — one source of truth for version, size, date, asset
   and changelog notes. The seed ships with the site so nothing renders
   empty; the moment the GitHub repo has real releases, they replace it.
   To update by hand, edit RELEASES_SEED only.
   ===================================================================== */
const RELEASES_SEED = [
  {
    version: '1.0.5',
    date: '2026-09-26',
    asset: 'NDM_Setup_1.0.5.exe',
    sizeBytes: 115994266,
    prerelease: false,
    notes: [
      'Initial public release.',
      'Support for multi-connection downloads with up to 32 connections.',
      'Resume interrupted downloads without re-downloading completed parts.',
      'SHA-256 verification for completed downloads.',
      'Download scheduling and bandwidth limits.',
      'Batch downloads and page-based file collection.',
      'Built-in diagnostics and Help Center.',
      'Bug reporting from within the application.',
    ],
  },
];

const fmtMB = b => (b / 1048576).toFixed(1) + ' MB';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* turn a GitHub release body into clean bullet lines */
const splitNotes = body => String(body)
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(Boolean)
  .map(l => l.replace(/^[-*+]\s+/, '').replace(/^#+\s*/, ''))
  .map(l => l.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, ''))
  .filter(l => !l.startsWith('<!--'));

/* fetch real releases from GitHub; null when offline / none published */
const fetchReleases = async () => {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
  try {
    const res = await fetch(`${REPO_API}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const rels = await res.json();
    if (!Array.isArray(rels)) return null;
    const mapped = rels
      .filter(r => !r.draft)
      .map(r => {
        const exe = (r.assets || []).find(a => a.name.toLowerCase().endsWith('.exe'));
        return {
          version: (r.tag_name || '').replace(/^v/, '') || r.name || '',
          date: (r.published_at || r.created_at || '').slice(0, 10),
          asset: exe ? exe.name : '',
          sizeBytes: exe ? exe.size : 0,
          prerelease: !!r.prerelease,
          notes: splitNotes(r.body || ''),
        };
      })
      .filter(r => r.version);
    return mapped.length ? mapped : null;
  } catch { return null; }
};

/* fill every download button and version slot from one release */
const applyLatest = r => {
  document.querySelectorAll('[data-dl]').forEach(a => {
    a.href = r.asset ? `${LATEST_DL}/${encodeURIComponent(r.asset)}` : `${REPO}/releases/latest`;
    if (r.asset) a.setAttribute('download', r.asset);
  });
  document.querySelectorAll('[data-ver]').forEach(el => { el.textContent = r.version; });
  document.querySelectorAll('[data-size]').forEach(el => { if (r.sizeBytes) el.textContent = fmtMB(r.sizeBytes); });
  document.querySelectorAll('[data-asset]').forEach(el => { el.textContent = r.asset; });
  const d = document.getElementById('dl-date');
  if (d) d.textContent = r.date;
  const f = document.getElementById('dl-file');
  if (f) f.textContent = r.asset;
};

(async () => {
  applyLatest(RELEASES_SEED[0]);
  const rels = await fetchReleases();
  if (rels) applyLatest(rels[0]);
})();

/* detect the visitor's OS for preselecting the download tab */
const detectOS = () => {
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad/i.test(ua)) return 'macos';
  if (/Linux|X11|Android/i.test(ua) && !/Windows/i.test(ua)) return 'linux';
  return 'windows';
};

/* =====================================================================
   Changelog page — rendered from the release data above: the seed,
   replaced by real GitHub releases the moment they exist.
   ===================================================================== */
(() => {
  const list = document.getElementById('changelog-list');
  if (!list) return;

  const render = rels => {
    list.innerHTML = rels.map((r, i) => `
      <article class="log-item">
        <div class="log-head">
          <h3 class="log-ver">v${esc(r.version)}</h3>
          <span class="log-date">${esc(r.date || '')}</span>
          ${i === 0 && !r.prerelease ? '<span class="log-tag log-tag-latest">Latest</span>'
            : r.prerelease ? '<span class="log-tag">Pre-release</span>' : ''}
        </div>
        ${r.notes.length ? `<ul class="log-changes">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </article>
    `).join('');
  };

  render(RELEASES_SEED);
  fetchReleases().then(rels => { if (rels) render(rels); });
})();

/* OS tabs on the download page: click to switch; the visitor's platform is
   preselected on load (mac/linux show their coming-soon pane). */
(() => {
  const tabs = [...document.querySelectorAll('.os-tab')];
  if (!tabs.length) return;
  const panes = [...document.querySelectorAll('.dl-pane')];

  const select = id => {
    tabs.forEach(t => {
      const on = t.id === `tab-${id}`;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    panes.forEach(p => {
      const on = p.id === `pane-${id}`;
      p.classList.toggle('is-active', on);
      p.hidden = !on;
    });
  };

  tabs.forEach(t => t.addEventListener('click', () => select(t.id.replace(/^tab-/, ''))));

  /* preselect the visitor's platform on first paint */
  const current = detectOS();
  if (document.getElementById(`tab-${current}`)) select(current);
})();

/* copy buttons on the download page */
(() => {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const src = document.querySelector(btn.dataset.copy);
      if (!src) return;
      try {
        await navigator.clipboard.writeText(src.textContent.trim());
      } catch {
        const ta = document.createElement('textarea');
        ta.value = src.textContent.trim();
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      const prev = btn.getAttribute('aria-label');
    btn.setAttribute('aria-label', 'Copied');
    setTimeout(() => btn.setAttribute('aria-label', prev || 'Copy command'), 1200);
    });
  });
})();

/* =====================================================================
   Theme — modern color-scheme approach: every token in style.css is
   light-dark(a, b); the switch sets color-scheme on <html> and
   persists it. OS preference is respected until the user overrides.
   ===================================================================== */
(() => {
  const KEY = 'ndm-theme'; // 'light' | 'dark' | null (follow OS)
  const root = document.documentElement;

  /* App screenshots ship in both flavors (site/screenshots/*.png light,
     site/screenshots/dark/*.png dark). When the page theme changes, retarget
     every screenshot image so the shots always match the page. Images whose
     name has no dark twin keep their current src. */
  const swapShots = scheme => {
    const dark = scheme === 'dark';
    document.querySelectorAll('img[src*="screenshots"]').forEach(img => {
      const m = img.getAttribute('src').match(/^(.*\/)?screenshots\/(dark\/)?([A-Za-z0-9_-]+\.png)$/);
      if (!m) return;
      const next = `${m[1] || ''}screenshots/${dark ? 'dark/' : ''}${m[3]}`;
      if (img.getAttribute('src') !== next) img.setAttribute('src', next);
    });
  };

  const apply = scheme => {
    root.style.colorScheme = scheme; /* inline style overrides the :root rule */
    root.setAttribute('data-color-scheme', scheme);
    swapShots(scheme);
    document.querySelectorAll('.theme-opt').forEach(btn => {
      const on = btn.dataset.scheme === scheme;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = scheme === 'dark' ? '#0b0e13' : '#005a9e';
  };

  const stored = localStorage.getItem(KEY);
  apply(stored === 'light' || stored === 'dark' ? stored
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  document.addEventListener('click', e => {
    const btn = e.target.closest('.theme-opt');
    if (!btn) return;
    const scheme = btn.dataset.scheme;
    if (scheme !== 'light' && scheme !== 'dark') return;
    localStorage.setItem(KEY, scheme);
    apply(scheme);
  });
})();

/* =====================================================================
   Mobile nav — the burger reveals a dropdown panel. Closes on link
   tap, Escape, outside click, and when the viewport grows past it.
   ===================================================================== */
(() => {
  const burger = document.querySelector('.nav-burger');
  const panel = document.getElementById('mobile-nav');
  if (!burger || !panel) return;

  const setOpen = open => {
    burger.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('open', open);
    panel.hidden = !open;
  };

  burger.addEventListener('click', () => setOpen(burger.getAttribute('aria-expanded') !== 'true'));
  panel.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('click', e => {
    if (!panel.classList.contains('open')) return;
    if (!e.target.closest('.appbar')) setOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.classList.contains('open')) { setOpen(false); burger.focus(); }
  });
  matchMedia('(min-width: 961px)').addEventListener('change', m => { if (m.matches) setOpen(false); });
})();

/* =====================================================================
   Contact page — the static-site way: the form composes a mailto: link
   to nanasante2000@gmail.com with the message pre-filled. No server,
   no tracking; the visitor's own mail app does the sending.
   ===================================================================== */
(() => {
  const form = document.getElementById('contact-form');
  if (!form) return;
  const status = document.getElementById('form-status');
  const MAIL = CONTACT_EMAIL;

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const subject = `[NDM ${data.get('topic')}] ${String(data.get('subject')).trim()}`;
    const body =
      `Topic: ${data.get('topic')}\n` +
      `From: ${String(data.get('name')).trim()}\n` +
      `\n${String(data.get('message')).trim()}\n`;

    location.href = `mailto:${MAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    status.textContent = 'Opening your mail app';
    status.classList.remove('is-error');
  });
})();

/* lightbox (screens page) */
(() => {
  const shots = [...document.querySelectorAll('.shot')];
  if (!shots.length) return;
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lb-img');
  const cap = document.getElementById('lb-cap');
  let idx = 0, lastFocus = null;
  const show = i => {
    idx = (i + shots.length) % shots.length;
    const s = shots[idx];
    img.src = s.querySelector('img').src;
    img.alt = s.querySelector('img').alt;
    cap.innerHTML = `<b>${s.dataset.cap}</b> — ${idx + 1}/${shots.length}`;
  };
  const open = i => { lastFocus = document.activeElement; show(i); lb.classList.add('open'); document.body.style.overflow = 'hidden'; document.getElementById('lb-close').focus(); };
  const close = () => { lb.classList.remove('open'); document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); };
  shots.forEach((s, i) => {
    s.addEventListener('click', () => open(i));
    s.setAttribute('tabindex', '0');
    s.setAttribute('role', 'button');
    s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); } });
  });
  document.getElementById('lb-close').addEventListener('click', close);
  document.getElementById('lb-prev').addEventListener('click', () => show(idx - 1));
  document.getElementById('lb-next').addEventListener('click', () => show(idx + 1));
  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
  });
})();

/* faq accordion (faq page) — opening one item closes the others */
(() => {
  const items = [...document.querySelectorAll('.faq-item')];
  if (!items.length) return;
  items.forEach(item => {
    const q = item.querySelector('.faq-q');
    const a = item.querySelector('.faq-a');
    if (!q || !a) return;
    q.addEventListener('click', () => {
      const willOpen = !item.classList.contains('open');
      if (willOpen) {
        items.forEach(other => {
          if (other === item || !other.classList.contains('open')) return;
          other.classList.remove('open');
          other.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
          other.querySelector('.faq-a').style.maxHeight = '0px';
        });
      }
      item.classList.toggle('open', willOpen);
      q.setAttribute('aria-expanded', String(willOpen));
      a.style.maxHeight = willOpen ? a.scrollHeight + 'px' : '0px';
    });
  });
})();

/* =====================================================================
   screens page — app-window viewer: thumbnails swap the framed view
   ===================================================================== */
(() => {
  const img = document.getElementById('viewer-img');
  if (!img) return;
  const nameEl = document.getElementById('viewer-name');
  const keysEl = document.getElementById('viewer-keys');
  const capEl  = document.getElementById('viewer-cap');
  const cntEl  = document.getElementById('viewer-count');
  const thumbs = [...document.querySelectorAll('.thumb')];

  const SHOTS = [
    { name: 'Main window',   keys: '',        cap: 'The download queue with connection status, download speed, progress, and controls.' },
    { name: 'New Download',  keys: 'Ctrl+N',  cap: 'Add a download, choose its location, and configure options such as connections and speed limits.' },
    { name: 'Scheduler',     keys: 'Ctrl+Q',  cap: 'Set time windows for downloads and choose when NDM should run transfers.' },
    { name: 'Settings',      keys: 'Ctrl+,',  cap: 'Configure NDM, including update checks and application preferences.' },
    { name: 'Diagnostics',   keys: 'Ctrl+D',  cap: 'View connection states, retries, and download integrity information.' },
    { name: 'Help Center',   keys: 'F1',      cap: 'Find keyboard shortcuts, common questions, and information for reporting bugs.' },
  ];

  let idx = 0;
  const show = i => {
    idx = (i + SHOTS.length) % SHOTS.length;
    const s = SHOTS[idx];
    const t = thumbs[idx];
    img.src = t.querySelector('img').src.replace(/\.png$/, '.png');
    img.alt = `NDM ${s.name}`;
    nameEl.textContent = s.name;
    if (s.keys) { keysEl.textContent = s.keys; keysEl.hidden = false; } else { keysEl.hidden = true; }
    capEl.innerHTML = `<b>${s.name}</b> — ${s.cap}`;
    cntEl.textContent = `${idx + 1} / ${SHOTS.length}`;
    thumbs.forEach((t2, j) => {
      t2.classList.toggle('is-selected', j === idx);
      t2.setAttribute('aria-selected', String(j === idx));
    });
  };

  thumbs.forEach((t, j) => t.addEventListener('click', () => show(j)));
  document.getElementById('viewer-prev').addEventListener('click', () => show(idx - 1));
  document.getElementById('viewer-next').addEventListener('click', () => show(idx + 1));
  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
  });

  show(0);
})();

/* =====================================================================
   features page — live mini-NDM demo window
   Two rows download over multiple connections. Pause / Resume / Cut
   connection behave like the real engine: resume from saved progress,
   finished parts are not downloaded again, SHA-256 verify at the end.
   ===================================================================== */
(() => {
  const root = document.getElementById('demo');
  if (!root) return;
  const listEl = document.getElementById('demo-list');
  const noteEl = document.getElementById('demo-note');

  const NOTE_DEFAULT = 'Two files are downloading over multiple connections. Cut the connection to see how NDM resumes the download.';
  const NOTE_PAUSED  = 'Downloads paused. Resume them to continue from where they stopped.';
  const NOTE_CUT     = 'Connection interrupted. Resume the downloads to continue without re-downloading completed parts.';
  const NOTE_DONE = '';

  const FILES = [
    { name: 'ubuntu-26.04-desktop-amd64.iso', meta: '6.2 GB · 8 connections',  conns: 8,  rate: 1.05 },
    { name: 'big-buck-bunny-4k.mkv',          meta: '14.8 GB · 16 connections', conns: 16, rate: 0.8 },
  ];

  let rows = [];
  let timer = null;

  const reset = () => {
    if (timer) clearInterval(timer);
    rows = FILES.map(f => ({ ...f, progress: 0, state: 'downloading', lostAt: 0 }));
    render();
    timer = setInterval(tick, 250);
    noteEl.textContent = NOTE_DEFAULT;
  };

  const segWidth = (row, i) => {
    const seg = 100 / row.conns;
    const filled = (row.progress / 100) * row.conns - i;
    return Math.max(0, Math.min(1, filled)) * seg;
  };

  const statusText = row => {
    const p = Math.floor(row.progress);
    if (row.state === 'done') return 'Done';
    if (row.state === 'error') return `Lost @ ${p}%`;
    if (row.state === 'paused') return `Paused @ ${p}%`;
    const speed = (row.conns * row.rate * (0.85 + Math.random() * 0.3)).toFixed(1);
    return `${p}% · ${speed} MB/s`;
  };

  const render = () => {
    listEl.innerHTML = rows.map((r, idx) => `
      <div class="demo-row" data-state="${r.state}">
        <div>
          <div class="fname">${r.name}</div>
          <div class="fmeta">${r.meta}</div>
        </div>
        <div class="demo-bar">
          ${Array.from({ length: r.conns }, (_, i) =>
            `<i class="demo-seg" style="left:${(i * 100 / r.conns).toFixed(2)}%;width:${segWidth(r, i).toFixed(2)}%"></i>`
          ).join('')}
        </div>
        <div class="demo-status st-${r.state}">${statusText(r)}</div>
      </div>`).join('');
  };

  const tick = () => {
    let allDone = true;
    rows.forEach(r => {
      if (r.state !== 'downloading') { if (r.state !== 'done') allDone = false; return; }
      r.progress += r.conns * r.rate * 0.25 * (0.85 + Math.random() * 0.3);
      if (r.progress >= 100) { r.progress = 100; r.state = 'done'; }
      else allDone = false;
    });
    render();
    if (allDone && noteEl.textContent) noteEl.textContent = '';
  };

  const setStates = (fn, note) => {
    let changed = false;
    rows.forEach(r => { if (fn(r)) changed = true; });
    if (!changed) return;
    render();
    if (note) noteEl.textContent = note;
  };

  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-demo]');
    if (!btn) return;
    const act = btn.dataset.demo;
    if (act === 'pause') {
      setStates(r => { if (r.state === 'downloading') { r.state = 'paused'; return true; } }, NOTE_PAUSED);
    } else if (act === 'resume') {
      setStates(r => { if (r.state === 'paused' || r.state === 'error') { r.state = 'downloading'; return true; } },
        rows.some(r => r.state === 'downloading') ? null : NOTE_DEFAULT);
      if (!rows.some(r => r.state === 'done')) noteEl.textContent = NOTE_DEFAULT;
    } else if (act === 'cut') {
      setStates(r => { if (r.state === 'downloading') { r.state = 'error'; r.lostAt = r.progress; return true; } }, NOTE_CUT);
    } else if (act === 'reset') {
      reset();
    }
  });

  reset();
})();

/* =====================================================================
   features page — expandable feature cards with one-shot mini demos
   ===================================================================== */
(() => {
  const cards = document.querySelectorAll('.feat-card');
  if (!cards.length) return;

  const runDemo = {
    'fc-parallel': body => {
      const a = body.querySelector('.f-fill-1conn'), b = body.querySelector('.f-fill-32conn');
      a.style.transition = 'none'; b.style.transition = 'none';
      a.style.width = '0'; b.style.width = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        a.style.transition = ''; b.style.transition = '';
        a.style.width = '100%'; b.style.width = '100%';
      }));
    },
    'fc-resume': body => {
      const fill = body.querySelector('.f-fill-resume');
      const segA = body.querySelector('.f-seg-a'), segB = body.querySelector('.f-seg-b');
      const lab = document.getElementById('f-resume-lab');
      fill.style.width = '61%'; segA.style.width = '0'; segB.style.width = '0';
      lab.textContent = 'Part 1 and Part 2 saved, picking up from byte 61%';
      setTimeout(() => { segA.style.width = '17%'; segB.style.width = '11%'; fill.style.width = '89%'; }, 700);
      setTimeout(() => { fill.style.width = '100%'; lab.textContent = 'Resumed, nothing downloaded twice'; }, 1600);
    },
    'fc-verify': body => {
      const fill = body.querySelector('.f-fill-verify');
      const hash = document.getElementById('f-verify-hash');
      const lab = document.getElementById('f-verify-lab');
      fill.style.transition = 'none'; fill.style.width = '0';
      lab.textContent = 'Verifying';
      let n = 0;
      const scr = setInterval(() => {
        hash.textContent = 'sha256: ' + Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('') + '...';
        if (++n > 10) {
          clearInterval(scr);
          hash.textContent = 'sha256: 9f2c4e81b7d0a635...';
          lab.textContent = 'Matches the release';
        }
      }, 110);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fill.style.transition = ''; fill.style.width = '100%';
      }));
    },
    'fc-batch': body => {
      const fill = body.querySelector('.f-fill-batch');
      const lab = document.getElementById('f-batch-lab');
      fill.style.transition = 'none'; fill.style.width = '0';
      let n = 0;
      const iv = setInterval(() => {
        n++;
        lab.textContent = n < 8 ? `queuing ${n} / 8 files` : '1 link to 8 files queued';
        fill.style.transition = ''; fill.style.width = (n / 8 * 100) + '%';
        if (n >= 8) clearInterval(iv);
      }, 140);
    },
    'fc-schedule': body => {
      const fill = body.querySelector('.f-fill-cap');
      const lab = document.getElementById('f-speed-lab');
      fill.style.transition = 'width 1s ease'; fill.style.width = '92%';
      lab.textContent = '42.0 MB/s';
      setTimeout(() => { fill.style.transition = 'width .6s ease'; fill.style.width = '36%'; lab.textContent = 'Capped at 12.0 MB/s'; }, 1200);
    },
    'fc-safety': body => {
      const fill = body.querySelector('.f-fill-safe');
      const lab = document.getElementById('f-safe-lab');
      fill.style.transition = 'none'; fill.style.width = '0';
      lab.textContent = 'http://192.168.1.10/setup.exe, resolving';
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.transition = 'width .9s ease'; fill.style.width = '100%'; }));
      setTimeout(() => { lab.textContent = 'blocked, private address'; }, 1000);
    },
  };

  cards.forEach(card => {
    const head = card.querySelector('.feat-card-head');
    const body = card.querySelector('.feat-card-body');
    const open = () => card.classList.contains('open');
    head.addEventListener('click', () => {
      const willOpen = !open();
      /* accordion: opening one card closes the others */
      if (willOpen) cards.forEach(c => {
        if (c === card || !c.classList.contains('open')) return;
        c.classList.remove('open');
        c.querySelector('.feat-card-head').setAttribute('aria-expanded', 'false');
        c.querySelector('.feat-card-body').style.maxHeight = '0px';
      });
      card.classList.toggle('open', willOpen);
      head.setAttribute('aria-expanded', String(willOpen));
      body.style.maxHeight = willOpen ? body.scrollHeight + 'px' : '0px';
      if (willOpen && runDemo[card.id]) runDemo[card.id](body);
    });
    /* text wraps differently as the viewport changes — keep the clipped-open
       card sized to its content or the demo gets cut off / jumpy */
    const sync = () => { if (open()) body.style.maxHeight = body.scrollHeight + 'px'; };
    window.addEventListener('resize', sync);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync);
    if (window.ResizeObserver) new ResizeObserver(sync).observe(body);
  });
})();
