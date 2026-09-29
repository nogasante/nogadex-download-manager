# Code Signing Policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## Team roles

- **Authors / Committers & reviewers:** [nogasante](https://github.com/nogasante) (repository maintainer)
- **Approvers:** [nogasante](https://github.com/nogasante?tab=followers) (release signing approval)

Signing requests are submitted exclusively by the release workflow (`.github/workflows/release.yml`) and require manual approval before a certificate is applied.

## Privacy policy

NDM contains no telemetry: no analytics, tracking, advertising, or crash-reporting code, and no accounts or servers of its own. It does, however, make network connections as a download manager. Specifically:

- **The local engine.** The NDM engine binds to `127.0.0.1` (loopback) only. The app's interface and the browser extension communicate with the engine locally; this traffic never leaves the user's machine.
- **The servers the user downloads from.** Download traffic is user-initiated: URLs come from the user or from the browser extension acting on the user's actions. NDM connects directly to those servers to fetch the requested files; downloads are not routed through any NDM-operated system.
- **GitHub Releases (update checks).** In packaged builds, NDM checks the project's GitHub Releases feed for newer versions automatically at startup, by default. Like any HTTPS request, this exposes the user's IP address to GitHub. The check can be disabled in Options → Updates ("Check automatically for new versions"); a manual check is available in the same place. Update downloads occur only after the user accepts an update, or enables automatic installation on exit.

All NDM data — settings, download state, logs — is stored locally on the user's machine. Proxy and site credentials are encrypted at rest with a key sealed by the OS (plaintext fallback when the engine runs outside the desktop app without OS key sealing).

## What gets signed

- Windows installer (`NDM_Setup_<version>.exe`) built by the tagged release workflow from this repository's source.
- Only artifacts produced by this repository's own GitHub Actions builds are signed. Upstream third-party binaries (Electron runtime, etc.) are included unsigned, as permitted by the SignPath Foundation conditions.

## Build integrity

- Releases are built only from `v*.*.*` git tags on this repository, on GitHub-hosted runners.
- The release gate test suite (`npm run test:gate`) must pass before any artifact is produced.
- Every signing request is manually reviewed and approved in SignPath before the signed installer is published.
