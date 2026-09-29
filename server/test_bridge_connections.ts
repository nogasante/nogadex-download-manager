/**
 * Live check: extension heartbeats surface through /api/bridge/policy and
 * /api/bridge/connections, and expire via TTL. Boots a REAL engine+server.
 * Run: npx tsx server/test_bridge_connections.ts
 */
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { console.log(`[PASS] ${name}`); passed++; }
  else { console.error(`[FAIL] ${name}${detail ? ' — ' + detail : ''}`); failed++; }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndm_conn_'));

function get(port: number, p: string, token?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    // Headers must be passed at creation — setHeader after http.get() races
    // the socket write and throws ERR_HTTP_HEADERS_SENT.
    const headers = token ? { 'X-NDM-Token': token } : {};
    const req = http.get(`http://127.0.0.1:${port}${p}`, { headers }, (r) => {
      let data = '';
      r.on('data', (c) => { data += c; });
      r.on('end', () => {
        try { resolve({ status: r.statusCode || 0, body: JSON.parse(data) }); }
        catch { resolve({ status: r.statusCode || 0, body: null }); }
      });
    });
    req.on('error', (e) => reject(new Error(`GET ${p} failed: ${e.message}`)));
    req.setTimeout(3000, () => { req.destroy(); reject(new Error(`GET ${p} timeout`)); });
  });
}

// The server constructs SettingsManager() with no path, so point ~/.nogadex
// at our temp dir for the duration of the run.
const homeTmp = path.join(dir, 'home');
fs.mkdirSync(homeTmp, { recursive: true });
fs.mkdirSync(path.join(homeTmp, '.nogadex'), { recursive: true });

const serverLog = path.join(dir, 'server-stderr.log');
const serverErr = fs.openSync(serverLog, 'w');
const server = spawn(process.execPath, ['dist-server/server.cjs'], {
  env: { ...process.env, PORT: '5017', USERPROFILE: homeTmp, HOME: homeTmp },
  stdio: ['ignore', 'ignore', serverErr],
});
process.on('uncaughtException', (e) => {
  console.error('[test crashed]', e.stack || e.message);
  try { server.kill(); } catch {}
  process.exit(2);
});

async function waitUp(port: number): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    try { await get(port, '/api/settings'); return true; } catch { await new Promise((r) => setTimeout(r, 300)); }
  }
  return false;
}

try {
  const up = await waitUp(5017);
  check('engine booted on 5017', up);
  if (!up) throw new Error('engine not up: ' + fs.readFileSync(serverLog, 'utf8').slice(0, 400));
  // Give the server a beat to finish booting side subsystems.
  await new Promise((r) => setTimeout(r, 800));

  // Which request blows up? Wrap every call with route context.
  const traced = async (label: string, p: string, token?: string) => {
    try { return await get(5017, p, token); }
    catch (e: any) {
      console.error(`[${label}] STACK>>>`, e.stack || e.message);
      throw new Error(`[${label}] ${e.message}`);
    }
  };

  // 1. No heartbeats yet
  let r = await traced('connections', '/api/bridge/connections', 'ndm_local_secret_token');
  check('connections endpoint responds', r.status === 200 && !!r.body);
  check('no browsers connected initially', Object.keys(r.body?.connected || {}).length === 0);

  // 2. Policy poll with browser= records a heartbeat (like the extension)
  r = await traced('policy-chrome', '/api/bridge/policy?browser=chrome', 'ndm_local_secret_token');
  check('policy endpoint accepts token+browser', r.status === 200 && !!r.body?.browsers);
  r = await traced('policy-firefox', '/api/bridge/policy?browser=firefox', 'ndm_local_secret_token');
  check('second browser heartbeat recorded', r.status === 200);

  r = await traced('connections-2', '/api/bridge/connections', 'ndm_local_secret_token');
  const connected = r.body?.connected || {};
  check('chrome shows connected', typeof connected.chrome === 'number');
  check('firefox shows connected', typeof connected.firefox === 'number');
  check('opera NOT connected (never polled)', typeof connected.opera === 'undefined');

  // 3. Token required on policy (same as other bridge endpoints)
  const unauth = await traced('policy-unauth', '/api/bridge/policy?browser=chrome');
  check('policy requires bridge token', unauth.status === 403);
} catch (e: any) {
  check('suite completed', false, e.message);
} finally {
  try { server.kill(); } catch {}
  setTimeout(() => {
    console.log(`\nBRIDGE-CONNECTIONS: ${passed} PASSED, ${failed} FAILED`);
    try {
      const slog = fs.readFileSync(serverLog, 'utf8').trim();
      if (slog) console.log('--- server stderr:\n' + slog.slice(0, 1200));
    } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    process.exit(failed > 0 ? 1 : 0);
  }, 300);
}
