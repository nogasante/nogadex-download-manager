# Code Signing Policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## Team roles

- **Authors / Committers & reviewers:** [nogasante](https://github.com/nogasante) (repository maintainer)
- **Approvers:** [nogasante](https://github.com/nogasante?tab=followers) (release signing approval)

Signing requests are submitted exclusively by the release workflow (`.github/workflows/release.yml`) and require manual approval before a certificate is applied.

## Privacy policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

The NDM engine runs locally on `127.0.0.1` only. Update checks contact GitHub Releases only when the user asks for them (Help → Check for Updates). The browser extension communicates exclusively with the local engine — no data leaves the user's machine through NDM.

## What gets signed

- Windows installer (`NDM_Setup_<version>.exe`) built by the tagged release workflow from this repository's source.
- Only artifacts produced by this repository's own GitHub Actions builds are signed. Upstream third-party binaries (Electron runtime, etc.) are included unsigned, as permitted by the SignPath Foundation conditions.

## Build integrity

- Releases are built only from `v*.*.*` git tags on this repository, on GitHub-hosted runners.
- The release gate test suite (`npm run test:gate`) must pass before any artifact is produced.
- Every signing request is manually reviewed and approved in SignPath before the signed installer is published.
