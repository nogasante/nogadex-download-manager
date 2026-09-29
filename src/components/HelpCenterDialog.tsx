import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Bug,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Keyboard,
  MessageSquare,
  Save,
  Scale,
  Send,
} from 'lucide-react';
import { WindowsDialog } from './common/WindowsDialog';
import { WinButton } from './common/WinControls';
import { APP_NAME, APP_SHORT_NAME, APP_VERSION, APP_ARCH } from '../config/appInfo';
import { openExternal } from '../utils/openExternal';

type HelpTab = 'howto' | 'faq' | 'bug' | 'feedback' | 'legal';

interface HelpCenterDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isStandalone?: boolean;
  initialTab?: HelpTab;
  /** Deep-link: open straight into this guide id (e.g. 'pause-resume'). */
  initialGuide?: string;
}

const GITHUB_REPO = 'https://github.com/nogasante/nogadex-download-manager';
const GITHUB_NEW_ISSUE = `${GITHUB_REPO}/issues/new`;

const TABS: { id: HelpTab; label: string; icon: React.ReactNode }[] = [
  { id: 'howto', label: 'How-To Guides', icon: <BookOpen size={14} /> },
  { id: 'faq', label: 'FAQ', icon: <CircleHelp size={14} /> },
  { id: 'bug', label: 'Report a Bug', icon: <Bug size={14} /> },
  { id: 'feedback', label: 'Feedback', icon: <MessageSquare size={14} /> },
  { id: 'legal', label: 'License & Legal', icon: <Scale size={14} /> },
];

/**
 * A guided how-to "book": the user picks a topic from the shelf, then reads
 * it page by page (one page = one step group). Adding a new guide is just a
 * new object here — the browser UI, pagination and progress come for free.
 */
interface GuidePage {
  /** Optional page heading; defaults to "Step N". */
  heading?: string;
  /** The page body: one instruction, tips allowed (kept short on purpose). */
  body: string;
  /** Optional extra detail shown as a dim note under the body. */
  note?: string;
}

interface Guide {
  id: string;
  title: string;
  /** One-line summary shown under the title on the cover page. */
  summary: string;
  /** Small lucide icon rendered next to the title in the shelf. */
  icon: React.ReactNode;
  pages: GuidePage[];
}

const GUIDES: Guide[] = [
  {
    id: 'first-download',
    title: 'Add your first download',
    summary: 'From a copied link to a finished file in four steps.',
    icon: <BookOpen size={13} />,
    pages: [
      {
        heading: 'Open the address dialog',
        body: 'Press Ctrl+N, click "Add URL" on the toolbar, or paste a link directly — the address dialog opens and picks up whatever URL is on your clipboard.',
      },
      {
        heading: 'Confirm the address',
        body: 'The address field is pre-filled. Press OK to continue to the download details. If the site needs a login, tick "Use authorization" and enter your credentials first.',
        note: 'Recent addresses appear as chips below the field for one-click reuse.',
      },
      {
        heading: 'Check the details',
        body: 'NDM suggests a file name and destination folder based on the file type. Leave the connection setting on "Auto" to let NDM pick the best number of connections for this server.',
        note: 'The file name you set here is kept even if the server suggests a different one.',
      },
      {
        heading: 'Start it',
        body: 'Click "Download Now" to start immediately — the live progress window opens by itself. Choose "Download Later" to place it in the queue paused.',
      },
    ],
  },
  {
    id: 'pause-resume',
    title: 'Pause, resume & retry',
    summary: 'Byte-exact resume that survives restarts.',
    icon: <BookOpen size={13} />,
    pages: [
      {
        heading: 'Pause any download',
        body: 'Select the row and press Space, or click Pause. NDM remembers exactly how much of the file is already on disk — nothing is lost.',
      },
      {
        heading: 'Resume where it stopped',
        body: 'Click Resume (or press Space again). The download continues exactly where it stopped — even after closing the app or rebooting.',
      },
      {
        heading: 'Retry failures in place',
        body: 'Right-click a failed row and choose Retry. The parts already on disk are kept; only the missing ranges are fetched again.',
        note: 'For expired links, use Refresh Link in the failed download\'s window to hand NDM a fresh URL.',
      },
      {
        heading: 'Bulk operations',
        body: 'Toolbar → Resume dropdown → "Retry All Failed" (Ctrl+Alt+R) retries every failed download at once. Pause All and Resume All live in the same menu.',
      },
    ],
  },
  {
    id: 'logins',
    title: 'Logins, links & access',
    summary: 'When a site wants a sign-in or the link has expired.',
    icon: <BookOpen size={13} />,
    pages: [
      {
        heading: 'Expired or refused links',
        body: 'Some links stop working after a while, or the server refuses automated downloads. Click Refresh Link in the failed download\'s window and hand NDM a fresh link from your browser — the parts already on disk are kept.',
      },
      {
        heading: 'Sites that need a sign-in',
        body: 'If the file sits behind a login, download it once in your browser while signed in and hand the fresh link to NDM via Refresh Link, or add the site\'s address through the address dialog and fill in "Use authorization" so NDM can sign in for you.',
        note: 'Stored credentials are kept locally on your PC and sent only to that site.',
      },
      {
        heading: '“Server refused this automated download”',
        body: 'A few sites deliberately block download managers. No setting changes that — open the link in your browser, start the download there, and let your browser hand it to NDM (see the browser capture guide).',
      },
      {
        heading: 'File not found (404)',
        body: 'The file was removed or the link is simply dead. Check the page you got the link from for a newer one, then use Refresh Link.',
      },
    ],
  },
  {
    id: 'batch-grabber',
    title: 'Batch downloads & Site Grabber',
    summary: 'Many files at once, or everything on a page.',
    icon: <BookOpen size={13} />,
    pages: [
      {
        heading: 'Batch download by list',
        body: 'Press Ctrl+B. Paste one URL per line (numbered patterns like file_##.zip with leading zeros work too) and pick a destination.',
      },
      {
        heading: 'Site Grabber',
        body: 'Press Ctrl+G, enter a page URL and NDM collects every downloadable link on it. Filter by file type — video, audio, documents, archives — or custom extensions.',
        note: 'Select exactly the files you want before starting; nothing is downloaded until you confirm.',
      },
      {
        heading: 'Review & start',
        body: 'Both tools show a final list before starting. Untick anything you don\'t need, choose the folder, and start — the queue engine schedules the rest.',
      },
    ],
  },
  {
    id: 'scheduler',
    title: 'Scheduler & speed limits',
    summary: 'Let NDM work on a schedule and cap bandwidth.',
    icon: <BookOpen size={13} />,
    pages: [
      {
        heading: 'Open the scheduler',
        body: 'Press Ctrl+Q or Toolbar → Scheduler. Queues let you group downloads and control them together.',
      },
      {
        heading: 'One-time or weekly windows',
        body: 'For each queue, set "Start download at" / "Stop download at". One-time fires once on a chosen date; Periodic repeats on the weekdays you tick.',
        note: 'A queue can shut the PC down, pause, or just notify when its work finishes.',
      },
      {
        heading: 'Speed limits',
        body: 'Options → Connection has a global limiter; the download window\'s Speed Limiter tab sets one per file. Bandwidth Throttling values are in KB/s.',
      },
    ],
  },
  {
    id: 'integrity',
    title: 'Integrity Scan',
    summary: 'Prove finished files are exactly what the server sent.',
    icon: <BookOpen size={13} />,
    pages: [
      {
        heading: 'Run the first scan',
        body: 'Downloads → Integrity Scan… double-checks every finished file against what the server sent, so you know it\'s complete and undamaged. The first run records a baseline.',
      },
      {
        heading: 'Watch for drift',
        body: 'Later scans re-verify. Files whose content changed since the baseline are flagged (baseline drift) — useful for archives you care about.',
      },
      {
        heading: 'Multi-part verification',
        body: 'Big files are checked in sections while they download, so damage is caught during the download — not after you\'ve tried to open the file.',
      },
    ],
  },
  {
    id: 'browser-capture',
    title: 'Browser capture & capture keys',
    summary: 'Hand downloads from your browser to NDM — on your terms.',
    icon: <BookOpen size={13} />,
    pages: [
      {
        heading: 'Install the extension',
        body: 'Install the NDM extension in your browser. Downloads are then offered to NDM automatically; the in-page panel lists media on the current page.',
      },
      {
        heading: 'Choose which browsers',
        body: 'Options → Browser lets you allow or block capture per browser, and exclude file types or sites you never want taken over.',
      },
      {
        heading: 'Capture keys',
        body: 'Hold a force key (e.g. Alt) while a download starts to capture it even when excluded; hold a prevent key to always leave it to the browser. Configure both in Options → Browser.',
      },
    ],
  },
  {
    id: 'connections',
    title: 'Connections: Auto vs. fixed',
    summary: 'Getting the number of connections right for stubborn servers.',
    icon: <BookOpen size={13} />,
    pages: [
      {
        heading: 'What Auto does',
        body: 'Auto picks the number of connections by file size — one for small files, more for large ones, up to 32 — balancing speed against server limits.',
      },
      {
        heading: 'When to go fixed',
        body: 'Some servers throttle or penalize many connections. If a download stalls, try a fixed lower count such as 4–8 in the download details.',
      },
      {
        heading: 'One stream can be enough',
        body: 'If a single connection already saturates your bandwidth, more streams gain nothing — Auto accounts for this on small files.',
      },
    ],
  },
  {
    id: 'other-apps',
    title: 'Adding downloads from other apps',
    summary: 'When another program wants to hand a download to NDM for you.',
    icon: <BookOpen size={13} />,
    pages: [
      {
        heading: 'It just works — nothing to set up',
        body: 'When you installed NDM, it told Windows: "when something opens an NDM link, bring it to me". You never need to think about this yourself.',
      },
      {
        heading: 'What you\'ll see',
        body: 'If another app or a website offers a "Download with NDM" button and you click it, NDM pops open its download window with the link already filled in. Check the details and click Download Now as usual.',
        note: 'Don\'t worry if you never use this — it changes nothing about how you normally add downloads.',
      },
      {
        heading: 'If nothing happens when you click such a button',
        body: 'That means another download manager took over those links when it was installed. Reinstalling NDM (run the installer again) makes NDM the default again.',
      },
    ],
  },
];

const KEYBOARD_SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl+N', action: 'New download' },
  { keys: 'Ctrl+B', action: 'Batch download' },
  { keys: 'Ctrl+G', action: 'Site Grabber' },
  { keys: 'Ctrl+F', action: 'Search the download list' },
  { keys: 'F5', action: 'Refresh list' },
  { keys: 'Space', action: 'Pause / resume selected' },
  { keys: 'Del', action: 'Delete selected' },
  { keys: 'Ctrl+Alt+R', action: 'Retry all failed' },
  { keys: 'F1', action: 'Open Help Center' },
];

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'Is NDM free?',
    a: 'Yes. NDM is open-source software released under the MIT License — free for personal and commercial use.',
  },
  {
    q: 'Where are my downloads saved?',
    a: 'By default in the "NDM" folder inside your user Downloads folder. You can change the destination per download, or set a different default in Options.',
  },
  {
    q: 'Can I resume a download after closing the app or losing connection?',
    a: 'Yes. NDM remembers exactly how much of the file is already on your disk and continues from that point, even across full application restarts.',
  },
  {
    q: 'Why is my download not faster with more connections?',
    a: 'Some servers limit the speed per connection, while others throttle or block clients that open too many. Auto mode balances this for you; for stubborn servers, try a fixed count of 4–8 connections.',
  },
  {
    q: 'A download failed — what can I do?',
    a: 'Retry it in place (right-click → Retry, or Retry All Failed from the Resume dropdown). If the file requires a login, use "Refresh URL" to provide fresh cookies or an authenticated link, then retry.',
  },
  {
    q: 'A download says "Preparing" for a long time — is something wrong?',
    a: 'NDM is asking the server for the file\'s size and whether it supports resuming. Slow servers can take a while, and NDM retries automatically. If it stays in this state, the server is simply slow to answer — the download will usually start on its own.',
  },
  {
    q: 'Does NDM collect my data?',
    a: 'No. There is no telemetry. The engine runs locally on your machine and only talks to the servers you download from. Update checks contact GitHub only when you ask for them.',
  },
  {
    q: 'Why does Windows SmartScreen warn me when installing?',
    a: `The installer is not signed with a paid certificate yet, so Windows shows "Windows protected your PC" for unpublished apps. Click "More info" → "Run anyway". The binaries are built reproducibly from the public source in this repository.`,
  },
  {
    q: 'My antivirus flagged the installer — is it safe?',
    a: 'This is a false positive common for unsigned installers. You can verify by building from source yourself: npm run dist. If your AV persists, add an exclusion for the NDM install folder.',
  },
  {
    q: 'How do updates work?',
    a: 'Help → Check for Updates… queries the GitHub Releases page. From there you can download and install updates with one click; NDM warns you first if downloads are still running.',
  },
  {
    q: 'Adding the same URL twice — what happens?',
    a: 'Nothing is duplicated. Failed or queued rows are retried in place, and active or completed rows are left untouched with their existing file.',
  },
];

const THIRD_PARTY_NOTICES: { name: string; version: string; license: string; url: string }[] = [
  { name: 'clsx', version: '^2.1.1', license: 'MIT', url: 'https://github.com/lukeed/clsx' },
  { name: 'cors', version: '^2.8.5', license: 'MIT', url: 'https://github.com/expressjs/cors' },
  { name: 'electron-updater', version: '^6.3.9', license: 'MIT', url: 'https://github.com/electron-userland/electron-builder' },
  { name: 'express', version: '^4.19.2', license: 'MIT', url: 'https://github.com/expressjs/express' },
  { name: 'lucide-react', version: '^0.475.0', license: 'ISC', url: 'https://lucide.dev' },
  { name: 'react', version: '^18.3.1', license: 'MIT', url: 'https://react.dev' },
  { name: 'react-dom', version: '^18.3.1', license: 'MIT', url: 'https://react.dev' },
  { name: 'socks-proxy-agent', version: '^8.0.5', license: 'MIT', url: 'https://github.com/TooTallNate/proxy-agents' },
  { name: 'tailwind-merge', version: '^2.6.0', license: 'MIT', url: 'https://github.com/dcastil/tailwind-merge' },
  { name: 'ws', version: '^8.18.0', license: 'MIT', url: 'https://github.com/websockets/ws' },
];

const MIT_TEXT = `MIT License

Copyright (c) 2026 Nogadex Systems

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export const HelpCenterDialog: React.FC<HelpCenterDialogProps> = ({
  isOpen,
  onClose,
  isStandalone = false,
  initialTab,
  initialGuide,
}) => {
  const [tab, setTab] = useState<HelpTab>(initialTab || 'howto');

  // ---- Guide book state ----------------------------------------------------
  // guideId: which guide is open (null = the shelf). page: current page index.
  const [guideId, setGuideId] = useState<string | null>(initialGuide || null);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');

  // Deep-link support: when the dialog opens with a requested guide, jump
  // straight into it (a failed download's window links to "Pause, resume &
  // retry"). A fresh open without one lands on the shelf.
  useEffect(() => {
    if (!isOpen) return;
    setGuideId(initialGuide || null);
    setPage(0);
    if (initialGuide) setTab('howto');
  }, [isOpen, initialGuide]);

  const filteredGuides = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GUIDES;
    return GUIDES.filter((g) =>
      g.title.toLowerCase().includes(q) ||
      g.summary.toLowerCase().includes(q) ||
      g.pages.some((p) => p.body.toLowerCase().includes(q) || (p.heading || '').toLowerCase().includes(q))
    );
  }, [query]);

  const guide = useMemo(() => GUIDES.find((g) => g.id === guideId) || null, [guideId]);
  const safePage = guide ? Math.min(page, guide.pages.length - 1) : 0;
  const currentPage = guide?.pages[safePage];

  const openGuide = (id: string) => { setGuideId(id); setPage(0); };
  const closeGuide = () => { setGuideId(null); setPage(0); };

  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [bugTitle, setBugTitle] = useState('');
  const [bugDescription, setBugDescription] = useState('');
  const [reportStatus, setReportStatus] = useState('');
  const [feedbackDescription, setFeedbackDescription] = useState('');

  const buildBugBody = () =>
    [
      '**What happened?**',
      bugDescription.trim() || '(describe the problem)',
      '',
      '**Environment (auto-generated)**',
      `${APP_NAME} ${APP_VERSION} (${APP_ARCH})`,
      `Platform: ${navigator.platform}`,
      `User agent: ${navigator.userAgent}`,
    ].join('\n');

  const submitReport = async (kind: 'bug' | 'feedback') => {
    const title = kind === 'bug'
      ? bugTitle.trim() || 'Bug report'
      : 'Feedback from NDM';
    const body = kind === 'bug' ? buildBugBody() : feedbackDescription.trim();
    const url = `${GITHUB_NEW_ISSUE}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    try {
      await openExternal(url);
      setReportStatus('Opening GitHub in your browser — the report is pre-filled. A local backup copy was saved.');
    } catch {
      setReportStatus('Could not open the browser. The report was saved locally instead.');
    }
  };

  const hasBugInput = bugTitle.trim().length > 0 || bugDescription.trim().length > 0;
  const hasFeedback = feedbackDescription.trim().length > 0;

  if (!isOpen) return null;

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`${APP_SHORT_NAME} Help Center`}
      width="w-[820px]"
      isStandalone={isStandalone}
    >
      <div className="flex gap-3 py-1" style={{ minHeight: 480, height: 480 }}>
        {/* Left: tab rail */}
        <div className="w-[168px] shrink-0 border-r border-neutral-200 pr-2 flex flex-col gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setReportStatus('');
              }}
              className={`flex items-center gap-2 px-2.5 py-1.5 text-[12px] rounded-[2px] text-left transition-colors ${
                tab === t.id
                  ? 'bg-brand-tint border border-brand-tintEdge text-brand font-semibold'
                  : 'border border-transparent text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
          <div className="mt-auto pt-2 border-t border-neutral-200 text-[10.5px] text-neutral-400 leading-relaxed px-1">
            {APP_NAME} v{APP_VERSION}
          </div>
        </div>

        {/* Right: tab content */}
        <div className="flex-1 min-w-0 overflow-y-auto pr-1">
          {tab === 'howto' && !guide && (
            <div className="space-y-3 text-[12px] text-neutral-800">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <BookOpen size={15} className="text-brand" />
                  <h3 className="font-bold text-[13px] text-neutral-900">Guides</h3>
                </div>
                <p className="text-[11.5px] text-neutral-600 leading-relaxed">
                  Pick a topic, then step through it page by page.
                </p>
              </div>

              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search guides…"
                className="w-full border border-neutral-300 rounded-[2px] px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-brand"
              />

              <div className="grid grid-cols-2 gap-2">
                {filteredGuides.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => openGuide(g.id)}
                    className="text-left border border-neutral-200 rounded-[3px] p-2.5 bg-white hover:border-brand/60 hover:bg-brand-tint/30 transition-colors group"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-[12px] text-neutral-900 group-hover:text-brand">
                      {g.icon}
                      <span className="truncate">{g.title}</span>
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-0.5 leading-snug">{g.summary}</div>
                    <div className="text-[10.5px] text-neutral-400 mt-1.5">
                      {g.pages.length} page{g.pages.length === 1 ? '' : 's'} →
                    </div>
                  </button>
                ))}
                {filteredGuides.length === 0 && (
                  <div className="col-span-2 text-center text-[11.5px] text-neutral-400 italic py-6">
                    No guides match “{query}”.
                  </div>
                )}
              </div>

              <details className="border border-neutral-200 rounded-[2px] bg-neutral-50">
                <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[12px] font-semibold text-neutral-800 flex items-center gap-1.5">
                  <Keyboard size={13} className="text-neutral-500" />
                  Keyboard shortcuts
                </summary>
                <table className="text-[11.5px] text-neutral-700 px-2.5 pb-2">
                  <tbody>
                    {KEYBOARD_SHORTCUTS.map((k) => (
                      <tr key={k.keys}>
                        <td className="pr-4 py-[1px] pl-2.5 font-mono text-[11px] text-neutral-900 whitespace-nowrap">{k.keys}</td>
                        <td className="py-[1px]">{k.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          )}

          {tab === 'howto' && guide && currentPage && (
            <div className="h-full flex flex-col text-[12px] text-neutral-800">
              {/* Guide header */}
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-neutral-200">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-brand shrink-0">{guide.icon}</span>
                  <span className="font-bold text-[13px] text-neutral-900 truncate">{guide.title}</span>
                </div>
                <button
                  type="button"
                  onClick={closeGuide}
                  className="text-[11px] text-neutral-500 hover:text-brand shrink-0"
                >
                  ← All guides
                </button>
              </div>

              {/* Page body */}
              <div className="flex-1 min-h-0 overflow-y-auto py-4">
                <div className="text-[10.5px] font-mono text-neutral-400 mb-2 uppercase tracking-wide">
                  Page {safePage + 1} of {guide.pages.length}
                </div>
                <h4 className="font-bold text-[14px] text-neutral-900 mb-2">
                  {currentPage.heading || `Step ${safePage + 1}`}
                </h4>
                <p className="text-[12.5px] text-neutral-700 leading-relaxed">{currentPage.body}</p>
                {currentPage.note && (
                  <div className="mt-3 p-2 border border-neutral-200 bg-neutral-50 rounded-[2px] text-[11px] text-neutral-600 leading-relaxed">
                    {currentPage.note}
                  </div>
                )}
              </div>

              {/* Pagination footer */}
              <div className="pt-2 border-t border-neutral-200 flex items-center justify-between">
                <WinButton
                  variant="secondary"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="min-w-[90px]"
                >
                  <span className="inline-flex items-center gap-1"><ChevronLeft size={13} /> Back</span>
                </WinButton>

                {/* Progress dots */}
                <div className="flex items-center gap-1.5">
                  {guide.pages.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPage(i)}
                      title={`Page ${i + 1}`}
                      className={`w-2 h-2 rounded-full transition-colors ${i === safePage ? 'bg-brand' : 'bg-neutral-300 hover:bg-neutral-400'}`}
                    />
                  ))}
                </div>

                {safePage < guide.pages.length - 1 ? (
                  <WinButton
                    variant="primary"
                    onClick={() => setPage((p) => Math.min(guide.pages.length - 1, p + 1))}
                    className="min-w-[90px]"
                  >
                    <span className="inline-flex items-center gap-1">Next <ChevronRight size={13} /></span>
                  </WinButton>
                ) : (
                  <WinButton variant="primary" onClick={closeGuide} className="min-w-[90px]">
                    <span className="inline-flex items-center gap-1"><Save size={13} /> Done</span>
                  </WinButton>
                )}
              </div>
            </div>
          )}

          {tab === 'faq' && (
            <div className="space-y-1.5 text-[12px]">
              {FAQ_ITEMS.map((item, i) => (
                <div key={i} className="border border-neutral-200 rounded-[2px]">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-neutral-50 text-[12px] font-semibold text-neutral-900"
                  >
                    <span>{item.q}</span>
                    <span className="text-neutral-400 text-[11px] shrink-0">{openFaq === i ? '−' : '+'}</span>
                  </button>
                  {openFaq === i && (
                    <div className="px-3 pb-2 text-[11.5px] text-neutral-700 leading-relaxed">{item.a}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'bug' && (
            <div className="space-y-3 text-[12px]">
              <div className="p-2.5 bg-neutral-100 border border-neutral-300 rounded-[2px] text-[11.5px] text-neutral-700 leading-relaxed">
                Describe what went wrong and how to reproduce it. The report automatically
                includes your {APP_SHORT_NAME} version and environment, <strong>never your download
                history, file names, or URLs</strong>. A local backup copy is always saved to disk
                when you submit.
              </div>
              <div>
                <label className="block font-semibold text-neutral-800 mb-1">Short title</label>
                <input
                  type="text"
                  value={bugTitle}
                  onChange={(e) => setBugTitle(e.target.value)}
                  placeholder="e.g. Download stalls at 99% on large files"
                  className="w-full border border-neutral-300 rounded-[2px] px-2 py-1.5 text-[12px] focus:outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="block font-semibold text-neutral-800 mb-1">What happened?</label>
                <textarea
                  value={bugDescription}
                  onChange={(e) => setBugDescription(e.target.value)}
                  rows={7}
                  placeholder={
                    'What did you do? What did you expect to happen? What happened instead?\n\n1. Opened…\n2. Clicked…\n3. …'
                  }
                  className="w-full border border-neutral-300 rounded-[2px] px-2 py-1.5 text-[12px] font-sans resize-y focus:outline-none focus:border-brand"
                />
              </div>
              <div className="flex items-center gap-2">
                <WinButton
                  variant="primary"
                  disabled={!hasBugInput}
                  onClick={() => submitReport('bug')}
                  className="min-w-[110px]"
                >
                  <span className="inline-flex items-center gap-1.5"><Send size={12} /> Submit Report</span>
                </WinButton>
                {reportStatus && <span className="text-[11px] text-neutral-600">{reportStatus}</span>}
              </div>
            </div>
          )}

          {tab === 'feedback' && (
            <div className="space-y-3 text-[12px]">
              <div className="p-2.5 bg-neutral-100 border border-neutral-300 rounded-[2px] text-[11.5px] text-neutral-700 leading-relaxed">
                Feature ideas, workflow complaints, things you love — all welcome. The most
                requested features make it into the next release.
              </div>
              <div>
                <label className="block font-semibold text-neutral-800 mb-1">Your feedback</label>
                <textarea
                  value={feedbackDescription}
                  onChange={(e) => setFeedbackDescription(e.target.value)}
                  rows={8}
                  placeholder="I wish NDM could…"
                  className="w-full border border-neutral-300 rounded-[2px] px-2 py-1.5 text-[12px] font-sans resize-y focus:outline-none focus:border-brand"
                />
              </div>
              <div className="flex items-center gap-2">
                <WinButton
                  variant="primary"
                  disabled={!hasFeedback}
                  onClick={() => submitReport('feedback')}
                  className="min-w-[110px]"
                >
                  <span className="inline-flex items-center gap-1.5"><Send size={12} /> Send Feedback</span>
                </WinButton>
                {reportStatus && <span className="text-[11px] text-neutral-600">{reportStatus}</span>}
              </div>
            </div>
          )}

          {tab === 'legal' && (
            <div className="space-y-3 text-[12px]">
              <div>
                <h4 className="font-bold text-[12.5px] text-neutral-900 mb-1">{APP_NAME} License</h4>
                <pre className="text-[10.5px] leading-snug bg-neutral-100 border border-neutral-200 rounded-[2px] p-2.5 whitespace-pre-wrap font-mono text-neutral-700 max-h-[170px] overflow-y-auto">
                  {MIT_TEXT}
                </pre>
              </div>
              <div>
                <h4 className="font-bold text-[12.5px] text-neutral-900 mb-1">Third-Party Packages</h4>
                <div className="border border-neutral-200 rounded-[2px] divide-y divide-neutral-200 max-h-[180px] overflow-y-auto">
                  {THIRD_PARTY_NOTICES.map((n) => (
                    <div key={n.name} className="px-2.5 py-1 flex items-center justify-between text-[11.5px]">
                      <span className="font-medium text-neutral-800">{n.name} <span className="text-neutral-400 font-normal">{n.version}</span></span>
                      <span className="flex items-center gap-2">
                        <span className="text-neutral-500">{n.license}</span>
                        <button
                          type="button"
                          onClick={() => openExternal(n.url).catch(() => {})}
                          className="text-brand hover:underline inline-flex items-center gap-0.5"
                          title={n.url}
                        >
                          <ExternalLink size={10} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-[11px] text-neutral-500">
                {APP_NAME} v{APP_VERSION} — Copyright © 2026 Nogadex Systems. All trademarks are the property of their respective owners.
              </div>
            </div>
          )}
        </div>
      </div>
    </WindowsDialog>
  );
};
