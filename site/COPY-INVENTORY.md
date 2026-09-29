# NDM Site — Copy Inventory

Every piece of wording on the site, where it lives, and what it's doing there. Updated after the plain-language copy rewrite (voice: clear, direct, factual; no marketing adjectives).

**How wording flows:** most copy is static HTML in each page. Two shared files inject text at runtime:
- `site/assets/partials.js` — nav + footer (same on every page)
- `site/assets/site.js` — release data (version/size/asset/notes), demo & card animation strings, viewer captions, form feedback

Placeholders like `[data-ver]` / `[data-size]` / `[data-asset]` are overwritten by `site.js` from `RELEASES_SEED` (or live GitHub releases once they exist).

**Accuracy notes from the code audit (see `COPY-REWRITE-NOTES.md`):** SHA-256 checks run from the Downloads menu (Integrity Scan), not automatically on completion. Update checks contact GitHub by default at startup and can be turned off. The scheduler uses time windows and days, not "quiet hours". Default download folder is the user's Downloads folder. The Windows installer is not code-signed; releases publish `CHECKSUMS.sha256`.

---

## 1. Shared chrome — every page (`assets/partials.js`)

### Top navigation
| Wording | Where | Job |
|---|---|---|
| Home / Download / Screens / Features / FAQ / Contact | nav buttons, icon+label | page links |
| Light / Dark | theme switch buttons (aria: "Light theme" / "Dark theme", group aria-label "Theme") | site theme toggle |
| GitHub | nav button, external | link to repo |
| `Menu` | burger aria-label (mobile) | opens mobile nav |
| GitHub ↗ | mobile nav extra link | external repo link |

### Footer
| Wording | Where | Job |
|---|---|---|
| Nogadex Download Manager | footer brand name | product identity |
| A free, open-source download manager for Windows with multi-connection downloads, resume support, file verification, scheduling, and more. | footer brand description | one-line summary |
| Product | footer column heading | links group |
| Home / Download / Screens / Features / FAQ / Contact / Changelog | footer Product links | page links |
| Project | footer column heading | links group |
| GitHub / Releases / Issues / License (MIT) | footer Project links | repo links |
| © 2026 Nogadex Systems — MIT License. | footer legal line | copyright |

---

## 2. Home — `index.html`

**`<title>`:** NDM — Nogadex Download Manager for Windows
**meta description:** A free, open-source download manager for Windows with multi-connection downloads, resume support, file verification, scheduling, and batch downloads.

| Wording | Where | Job |
|---|---|---|
| Nogadex Download Manager | hero `<h1>` | product name |
| A download manager for Windows that can use multiple connections, resume interrupted downloads, and verify completed files. Free and open source. | hero lede paragraph | core pitch |
| Download for Windows | primary button (`data-dl`) | main CTA — href filled from releases |
| View downloads | ghost button | → download page |
| Explore features | ghost button | → features page |
| v1.0.5 · 110.6 MB · Windows · macOS and Linux coming soon · What's new | `dl-facts` line (`[data-ver]`, `[data-size]` auto-filled) | release facts; "What's new" links to changelog |
| NDM main window | hero screenshot `alt` | accessibility |
| Why use NDM? | section `<h2>` | benefits intro |
| **Multiple connections.** Large downloads can use multiple connections at the same time to make better use of available bandwidth. | why-grid item | benefit 1 |
| **Resume downloads.** Continue interrupted downloads after a lost connection, restart, or shutdown without downloading completed parts again. | why-grid item | benefit 2 |
| **File verification.** Completed downloads can be checked with SHA-256. You can run the check again whenever you need to. | why-grid item | benefit 3 |
| **Scheduling and limits.** Set download schedules, speed limits, and concurrency limits, and pause or resume the queue when needed. | why-grid item | benefit 4 |
| **Private by default.** No account, ads, or telemetry. NDM only connects to the servers required for your downloads and update checks. | why-grid item | benefit 5 |
| **Free and open source.** NDM is released under the MIT License and is free to use for personal and commercial projects. | why-grid item | benefit 6 |

---

## 3. Download — `download.html`

**`<title>`:** Download — NDM
**meta description:** Download NDM for Windows. Free, open source, MIT licensed.

| Wording | Where | Job |
|---|---|---|
| Download | `<h1>` | page title |
| Choose a build for your platform. | `dl-sub` | platform subtitle |
| Windows / macOS / Linux | OS tabs (`role=tablist`) | platform switch; visitor's OS preselected |
| Downloads | column heading | downloads column |
| EXE Installer | binary row (`data-dl="windows"`) | installer link (href from releases) |
| SHA-256 Checksums | binary row | CHECKSUMS.sha256 link on GitHub releases |
| Previous versions → | `dl-more` link | → changelog page |
| Verify your download | column heading | verification column |
| CERTUTIL | `cmd-label` | names the shell the command is for |
| `certutil -hashfile NDM_Setup_1.0.5.exe SHA256` | command line (`[data-asset]` auto-filled) | copy-paste verify command |
| Copy command / Copied | copy button aria-label (+ 1.2 s state) | clipboard affordance feedback |
| macOS builds are coming soon. | macOS pane | platform not yet available |
| Linux builds are coming soon. | Linux pane | platform not yet available |

---

## 4. Screens — `screens.html` + captions in `site.js`

**`<title>`:** Screens — NDM

| Wording | Where | Job |
|---|---|---|
| Screens | `<h2>` | page title |
| A look at NDM's current interface. Click a screenshot to view it. | `dl-sub` | explains the viewer |
| Main window / New Download / Scheduler / Settings / Diagnostics / Help Center | thumbnail rail labels + viewer header name | selects which shot shows |
| Ctrl+N / Ctrl+Q / Ctrl+, / Ctrl+D / F1 | `viewer-keys` badges | shortcut hint per dialog |
| Previous / Next / `1 / 6` | viewer footer buttons + counter | navigate shots |
| NDM {name} | image alt template | accessibility |

**Viewer captions** (in `site.js`, `SHOTS` array):
| Shot | Caption |
|---|---|
| Main window | The download queue with connection status, download speed, progress, and controls. |
| New Download | Add a download, choose its location, and configure options such as connections and speed limits. |
| Scheduler | Set time windows for downloads and choose when NDM should run transfers. |
| Settings | Configure NDM, including update checks and application preferences. |
| Diagnostics | View connection states, retries, and download integrity information. |
| Help Center | Find keyboard shortcuts, common questions, and information for reporting bugs. |

---

## 5. Features — `features.html` + demo strings in `site.js`

**`<title>`:** Features — NDM
**meta description:** Explore NDM's download features, including multi-connection downloads, resume support, file verification, scheduling, and batch downloads.

### Live demo window (top of page)
| Wording | Where | Job |
|---|---|---|
| Nogadex Download Manager | demo title bar | looks like the real app |
| Interactive demo. Try the controls. | demo hint | invites play |
| Pause all / Resume all / Cut connection / Restart | demo buttons (+ aria "Pause all downloads", "Resume all downloads", "Cut the connection", "Restart the demo") | demo controls |
| Two files are downloading over multiple connections. Cut the connection to see how NDM resumes the download. | default note | explains the demo |
| Downloads paused. Resume them to continue from where they stopped. | note after Pause all | state feedback |
| Connection interrupted. Resume the downloads to continue without re-downloading completed parts. | note after Cut connection | state feedback |
| ubuntu-26.04-desktop-amd64.iso — 6.2 GB · 8 connections | demo row 1 | sample file |
| big-buck-bunny-4k.mkv — 14.8 GB · 16 connections | demo row 2 | sample file |
| Done / Lost @ N% / Paused @ N% / `N% · X.X MB/s` | row status text | per-row state |

### Feature cards (accordion; demos run when opened)
| Card title | Body copy | Demo labels (animated) |
|---|---|---|
| Parallel downloads | Large files can use up to **32 connections at the same time**. NDM combines the downloaded parts into the original file when the transfer is complete. Smaller downloads can use fewer connections. | 1 connection / 32 connections |
| Resume from where you stopped | NDM saves download progress so interrupted transfers can continue after **crashes, restarts, or lost connections**, without downloading completed parts again. | Part 1 and Part 2 saved, picking up from byte 61% → Resumed, nothing downloaded twice |
| File verification | Completed downloads can be verified with **SHA-256**. Run the check from the Downloads menu to confirm a file still matches what the server sent. | Verifying / sha256: 9f2c4e81b7d0a635... / Matches the release |
| Batch & page grabber | Paste a list of links, or point NDM at a page and **collect the downloadable files it links to**. Added links go straight to the queue. | 1 link to 8 files queued / queuing N / 8 files / 1 link to 8 files queued |
| Scheduler & speed caps | Set **time windows and days** for queue schedules, with per-queue speed limits and concurrency limits. Pause or resume the queue when you need to. | 42.0 MB/s → Capped at 12.0 MB/s |
| Private by default | No account, ads, or telemetry. NDM only connects to the servers required for your downloads and update checks. Requests to private network addresses are **rejected before a connection is made**. | http://192.168.1.10/setup.exe, resolving → blocked, private address |

---

## 6. FAQ — `faq.html`

**`<title>`:** FAQ — NDM

Page heading: **FAQ**. Nine accordion Q&A pairs:

| Question | Answer |
|---|---|
| Is NDM really free? | Yes. NDM is MIT licensed. It is free for personal and commercial use, with no paid tier and no ads. The license text is in the app under Help, License & Legal. |
| Will it work on my PC? | Today: Windows 10 or 11 (64-bit) with about 400 MB free. The installer is per-user, so no administrator password is needed. macOS and Linux builds are planned; see the Download page for the current status. |
| My internet dropped mid-download. Do I start over? | No. NDM saves progress as it downloads. When the connection is back, it continues from where it stopped, even after a full restart. Completed parts are not downloaded again. |
| Windows showed a warning when I opened the installer. | The installer is not code-signed yet, so Windows shows this warning for new apps. Choose More info, then Run anyway. A CHECKSUMS.sha256 file is published with every release so you can verify the file you downloaded. |
| Where do my downloads go? | Your Downloads folder by default. You can change it in Options, or pick a different folder per download. |
| Does NDM collect anything about me? | No account, no analytics, no ads. NDM connects to the servers you download from, and installed builds check GitHub for updates when the app starts. That check is on by default; you can turn it off in Options, Updates. |
| Is there a Mac or Linux version? | They are planned. The build configuration targets macOS (.dmg) and Linux (AppImage, .deb), but published builds are not available yet. Check the Download page for status. |
| How do updates work? | In the app: Help, Check for Updates. NDM checks GitHub for new versions, downloads an update only after you approve it, and installs it on the next restart. |
| Found a bug. What's the fastest way to get it fixed? | Use Help, Report a Bug in the app. It opens a GitHub issue draft and includes your app version and platform. It does not include your download history. |

---

## 7. Contact — `contact.html` + form logic in `site.js`

**`<title>`:** Contact — NDM
**meta description:** Contact the NDM team with feedback, bug reports, and feature requests.

| Wording | Where | Job |
|---|---|---|
| Contact | eyebrow line | section label |
| Get in touch | `<h1>` | page title |
| Feedback, bug reports, and feature requests. | `dl-sub` | invitation |
| What is it about? | form label | topic select |
| Feedback / Issue / Feature request | topic options | routes the mail subject |
| Name (placeholder: Jane Doe) | field label + placeholder | sender name |
| Subject (placeholder: One line that says it) | field label + placeholder | mail subject |
| Message (placeholder: If it's an issue: what you did, what you expected, what happened instead. A download log helps a lot.) | field label + placeholder | mail body |
| Open in your mail app | submit button | explains the mailto mechanism |
| Opening your mail app | status line after submit | confirmation |
| Other ways to contact us | card heading | alternative channels |
| Prefer not to use the form? You can contact the project directly. | card intro | leads into links |
| Email | `data-mail-text` link (address injected) | mailto contact |
| Report an issue on GitHub | channel link | issues page |
| Discussions | channel link | GitHub discussions |
| Before reporting a bug | card heading | deflection |
| Check the FAQ first. If the problem persists, include enough information for us to reproduce it. | card body + FAQ link | self-serve first |

Mail composition (in `site.js`): subject `[NDM {topic}] {subject}`, body `Topic: … / From: … / message`. The generic nav-mail subject is `[NDM] Hello`.

---

## 8. Changelog — `changelog.html` + release data in `site.js`

**`<title>`:** Changelog — NDM
**meta description:** Every NDM release: what changed, version by version.

| Wording | Where | Job |
|---|---|---|
| Changelog | `<h2>` | page title |
| Release history and changes in each version. | `dl-sub` | page intent |
| Loading releases | placeholder row | pre-render state |
| Latest / Pre-release | version tags | release classification |
| `v1.0.5` + date | rendered per release | version + date |

**Seed release notes (v1.0.5 — replaced by real GitHub releases when they exist):**
1. Initial public release.
2. Support for multi-connection downloads with up to 32 connections.
3. Resume interrupted downloads without re-downloading completed parts.
4. SHA-256 verification for completed downloads.
5. Download scheduling and bandwidth limits.
6. Batch downloads and page-based file collection.
7. Built-in diagnostics and Help Center.
8. Bug reporting from within the application.

---

## 9. Single-source constants (`site.js`)

| Constant | Value | Feeds |
|---|---|---|
| `REPO` / `REPO_API` | github.com/nogasante/nogadex-download-manager | all repo links, release fetch |
| `CONTACT_EMAIL` | nanasante2000@gmail.com | every `[data-mail-*]` slot |
| `RELEASES_SEED` | v1.0.5, 2026-09-26, NDM_Setup_1.0.5.exe, 115994266 bytes | `[data-dl]`, `[data-ver]`, `[data-size]`, `[data-asset]`, changelog |
