import React, { useEffect, useRef, useState } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { WinButton, WinCheckbox, WinInput } from './common/WinControls';
import { extractUrlsFromClipboard } from '../utils/clipboard';

/**
 * Step 1 dialog: "Enter new address to download".
 *
 * Deliberately tiny and always-on-top: it stays above the browser while the
 * user copies a link, auto-grabs the URL from the clipboard, and hands the
 * address (plus optional per-site login) to the full "New Download" dialog
 * for the details phase (category, folder, streams...).
 *
 * Key difference from the full dialog: no probing, no folder logic — just
 * the address, so it opens and closes instantly. Supports two modes:
 *  - standalone OS window (default; isNative opens it as its own window)
 *  - embedded modal inside the main window (fallback / web builds)
 */

interface AddressInputDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with a validated URL and optional site login/password. */
  onSubmit: (url: string, login?: string, password?: string) => void;
  isStandalone?: boolean;
  /** Prefilled address (e.g. protocol/extension handoff). Skips clipboard grab. */
  initialUrl?: string;
}

const HISTORY_KEY = 'ndm.recentAddresses';
const HISTORY_LIMIT = 10;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === 'string').slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveHistory(urls: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(urls.slice(0, HISTORY_LIMIT)));
  } catch {}
}

/** Normalize + validate like the full dialog: add scheme, parse, check host. */
export function normalizeAddress(raw: string): string | null {
  let candidate = raw.trim();
  if (!candidate) return null;
  if (!/^https?:\/\//i.test(candidate) && !/^ftp:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/.test(parsed.protocol) && parsed.protocol !== 'ftp:') return null;
    const host = parsed.hostname;
    if (!host || (!host.includes('.') && host !== 'localhost' && !host.startsWith('['))) return null;
    return candidate;
  } catch {
    return null;
  }
}

export const AddressInputDialog: React.FC<AddressInputDialogProps> = ({
  isOpen,
  onClose,
  onSubmit,
  isStandalone = false,
  initialUrl,
}) => {
  const [url, setUrl] = useState('');
  const [useAuth, setUseAuth] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [clipboardGrabbed, setClipboardGrabbed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset + clipboard auto-grab on every open. If the input is empty and the
  // clipboard holds a URL, fill it in and select it — one OK press starts
  // the download. Clipboard read is best-effort (blocked in some contexts).
  useEffect(() => {
    if (!isOpen) return;
    if (initialUrl) {
      setUrl(initialUrl);
      setError('');
      setClipboardGrabbed(false);
      setHistory(loadHistory());
      return;
    }
    setUrl('');
    setUseAuth(false);
    setLogin('');
    setPassword('');
    setError('');
    setClipboardGrabbed(false);
    setHistory(loadHistory());

    let cancelled = false;
    navigator.clipboard?.readText?.()
      .then((text) => {
        if (cancelled) return;
        const urls = extractUrlsFromClipboard(text || '');
        if (urls.length > 0) {
          setUrl(urls[0]);
          setClipboardGrabbed(true);
          // Select the whole address so typing replaces it.
          requestAnimationFrame(() => inputRef.current?.select());
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isOpen, initialUrl]);

  const handleSubmit = () => {
    const normalized = normalizeAddress(url);
    if (!normalized) {
      setError('Enter a full URL such as https://example.com/file.zip');
      return;
    }
    const next = [normalized, ...history.filter((u) => u !== normalized)].slice(0, HISTORY_LIMIT);
    setHistory(next);
    saveHistory(next);
    onSubmit(normalized, useAuth && login.trim() ? login.trim() : undefined, useAuth ? password : undefined);
    onClose();
  };

  const footer = (
    <div className="w-full flex items-center justify-end gap-2">
      <WinButton variant="primary" onClick={handleSubmit} disabled={!url.trim()} className="min-w-[90px]">
        OK
      </WinButton>
      <WinButton variant="secondary" onClick={onClose} className="min-w-[90px]">
        Cancel
      </WinButton>
    </div>
  );

  const recent = history.slice(0, 3);

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Enter new address to download"
      width="w-[560px]"
      footer={footer}
      isStandalone={isStandalone}
      autoFitHeight={isStandalone}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
        className="space-y-2.5"
      >
        <div className="grid grid-cols-[58px_1fr] items-center gap-2">
          <label className="text-neutral-500 text-[12px]">Address:</label>
          <WinInput
            ref={inputRef}
            type="text"
            autoFocus
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(''); }}
            placeholder={clipboardGrabbed ? 'Copied link picked up. Press OK, or type to replace' : 'https://... or paste a link'}
            autoComplete="off"
            spellCheck={false}
            list="ndm-address-history"
            className="w-full font-mono text-[11.5px] h-[28px]"
          />
          <datalist id="ndm-address-history">
            {history.map((u) => <option key={u} value={u} />)}
          </datalist>
        </div>

        {error ? (
          <div className="pl-[66px] text-[11px] text-status-error">{error}</div>
        ) : (
          recent.length > 0 && (
            <div className="pl-[66px] flex items-center gap-1.5 flex-wrap">
              <span className="text-[10.5px] text-neutral-400">Recent:</span>
              {recent.map((u) => (
                <button
                  key={u}
                  type="button"
                  title={u}
                  onClick={() => { setUrl(u); setError(''); inputRef.current?.focus(); }}
                  className="max-w-[150px] truncate text-[10.5px] font-mono px-1.5 py-0.5 rounded-[2px] bg-neutral-100 border border-neutral-200 text-neutral-600 hover:text-brand hover:border-brand/50 transition-colors"
                >
                  {u.replace(/^https?:\/\//, '')}
                </button>
              ))}
            </div>
          )
        )}

        {/* Optional per-site login — the "Use authorization" row.
            Credentials are stored by the full dialog's submit flow.
            The row is always mounted and collapses via an animated grid row,
            so its height eases in step with the OS window auto-fit (no
            hard pop, no transient scrollbar while the window resizes). */}
        <WinCheckbox
          checked={useAuth}
          onChange={(v) => { setUseAuth(v); if (!v) { setLogin(''); setPassword(''); } }}
          label="Use authorization"
          className="text-[12px]"
        />
        <div
          aria-hidden={!useAuth}
          className="grid transition-[grid-template-rows] duration-150 ease-out"
          style={{ gridTemplateRows: useAuth ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden min-h-0">
            <div className="grid grid-cols-[58px_1fr_58px_1fr] items-center gap-2 pl-[66px] pt-1">
              <label className="text-neutral-400 text-[11.5px] text-right">Login</label>
              <WinInput
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                disabled={!useAuth}
                autoComplete="off"
                className="w-full text-[12px] h-[26px]"
              />
              <label className="text-neutral-400 text-[11.5px] text-right">Password</label>
              <WinInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!useAuth}
                autoComplete="new-password"
                className="w-full text-[12px] h-[26px]"
              />
            </div>
          </div>
        </div>
      </form>
    </WindowsDialog>
  );
};
