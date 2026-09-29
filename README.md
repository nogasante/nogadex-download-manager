# Nogadex Download Manager (NDM)

**NDM** is a fast, reliable multi-stream download manager for Windows — parallel segmented downloads, instant resume, a scheduler, and built-in integrity verification. It is built with Node.js, Electron, React, and TypeScript, and uses dynamic range work-stealing, adaptive network concurrency, and bounded asynchronous disk I/O to maximize transfer throughput while maintaining byte-for-byte integrity and crash resilience.

---

## Features

- **Parallel Segmented Engine**: Downloads are split across multiple HTTP range connections, with idle workers dynamically stealing unfinished sub-ranges from slow or straggling workers.
- **Auto Connection Mode**: Leave the stream count on Auto and NDM picks the right tier automatically (1 stream for small files, scaling up to 32 for large ones) — or set a fixed count yourself.
- **Instant Resume**: Pause and resume at byte level, across app restarts, with atomic state checkpoints and automatic corrupted-state recovery.
- **Adaptive Network Intelligence**: Real-time throughput and RTT sampling, automatic concurrency scaling, and exponential backoff on HTTP `429` / `503` responses.
- **Scheduler / Queue**: Time windows, speed limits, and concurrency caps for when and how downloads run.
- **Integrity Scanner**: Built-in SHA-256 verification of known files, with a baseline ledger that flags content drift between scans.
- **Duplicate-Safe Links**: Adding the same URL twice reuses or retries the existing row instead of creating duplicates, with anti-collision destination naming.
- **Batch & Site Grabber**: Queue many files at once or harvest all downloadable links from a page.
- **Deep Security Architecture**:
  - **Socket-Level SSRF Interception**: Custom DNS lookup hooks block private IPs (RFC 1918, cloud metadata `169.254.169.254`, IPv6 loopback / link-local / ULA, and IPv4-mapped IPv6) before any TCP handshake.
  - **Path Traversal & Device Name Guards**: Full NFC normalization, zero-width character removal, NTFS ADS `:` neutralization, and Windows reserved device name handling (`CON`, `PRN`, `AUX`, `NUL`).
  - **Hardened Electron Wrapper**: `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, popup blocker, and local origin navigation lockdown.

---

## Installation & Quick Start

### End users

Download `NDM_Setup_<version>.exe` from the [Releases page](https://github.com/nogasante/nogadex-download-manager/releases), run the installer, and go. NDM registers the `ndm://` and `nogadex://` protocol handlers so browser extensions and other apps can hand off downloads.

**Browser extension:** load the `browser-extension/` folder via `chrome://extensions` → Developer mode → *Load unpacked*. Download interception and right-click menus work immediately with no site access. The in-page download panel, capture keys, and cookie passthrough are strictly opt-in: click the NDM toolbar icon once and confirm the "read and change all your data on all sites" prompt (the icon shows an **ON** badge when active; click again to revoke). NDM only ever talks to the engine on your own machine (`127.0.0.1:5005`).

### Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org). The full policy — team roles, what gets signed, and build integrity rules — lives in [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md).

Privacy policy: This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

### Windows SmartScreen note

Until a signed installer has accumulated enough download history with Microsoft, Windows may still show the "Windows protected your PC" screen for the first releases after signing. The signature removes the "Unknown publisher" warning right away; the remaining SmartScreen notice fades automatically as reputation builds. The installer is built reproducibly from the public source in this repository — see `CHECKSUMS.sha256` on every release to verify your download.

### Developers

**Prerequisites:** Node.js v20.x or v22.x+, npm v10.x+

```bash
# Clone the repository
git clone https://github.com/nogasante/nogadex-download-manager.git
cd nogadex-download-manager

# Install dependencies
npm install

# Start development mode (backend engine + React UI in Electron)
npm run desktop
```

**Web development mode** (engine + Vite dev server, no Electron):

```bash
npm run dev
```

**Build the Windows installer:**

```bash
npm run dist
```

---

## Configuration & File Locations

- **Default Download Directory**: `~/Downloads/NDM` (configurable in Options and per download).
- **State Checkpoint File**: `.hyper_state.json` in the default download directory (auto-saved periodically and on graceful shutdown).
- **Integrity Baseline**: `.hyper_integrity.json` in the default download directory.
- **Default Engine Port**: `5005` (configurable via the `PORT` environment variable).

---

## Testing & Quality Assurance

NDM includes 33 automated test suites covering 400+ assertions:

```bash
# Run all automated test suites
npm run test:all

# Run the release gate
npm run test:gate

# Run the performance benchmark matrix
npm run benchmark
```

---

## Help & Support

- **In-app Help Center**: Help → Help Center (or press **F1**) for how-to guides, the FAQ, and license information.
- **Bugs & feedback**: Help → Report a Bug, or open an issue at <https://github.com/nogasante/nogadex-download-manager/issues>.

---

## Security Model & Limitations

- **Loopback-only, token-gated engine**: the engine binds strictly to `127.0.0.1`. Every `/api` route and the `/ws` live-update socket require the shared local bridge token (`X-NDM-Token`), and no CORS origins are granted — pages opened in any web browser cannot drive or read the engine.
- **Encrypted secrets at rest**: proxy passwords and site credentials in `settings.json` are encrypted (AES-256-GCM) with a per-install master key sealed by the OS through Electron `safeStorage` (DPAPI on Windows). If the engine runs standalone (outside Electron), secret encryption is unavailable and values are stored in plaintext.
- **Production SSRF Protection**: In production (`allowLocalhost: false`), all outgoing connections are validated both at the URL parse stage and at the raw socket DNS resolution layer.
- **Forward Proxy Note**: In enterprise environments where traffic routes through an upstream caching forward proxy, ensure the proxy enforces equivalent subnet access policies.
- **Packaging Note**: Production desktop distributions package pre-compiled web bundles (`dist/index.html`) loaded directly over secure local `file://` protocols.
- **Code Signing**: Installers are currently unsigned — Windows SmartScreen and macOS Gatekeeper may warn on first run.

---

## License

NDM is released under the [MIT License](LICENSE). Copyright © 2026 Nogadex Systems. Third-party packages retain their own licenses — see Help → Help Center → License & Legal inside the app for the full notice list.
