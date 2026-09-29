/* Capture fresh screenshots of the real app for the website — in BOTH themes.
   Boots: test file server + engine + Vite + headless Chromium (Playwright),
   seeds a lively download queue, opens each dialog, and saves PNGs:
     light -> site/screenshots/*.png        (site default)
     dark  -> site/screenshots/dark/*.png

   Isolation: each pass runs its own engine inside a throwaway fake user
   profile (USERPROFILE/HOME pointed at a temp dir), so settings, state and
   downloaded files all resolve inside the sandbox — the real ~/Downloads and
   ~/.nogadex are never touched. The engine boots fresh per pass so both
   themes capture identical, clean conditions.

   Run: npx tsx scripts/capture_screens.ts
*/
import { chromium } from 'playwright';
import { createServer as createViteServer, ViteDevServer } from 'vite';
import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const ENGINE_PORT = 5005; // vite.config.ts proxies /api and /ws here
const FILE_PORT = 5077;   // scripts/test_file_server.mjs listens here
const UI_PORT = 5173;     // vite.config.ts server port

const waitPort = (port: number, timeoutMs = 40000) =>
  new Promise<boolean>(resolve => {
    const start = Date.now();
    const probe = () => {
      const req = http.get(`http://127.0.0.1:${port}/`, res => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(probe, 400);
      });
      req.setTimeout(1000, () => req.destroy());
    };
    probe();
  });

type Row = { id?: string };

const api = (p: string, method = 'GET', body?: unknown) =>
  fetch(`http://127.0.0.1:${ENGINE_PORT}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

/* ---------- per-pass engine lifecycle (sandboxed profile) ---------- */

let engineProc: ChildProcess | null = null;
let profileDir: string | null = null;

async function startEngine(): Promise<void> {
  // Fake user profile: os.homedir() follows USERPROFILE on Windows, so the
  // engine's SettingsManager (~/.nogadex) and defaultDownloadFolder
  // (~/Downloads) — plus .hyper_state.json — all resolve inside the sandbox.
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndm-shots-'));
  fs.mkdirSync(path.join(profileDir, 'Downloads'), { recursive: true });
  fs.mkdirSync(path.join(profileDir, '.nogadex'), { recursive: true });

  console.log(`  engine profile: ${profileDir}`);
  engineProc = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'server/server.ts'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(ENGINE_PORT),
        USERPROFILE: profileDir,
        HOME: profileDir,
        TMP: profileDir,
        TEMP: profileDir,
      },
      stdio: 'inherit',
    }
  );
  if (!(await waitPort(ENGINE_PORT, 40000))) throw new Error('engine did not start');

  // SAFETY: refuse to seed unless the engine provably resolves its download
  // folder inside the sandbox profile (protects the real ~/Downloads).
  const probe = (await (await api('/api/downloads')).json()) as { defaultPath?: string };
  const dlDir = path.resolve(probe.defaultPath || '');
  if (!dlDir.toLowerCase().startsWith(profileDir.toLowerCase())) {
    throw new Error(`engine download dir "${dlDir}" is OUTSIDE the sandbox — aborting`);
  }
  console.log('  engine download dir: ' + dlDir);
}

async function stopEngine(): Promise<void> {
  if (engineProc) {
    try { if (engineProc.pid) execSync(`taskkill /pid ${engineProc.pid} /f /t`, { stdio: 'ignore' }); } catch { /* gone */ }
    engineProc = null;
  }
  if (profileDir) {
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* temp dir */ }
    profileDir = null;
  }
}

/* ---------- seeding ---------- */

async function seedQueue(): Promise<string | undefined> {
  const post = (p: string, body: unknown) => api(p, 'POST', body).then(r => r.json() as Promise<Row>);

  // Lively main window: one big multi-stream download in flight, one paused,
  // one queued — mirrors the site's demo copy (ISO + media + archive).
  // huge.iso (32 MB) can't complete during the capture window, so the row
  // stays live with progress + speed.
  const big = await post('/api/downloads', {
    url: `http://127.0.0.1:${FILE_PORT}/huge.iso`,
    filename: 'ubuntu-26.04-desktop-amd64.iso',
    connections: 16,
  });
  const medium = await post('/api/downloads', {
    url: `http://127.0.0.1:${FILE_PORT}/medium.zip?as=big-buck-bunny-4k.mkv`,
    filename: 'big-buck-bunny-4k.mkv',
    connections: 8,
  });
  await post('/api/downloads', {
    url: `http://127.0.0.1:${FILE_PORT}/doc.pdf`,
    filename: 'design-spec-winter.pdf',
    connections: 4,
  });
  // Park the second row mid-flight so the table shows every state.
  if (medium?.id) await post(`/api/downloads/${medium.id}/pause`);
  return big?.id;
}

/** Resolve once the big row is visibly in flight (>= minPct). */
async function waitForLiveProgress(id: string | undefined, minPct: number): Promise<void> {
  if (!id) return;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const item = (await (await api(`/api/downloads/${id}`)).json()) as {
      downloadedBytes?: number; totalBytes?: number; status?: string;
    };
    const pct = item.totalBytes ? ((item.downloadedBytes || 0) / item.totalBytes) * 100 : 0;
    if (pct >= minPct) return;
    await new Promise(r => setTimeout(r, 500));
  }
}

/* ---------- capture flow ---------- */

/* The dialog flow, parameterized by theme. `page` starts on the main window. */
async function captureAllShots(
  page: import('playwright').Page,
  outDir: string,
  theme: 'light' | 'dark',
  bigId: string | undefined
): Promise<void> {
  const shot = async (name: string) => {
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, name) });
    console.log(`  saved ${theme}/${name}`);
  };

  // Main window — the queue with live rows.
  await shot('main-window.png');

  // Park the ISO so it stays mid-flight (not Complete) for the dialog shots.
  if (bigId) {
    await api(`/api/downloads/${bigId}/pause`, 'POST');
    await page.waitForTimeout(900);
  }

  // New Download dialog.
  await page.click('button:has-text("Add URL")');
  await page.waitForTimeout(900);
  await shot('new-download.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Scheduler dialog.
  await page.click('button:has-text("Scheduler")');
  await page.waitForTimeout(900);
  await shot('scheduler.png');
  await page.click('button:has-text("Close")');
  await page.waitForTimeout(400);

  // Settings dialog on the Updates tab.
  await page.click('button:has-text("Options")');
  await page.waitForTimeout(900);
  await page.click('button:has-text("Updates")');
  await page.waitForTimeout(600);
  await shot('settings-updates.png');
  await page.click('button:has-text("Cancel")');
  await page.waitForTimeout(400);

  // Diagnostics dialog (Downloads menu).
  await page.click('button:has-text("Downloads")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("Engine Diagnostics...")');
  await page.waitForTimeout(900);
  await shot('diagnostics.png');
  await page.click('button:has-text("Close")');
  await page.waitForTimeout(400);

  // Help Center (F1).
  await page.keyboard.press('F1');
  await page.waitForTimeout(900);
  await shot('help-center.png');
}

async function main() {
  console.log('=== NDM site screenshot capture (light + dark) ===');

  // Pre-clean stale instances on our ports.
  for (const p of [ENGINE_PORT, FILE_PORT, UI_PORT]) {
    try {
      execSync(
        `powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort ${p} -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id ($c | Select-Object -First 1 -ExpandProperty OwningProcess) -Force }"`,
        { stdio: 'ignore' }
      );
    } catch { /* nothing listening */ }
  }

  const fileServer: ChildProcess = spawn(process.execPath, ['scripts/test_file_server.mjs'], { cwd: ROOT, stdio: 'inherit' });
  let vite: ViteDevServer | null = null;
  let browser = null;

  try {
    console.log('[1/4] test file server on :' + FILE_PORT);
    if (!(await waitPort(FILE_PORT, 20000))) throw new Error('file server did not start');

    console.log('[2/4] vite UI on :' + UI_PORT);
    vite = await createViteServer({
      configFile: path.resolve(ROOT, 'vite.config.ts'),
      root: ROOT,
      server: { port: UI_PORT, strictPort: true, host: '127.0.0.1' },
    });
    await vite.listen();

    console.log('[3/4] headless Chromium');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${UI_PORT}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const rootOut = path.resolve(ROOT, 'site/screenshots');
    fs.mkdirSync(path.join(rootOut, 'dark'), { recursive: true });

    console.log('[4/4] two passes: light, dark');
    for (const theme of ['light', 'dark'] as const) {
      console.log(`--- pass: ${theme} ---`);
      await startEngine();
      try {
        const bigId = await seedQueue();
        await waitForLiveProgress(bigId, 20); // ISO visibly in flight

        await page.evaluate(mode => {
          localStorage.setItem('ndm_appearance', JSON.stringify({ theme: mode, uiScale: 15, iconStyle: 'color' }));
        }, theme);
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2500);

        await captureAllShots(page, theme === 'dark' ? path.join(rootOut, 'dark') : rootOut, theme, bigId);
      } finally {
        await stopEngine();
      }
    }

    console.log('=== capture complete: 12 screenshots (6 light + 6 dark) ===');
  } catch (err) {
    console.error('CAPTURE FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (vite) await vite.close();
    await stopEngine();
    try { if (fileServer.pid) execSync(`taskkill /pid ${fileServer.pid} /f /t`, { stdio: 'ignore' }); } catch { fileServer.kill('SIGTERM'); }
  }
}

main();
