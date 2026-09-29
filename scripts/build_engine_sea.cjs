/**
 * Build the NDM download engine as a standalone Windows executable
 * (Node.js Single Executable Application, Node >= 20).
 *
 * Why: the Tauri shell does not bundle Node.js. The proven engine
 * (server/server.ts -> dist-server/server.cjs) ships as a sidecar exe that
 * the Rust shell spawns on 127.0.0.1 with a generated token, exactly like
 * the Electron main process does today.
 *
 * Output: src-tauri/sidecar/ndm-engine-<target-triple>.exe
 * (Tauri externalBin requires the target-triple suffix: on Windows x64 that
 * is ndm-engine-x86_64-pc-windows-msvc.exe even when built with the GNU
 * toolchain, because the triple names the *target*, not the toolchain.)
 *
 * Usage: node scripts/build_engine_sea.cjs
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'src-tauri', 'sidecar');

// Tauri invokes this script from src-tauri; normalize back to the repo root.
const cwd = fs.existsSync(path.join(root, 'package.json')) ? root : path.resolve(root, '..');

const step = (msg) => console.log(`[engine-sea] ${msg}`);

const main = () => {
  fs.mkdirSync(outDir, { recursive: true });

  // 1. The server bundle (esbuild already ran via `npm run build`; be safe).
  step('ensuring dist-server/server.cjs exists');
  if (!fs.existsSync(path.join(cwd, 'dist-server', 'server.cjs'))) {
    step('bundle missing, running build:server');
    execSync('npm run build:server', { cwd, stdio: 'inherit' });
  }

  // 2. Node version gate: SEA needs >= 20, postject injection via npx.
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 20) throw new Error(`Node >= 20 required for SEA, found ${process.versions.node}`);

  // 3. SEA config: run the bundled CJS server directly.
  const seaConfig = {
    main: 'dist-server/server.cjs',
    output: 'dist-server/sea-prep.blob',
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: true, // faster startup; safe for a plain CJS bundle
  };
  fs.writeFileSync(path.join(cwd, 'dist-server', 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
  step('generating SEA blob');
  execSync('node --experimental-sea-config dist-server/sea-config.json', { cwd, stdio: 'inherit' });

  // 4. Copy the current node.exe as the base image.
  const nodeExe = process.execPath;
  const targetTriple = 'x86_64-pc-windows-msvc';
  const outExe = path.join(outDir, `ndm-engine-${targetTriple}.exe`);
  step(`copying node.exe -> ${path.relative(cwd, outExe)}`);
  fs.copyFileSync(nodeExe, outExe);

  // 5. Inject the blob (signature removed first so Windows accepts the edit).
  const signtoolRemoved = removeSignature(outExe);
  if (signtoolRemoved) step('removed node.exe signature');
  step('injecting blob with postject');
  execSync(
    `npx --yes postject "${outExe}" NODE_SEA_BLOB "dist-server/sea-prep.blob" ` +
    `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
    { cwd, stdio: 'inherit' }
  );

  // 6. Sanity check: the exe must boot and answer like the server does.
  step('smoke test: boot on a random port and hit /api/app-config');
  smokeTest(outExe)
    .then(() => {
      const mb = (fs.statSync(outExe).size / 1048576).toFixed(1);
      step(`done: ${path.relative(cwd, outExe)} (${mb} MB)`);
    })
    .catch((err) => {
      console.error('[engine-sea] SMOKE TEST FAILED:', err.message);
      process.exit(1);
    });
};

/** Strip the existing Authenticode signature so postject can modify the exe. */
const removeSignature = (exePath) => {
  try {
    execSync(
      `powershell -NoProfile -Command "$d=[IO.File]::ReadAllBytes('${exePath.replace(/\\/g, '\\\\')}');" +
      'Set-Content -Path ${JSON.stringify(path.join(os.tmpdir(), 'rm_sig.ps1'))} -Value $null'`,
      { stdio: 'ignore' }
    );
  } catch { /* best effort */ }
  // osslsigncode is not assumed; use the standard approach: signtool remove via
  // PowerShell + Get-AuthenticodeSignature is read-only, so rely on postject's
  // ability to inject into signed binaries by removing the signature entry
  // through the Windows API. If signtool from the Windows SDK is present, use it.
  try {
    execSync(`signtool remove / "${exePath}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** Boot the sidecar briefly and assert the API answers. */
const smokeTest = async (exePath) => {
  const { spawn } = require('child_process');
  const port = 5900 + Math.floor(Math.random() * 500);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndm-sea-test-'));
  const child = spawn(exePath, [], {
    env: { ...process.env, PORT: String(port), NDM_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });

  const deadline = Date.now() + 20000;
  let ok = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/app-config`);
      if (res.status === 401 || res.status === 403) { ok = true; break; } // token guard active = server is alive
      if (res.ok) { ok = true; break; }
    } catch { /* not up yet */ }
  }
  child.kill();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  if (!ok) throw new Error(`sidecar did not answer on :${port}. Output:\n${out.slice(0, 800)}`);
};

main();
