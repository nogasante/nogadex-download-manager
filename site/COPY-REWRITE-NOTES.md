# Copy Rewrite — Code Audit Notes

The code is the source of truth for what the site may claim. Every factual claim on the site was checked against the implementation (server engine, Electron main process, settings store, release workflow). This file records what was verified, what was corrected, and what was dropped.

Date: 2026-09-27 · Scope: `site/*.html`, `site/assets/*.js`

## Verified claims (kept)

| Claim | Evidence |
|---|---|
| Multi-connection downloads, "up to 32 connections" | NewDownloadDialog slider `max={32}`; API accepts up to 64 (`server.ts` POST validation), but the UI offers 32, so copy follows the UI. Engine clamps manual counts to 1–64 (`engine.ts` setDownloadConnections). |
| Resume after lost connection, restart, or shutdown without re-downloading completed parts | Engine persists per-chunk byte ranges to `.hyper_state.json` (`saveState`/`loadState`, periodic checkpoint); transient-drop path resumes from exact byte offset (`TRANSIENT_DROP_PATTERN` handling). Covered by test suites (`test_integrity`, `test_correctness`). |
| SHA-256 verification available for completed downloads | `verifyFile()` in `server/integrity_scanner.ts`; runs from `scanIntegrity()` (Downloads → Integrity Scan) and records verdicts on rows. |
| Scheduling with time windows, days, per-queue speed limit, concurrency | `QueueSchedule`: `startAtTime`/`stopAtTime`, `daysOfWeek`, `speedLimitKB`, `maxConcurrent`; overnight windows supported (`isTimeInWindow`). |
| Global and per-download speed limits | `setGlobalSpeedLimit`, `setDownloadSpeedLimit`, wired from settings. |
| Batch downloads and page-based file collection | Batch + Site Grabber dialogs; `site_grabber_engine.ts`; grabber endpoint in `server.ts`. |
| No telemetry/accounts | No analytics or telemetry calls found anywhere in `server/` or `src/`. |
| Update checks contact GitHub | `autoUpdater` (electron-updater), GitHub provider in `package.json` publish config. |
| Checksums published per release | `.github/workflows/release.yml` generates `CHECKSUMS.sha256` and attaches it to the release. |
| Private network addresses rejected before connecting | `validateUrl()` blocks loopback, RFC1918 ranges, link-local/ULA IPv6, cloud metadata IP, IPv4-mapped IPv6, and dangerous ports; DNS resolution uses `createSSRFSafeLookup` (`engine.ts` request `lookup`). |
| Bug report includes app version and platform only | HelpCenterDialog `envBlock`: app name/version/arch, `navigator.platform`, `navigator.userAgent`. No download history. |
| Per-user install, no admin password | NSIS `perMachine: false` in `package.json`. |
| macOS/Linux "coming soon" | electron-builder declares mac/linux targets, but release workflow builds Windows only; no published artifacts exist. |

## Corrected claims (was inaccurate or overstated on the old site)

| Old wording | Problem | New wording |
|---|---|---|
| "every completed download is checked" / "SHA-256 verification on every completed file" | Verification is on-demand (Integrity Scan), not automatic on completion. | "Completed downloads can be checked with SHA-256. You can run the check again whenever you need to." / card: "Run the check from the Downloads menu". |
| "checks for updates only when you ask" | The app checks GitHub automatically at startup by default (`setTimeout(... checkForUpdates, 6000)` gated by `checkAutomatically`, default true). | FAQ now says it checks GitHub for updates and that automatic checks can be turned off in Options, Updates. Homepage/why-grid phrased as "update checks" without "only when you ask". |
| "Scheduler with quiet hours" / "quiet hours, speed caps" | "Quiet hours" is not a concept anywhere in the code. | "Set time windows for downloads", "time windows and days". |
| "Auto-update checks with a safety wait while downloads are active" (Settings caption) | No code found that delays updates while downloads run. | "Configure NDM, including update checks and application preferences." |
| "An NDM folder inside your usual Downloads folder" | Default is the plain Downloads folder (`settings_store.ts`); category subfolders only exist when auto-categorize routes a file. | "Your Downloads folder by default. You can change it in Options, or pick a different folder per download." |
| "Windows showed a warning... Click More info → Run anyway" (no reason given) | Warning exists because the installer is not code-signed (`verifyUpdateCodeSignature: false`, no signing cert in the workflow). | FAQ states the installer is not code-signed yet, and points to CHECKSUMS.sha256 for verification. |
| "The engine already runs on both" (mac/Linux) | Cannot be verified from published releases; per instructions, dropped. | "They are planned. The build configuration targets macOS (.dmg) and Linux (AppImage, .deb), but published builds are not available yet." |
| "about 350 MB free" | Installed size measured at ~405 MB (`win-unpacked`). | "about 400 MB free". |

## Dropped / replaced marketing phrasing

- "stitched back perfectly" / "byte-exact resume" (as a headline) → factual resume description. ("Byte-exact" survives nowhere as a claim; resume behavior is described concretely.)
- "Survives interruptions" → "Resume downloads".
- "Your rules", "one-click pause", "smart, not wasteful", "it's all read", "cap NDM so video calls stay smooth" → removed.
- Em dashes as sentence glue in benefit items → periods. Remaining em dashes: page `<title>` separators and code comments only.
- Checkmarks (✓) and ellipses (…) in demo labels → plain words ("Resumed, nothing downloaded twice", "Verifying", "sha256: ... " kept as a hash truncation, not punctuation).
- "Blocked before any connection is made" kept but scoped: it describes the SSRF validation, which does reject before connecting.

## Known remaining approximations (flagged, not hidden)

1. "up to 32 connections" — the engine's hard cap is 64 via API; 32 is the UI slider max. Copy follows the UI.
2. Demo labels/feature-card numbers (6.2 GB, 14.8 GB, 42.0 MB/s, "1 link to 8 files") are illustrative demo content, not product claims.
3. Homepage size "110.6 MB" comes from `RELEASES_SEED`; the live GitHub release overwrites it when one exists. The seed must be updated on each release.
4. The download-page tab preselection detects the visitor's OS; mac/linux visitors land on a coming-soon pane by design.
