import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppSettings } from '../types/download';
import { WindowsDialog } from './common/WindowsDialog';
import { WinCheckbox, WinInput, WinSelect, WinButton, WinGroupBox, WinTabs } from './common/WinControls';
import { DEFAULT_DOWNLOAD_DIR, DEFAULT_TEMP_DIR, APP_VERSION, APP_SHORT_NAME } from '../config/appInfo';
import { getApiBaseUrl } from '../config/apiConfig';
import {
  AppearanceSettings,
  IconStyle,
  loadAppearance,
  changeAppearance,
  UI_SCALE_OPTIONS,
  ICON_STYLE_OPTIONS,
} from '../config/appearance';

/** One event-sound row: checkbox + file path + Test/Browse. */
const SoundRow: React.FC<{
  event: 'downloadComplete' | 'downloadFailed' | 'queueStarted' | 'queueStopped';
  label: string;
  enabled: boolean;
  file: string;
  onEnabled: (v: boolean) => void;
  onFile: (v: string) => void;
}> = ({ event, label, enabled, file, onEnabled, onFile }) => {
  const [playing, setPlaying] = useState(false);

  const handleTest = async () => {
    setPlaying(true);
    try {
      // Preview rides the same sound-event feed Electron already polls, so the
      // Test button plays through the exact playback path real events use —
      // and reflects the currently-typed path, even before saving.
      await fetch(`${getApiBaseUrl()}/api/sound-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, file }),
      });
    } catch {}
    setTimeout(() => setPlaying(false), 1200);
  };

  const handleBrowse = async () => {
    const api_any = (window as any).electronAPI;
    if (api_any?.selectFile) {
      const res = await api_any.selectFile(file || undefined);
      if (!res?.canceled && res?.filePath) onFile(res.filePath);
    }
  };

  return (
    <div className={`space-y-1 transition-opacity ${enabled ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-2">
        <WinCheckbox checked={enabled} onChange={onEnabled} label={label} />
        <div className="ml-auto flex gap-1.5">
          <WinButton variant="secondary" onClick={handleTest} title="Play this sound now">
            {playing ? 'Playing…' : 'Test'}
          </WinButton>
          <WinButton variant="secondary" onClick={handleBrowse} title="Choose a .wav/.mp3 file">
            Browse…
          </WinButton>
        </div>
      </div>
      <div className="pl-6">
        <WinInput
          type="text"
          value={file}
          onChange={(e: any) => onFile(e.target.value)}
          disabled={!enabled}
          placeholder="(system chime) or path to a .wav/.mp3"
          className="w-full font-mono text-[11px]"
        />
      </div>
    </div>
  );
};

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  isStandalone?: boolean;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  isStandalone = false,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'general' | 'appearance' | 'connection' | 'saveto' | 'filetypes' | 'browser' | 'sounds' | 'proxy' | 'logins' | 'updates'>('general');

  // Updates Subsystem (Section 26)
  const [updateState, setUpdateState] = useState<any>({ status: 'idle' });
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // General
  const [doubleClickAction, setDoubleClickAction] = useState(settings.doubleClickAction || 'open_file');
  const [autoStart, setAutoStart] = useState(settings.autoStartDownloads ?? true);
  const [overwrite, setOverwrite] = useState(settings.overwriteExisting ?? false);
  const [monitorClipboard, setMonitorClipboard] = useState((settings as any).monitorClipboard ?? true);

  // Appearance (theme / UI scale / icon style) — applies live on change
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearance());
  const updateAppearance = (patch: Partial<AppearanceSettings>) => {
    setAppearance(changeAppearance(patch));
  };

  // Updates policy (persisted locally until native sync lands)
  const [updateChannel, setUpdateChannelLocal] = useState<'latest' | 'beta' | 'alpha'>(() => (localStorage.getItem('ndm_update_channel') as any) || 'latest');
  const [checkAutomatically, setCheckAutomatically] = useState(() => localStorage.getItem('ndm_update_check_auto') !== '0');
  const [notifyWhenReady, setNotifyWhenReady] = useState(() => localStorage.getItem('ndm_update_notify') !== '0');
  const [installAutomatically, setInstallAutomatically] = useState(() => localStorage.getItem('ndm_update_install_auto') === '1');

  const persistUpdatePolicy = (channel: string, checkAuto: boolean, notify: boolean, installAuto: boolean) => {
    localStorage.setItem('ndm_update_channel', channel);
    localStorage.setItem('ndm_update_check_auto', checkAuto ? '1' : '0');
    localStorage.setItem('ndm_update_notify', notify ? '1' : '0');
    localStorage.setItem('ndm_update_install_auto', installAuto ? '1' : '0');
    // Native side owns the real policy: auto-check, auto-download and
    // install-on-quit flags on electron-updater (persisted in userData).
    (window as any).electronAPI?.setUpdatePolicy?.({ checkAutomatically: checkAuto, notifyWhenReady: notify, installAutomatically: installAuto });
  };

  // Connection
  const [isLimitless, setIsLimitless] = useState((settings.maxConcurrentDownloads ?? 0) === 0);
  const [maxConcurrent, setMaxConcurrent] = useState((settings.maxConcurrentDownloads ?? 0) === 0 ? 5 : settings.maxConcurrentDownloads);
  const [defaultConnections, setDefaultConnections] = useState(settings.defaultConnections ?? 32);
  const [speedLimitBps, setSpeedLimitBps] = useState(settings.speedLimitBps || 0);
  const [speedLimitEnabled, setSpeedLimitEnabled] = useState(Boolean(settings.speedLimitBps && settings.speedLimitBps > 0));

  // Save To Paths
  const [defaultFolder, setDefaultFolder] = useState(settings.defaultFolder || settings.defaultDownloadFolder || DEFAULT_DOWNLOAD_DIR);
  const [tempDir, setTempDir] = useState(settings.tempDir || settings.tempDownloadFolder || DEFAULT_TEMP_DIR);
  const [autoCategorize, setAutoCategorize] = useState((settings as any).autoCategorize ?? settings.autoCategorize ?? true);
  const [rememberLastFolder, setRememberLastFolder] = useState((settings as any).rememberLastFolder ?? settings.rememberLastFolder ?? true);

  // Proxy State
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyType, setProxyType] = useState<'http' | 'https' | 'socks5'>('http');
  const [proxyHost, setProxyHost] = useState('');
  const [proxyPort, setProxyPort] = useState(8080);
  const [proxyUser, setProxyUser] = useState('');
  const [proxyPass, setProxyPass] = useState('');

  // Site Logins
  const [loginDomain, setLoginDomain] = useState('');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [savedLogins, setSavedLogins] = useState<any[]>([]);

  // Category Extension Rules
  const [extCompressed, setExtCompressed] = useState('ZIP, RAR, 7Z, TAR, GZ, BZ2, ISO, DMG');
  const [extDocuments, setExtDocuments] = useState('PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT');
  const [extMusic, setExtMusic] = useState('MP3, WAV, FLAC, AAC, OGG, M4A');
  const [extPrograms, setExtPrograms] = useState('EXE, MSI, BAT, CMD, APK, BIN');
  const [extVideo, setExtVideo] = useState('MP4, MKV, AVI, MOV, WMV, FLV, WEBM');

  // ---- Sounds tab ----
  const [soundCompleteEnabled, setSoundCompleteEnabled] = useState(true);
  const [soundCompleteFile, setSoundCompleteFile] = useState('');
  const [soundFailedEnabled, setSoundFailedEnabled] = useState(true);
  const [soundFailedFile, setSoundFailedFile] = useState('');
  const [soundQueueStartEnabled, setSoundQueueStartEnabled] = useState(false);
  const [soundQueueStartFile, setSoundQueueStartFile] = useState('');
  const [soundQueueStopEnabled, setSoundQueueStopEnabled] = useState(false);
  const [soundQueueStopFile, setSoundQueueStopFile] = useState('');

  // ---- Browser capture exception lists + integration policy ----
  const [captureExcludeExt, setCaptureExcludeExt] = useState('');
  const [captureExcludeDomains, setCaptureExcludeDomains] = useState('');
  // Per-browser capture toggles + capture keys + panel/ctx-menu switches.
  const [browserFlags, setBrowserFlags] = useState<Record<string, boolean>>({
    chrome: true, edge: true, firefox: false, opera: true, brave: true, vivaldi: true,
  });
  const [forceKeys, setForceKeys] = useState<string[]>([]);
  const [preventKeys, setPreventKeys] = useState<string[]>([]);
  const [showDownloadPanel, setShowDownloadPanel] = useState(true);
  const [ctxMenu, setCtxMenu] = useState({ downloadLink: true, downloadMedia: true, downloadAllLinks: true });
  // Launch on OS startup (engine's general.startupWithWindows)
  const [startupWithWindows, setStartupWithWindows] = useState(false);
  // Live extension connections (browser name → last heartbeat ms)
  const [connectedBrowsers, setConnectedBrowsers] = useState<Record<string, number>>({});

  useEffect(() => {
    if (isOpen) {
      setIsLimitless((settings.maxConcurrentDownloads ?? 0) === 0);
      setMaxConcurrent((settings.maxConcurrentDownloads ?? 0) === 0 ? 5 : settings.maxConcurrentDownloads);
      setDefaultConnections(settings.defaultConnections ?? 32);
      setAutoStart(settings.autoStartDownloads ?? true);
      setOverwrite(settings.overwriteExisting ?? false);
      setDoubleClickAction(settings.doubleClickAction || 'open_file');
      setDefaultFolder(settings.defaultFolder || settings.defaultDownloadFolder || DEFAULT_DOWNLOAD_DIR);
      setTempDir(settings.tempDir || settings.tempDownloadFolder || DEFAULT_TEMP_DIR);
      setAutoCategorize((settings as any).autoCategorize ?? settings.autoCategorize ?? true);
      setRememberLastFolder((settings as any).rememberLastFolder ?? settings.rememberLastFolder ?? true);
      setOverwrite(settings.overwriteExisting ?? false);
      setMonitorClipboard((settings as any).monitorClipboard ?? true);

      // Hydrate capture exceptions + browser integration + sounds from the engine settings.
      fetch(`${getApiBaseUrl()}/api/settings`).then((r) => r.json()).then((s: any) => {
        const be = s.browser || {};
        setCaptureExcludeExt((be.excludedExtensions || []).join(', '));
        setCaptureExcludeDomains((be.excludedDomains || []).join(', '));
        setBrowserFlags({
          chrome: be.chromeEnabled !== false,
          edge: be.edgeEnabled !== false,
          firefox: be.firefoxEnabled === true,
          opera: be.operaEnabled !== false,
          brave: be.braveEnabled !== false,
          vivaldi: be.vivaldiEnabled !== false,
        });
        setForceKeys(Array.isArray(be.forceKeys) ? be.forceKeys : []);
        setPreventKeys(Array.isArray(be.preventKeys) ? be.preventKeys : []);
        setShowDownloadPanel(be.showDownloadPanel !== false);
        setCtxMenu({
          downloadLink: be.contextMenu?.downloadLink !== false,
          downloadMedia: be.contextMenu?.downloadMedia !== false,
          downloadAllLinks: be.contextMenu?.downloadAllLinks !== false,
        });
        setStartupWithWindows(!!s.general?.startupWithWindows);
        const snd = s.sounds || {};
        setSoundCompleteEnabled(!!snd.downloadComplete?.enabled);
        setSoundCompleteFile(snd.downloadComplete?.file || '');
        setSoundFailedEnabled(!!snd.downloadFailed?.enabled);
        setSoundFailedFile(snd.downloadFailed?.file || '');
        setSoundQueueStartEnabled(!!snd.queueStarted?.enabled);
        setSoundQueueStartFile(snd.queueStarted?.file || '');
        setSoundQueueStopEnabled(!!snd.queueStopped?.enabled);
        setSoundQueueStopFile(snd.queueStopped?.file || '');
      }).catch(() => {});

      // Hydrate update policy from the main process (source of truth)
      const ea = (window as any).electronAPI;
      if (ea?.getUpdateState) {
        ea.getUpdateState().then((st: any) => {
          if (st?.policy) {
            setCheckAutomatically(st.policy.checkAutomatically !== false);
            setNotifyWhenReady(st.policy.notifyWhenReady !== false);
            setInstallAutomatically(st.policy.installAutomatically === true);
          }
          if (st?.channel) setUpdateChannelLocal(st.channel);
        }).catch(() => {});
      }

      fetch(`${getApiBaseUrl()}/api/proxy`)        .then((r) => r.json())
        .then((d) => {
          if (d.proxy) {
            setProxyEnabled(d.proxy.enabled || false);
            setProxyType(d.proxy.type || 'http');
            setProxyHost(d.proxy.host || '');
            setProxyPort(d.proxy.port || 8080);
            setProxyUser(d.proxy.username || '');
            setProxyPass(d.proxy.password || '');
          }
          if (d.credentials) {
            setSavedLogins(d.credentials);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  const handleAddLogin = async () => {
    if (!loginDomain.trim()) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: loginDomain.trim(),
          authType: 'basic',
          username: loginUser.trim(),
          password: loginPass.trim(),
        }),
      });
      if (res.ok) {
        setSavedLogins([...savedLogins, { domain: loginDomain.trim(), username: loginUser.trim() }]);
        setLoginDomain('');
        setLoginUser('');
        setLoginPass('');
      }
    } catch {}
  };

  const handleDeleteLogin = async (domain: string) => {
    try {
      await fetch(`${getApiBaseUrl()}/api/credentials/${encodeURIComponent(domain)}`, { method: 'DELETE' });
      setSavedLogins(savedLogins.filter((l) => l.domain !== domain));
    } catch {}
  };

  const handleSave = () => {
    onClose();
    onSaveSettings({
      doubleClickAction,
      autoStartDownloads: autoStart,
      overwriteExisting: overwrite,
      maxConcurrentDownloads: isLimitless ? 0 : maxConcurrent,
      defaultConnections,
      speedLimitBps: speedLimitEnabled ? (speedLimitBps || 1024 * 1024) : 0,
      defaultDownloadFolder: defaultFolder,
      tempDownloadFolder: tempDir,
      defaultFolder,
      tempDir,
      autoCategorize,
      rememberLastFolder,
      monitorClipboard,
    }).catch(() => {});

    fetch(`${getApiBaseUrl()}/api/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: proxyEnabled,
        type: proxyType,
        host: proxyHost,
        port: proxyPort,
        username: proxyUser || undefined,
        password: proxyPass || undefined,
      }),
    }).catch(() => {});

    fetch(`${getApiBaseUrl()}/api/sounds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        downloadComplete: { enabled: soundCompleteEnabled, file: soundCompleteFile.trim() },
        downloadFailed: { enabled: soundFailedEnabled, file: soundFailedFile.trim() },
        queueStarted: { enabled: soundQueueStartEnabled, file: soundQueueStartFile.trim() },
        queueStopped: { enabled: soundQueueStopEnabled, file: soundQueueStopFile.trim() },
      }),
    }).catch(() => {});

    // Persist browser capture exceptions + integration policy alongside the
    // other settings. The bridge reads these live on every takeover; the
    // extension polls the policy snapshot.
    onSaveSettings({
      browser: {
        chromeEnabled: browserFlags.chrome,
        edgeEnabled: browserFlags.edge,
        firefoxEnabled: browserFlags.firefox,
        operaEnabled: browserFlags.opera,
        braveEnabled: browserFlags.brave,
        vivaldiEnabled: browserFlags.vivaldi,
        forceKeys,
        preventKeys,
        showDownloadPanel,
        contextMenu: ctxMenu,
        excludedExtensions: captureExcludeExt.split(/[\s,;]+/).map((s) => s.trim().replace(/^\.+/, '')).filter(Boolean),
        excludedDomains: captureExcludeDomains.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean),
      },
      general: { startupWithWindows },
    } as any).catch(() => {});

    fetch(`${getApiBaseUrl()}/api/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(1500),
      body: JSON.stringify({
        rules: [
          { id: 'rule_compressed', name: 'Compressed', enabled: true, order: 1, condition: { type: 'extension', value: extCompressed }, action: { categoryId: 'compressed' } },
          { id: 'rule_documents', name: 'Documents', enabled: true, order: 2, condition: { type: 'extension', value: extDocuments }, action: { categoryId: 'documents' } },
          { id: 'rule_music', name: 'Music', enabled: true, order: 3, condition: { type: 'extension', value: extMusic }, action: { categoryId: 'music' } },
          { id: 'rule_programs', name: 'Programs', enabled: true, order: 4, condition: { type: 'extension', value: extPrograms }, action: { categoryId: 'programs' } },
          { id: 'rule_video', name: 'Video', enabled: true, order: 5, condition: { type: 'extension', value: extVideo }, action: { categoryId: 'video' } },
        ],
      }),
    }).catch(() => {});
  };

  // Live counts for the Browser tab's exception lists ("N types blocked").
  const excludedExtCount = captureExcludeExt.split(/[\s,;]+/).map((s) => s.trim().replace(/^\.+/, '')).filter(Boolean).length;
  const excludedDomainCount = captureExcludeDomains.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean).length;

  // Poll live extension connections while the dialog is open.
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    const pull = () => {
      fetch(`${getApiBaseUrl()}/api/bridge/connections`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d?.connected) setConnectedBrowsers(d.connected); })
        .catch(() => {});
    };
    pull();
    const t = setInterval(pull, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [isOpen]);

  const footer = (
    <>
      <WinButton variant="primary" onClick={handleSave} className="min-w-[100px]">
        Save Settings
      </WinButton>
      <WinButton variant="secondary" onClick={onClose} className="min-w-[84px]">
        Cancel
      </WinButton>
    </>
  );

  const tabs = [
    { id: 'general', label: t('settings.tabGeneral') },
    { id: 'appearance', label: t('settings.tabAppearance') },
    { id: 'connection', label: t('settings.tabConnection') },
    { id: 'saveto', label: t('settings.tabSaveto') },
    { id: 'filetypes', label: t('settings.tabFiletypes') },
    { id: 'browser', label: t('settings.tabBrowser') },
    { id: 'sounds', label: t('settings.tabSounds') },
    { id: 'proxy', label: t('settings.tabProxy') },
    { id: 'logins', label: t('settings.tabLogins') },
    { id: 'updates', label: t('settings.tabUpdates') },
  ];

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Configuration Options"
      width="w-[700px]"
      footer={footer}
      isStandalone={isStandalone}
      autoFitHeight={isStandalone}
    >
      <WinTabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as any)} />

      <div className="space-y-4 min-h-[280px]">
        {/* General Tab */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <WinGroupBox title={t('settings.startupIntegration')} className="space-y-2.5">
              <WinCheckbox
                checked={autoStart}
                onChange={setAutoStart}
                label={t('settings.autoStart')}
              />
              <div />
              <WinCheckbox
                checked={monitorClipboard}
                onChange={setMonitorClipboard}
                label={t('settings.monitorClipboard')}
              />
              <div />
              <WinCheckbox
                checked={overwrite}
                onChange={setOverwrite}
                label={t('settings.overwriteExisting')}
              />
            </WinGroupBox>

            <WinGroupBox title={t('settings.listInteraction')} className="space-y-2">
              <div className="flex items-center gap-3">
                <label className="text-neutral-600">{t('settings.doubleClickAction')}</label>
                <WinSelect
                  value={doubleClickAction}
                  onChange={(e) => setDoubleClickAction(e.target.value as any)}
                >
                  <option value="open_file">{t('settings.dclickOpenFile')}</option>
                  <option value="open_folder">{t('settings.dclickOpenFolder')}</option>
                  <option value="properties">{t('settings.dclickProperties')}</option>
                </WinSelect>
              </div>
            </WinGroupBox>
          </div>
        )}

        {/* Appearance Tab — theme, zoom and icons; every change applies live */}
        {activeTab === 'appearance' && (
          <div className="space-y-4">
            <WinGroupBox title={t('settings.theme')} className="space-y-2.5">
              <p className="text-[11.5px] text-neutral-500">
                Applies instantly to this window and every open dialog.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { value: 'light', label: t('settings.themeLight') },
                    { value: 'dark', label: t('settings.themeDark') },
                    { value: 'system', label: t('settings.themeLight') + ' / ' + t('settings.themeDark') },
                  ] as const
                ).map((opt) => {
                  const selected = appearance.theme === opt.value;
                  // Fixed physical colors: the preview must show the TARGET
                  // look, not re-tint with the currently active theme.
                  const pv = opt.value === 'light'
                    ? { shell: '#f8fafc', edge: '#cbd5e1', bar: '#e2e8f0', body: '#ffffff', accent: '#3b82f6', side: '#f1f5f9' }
                    : opt.value === 'dark'
                    ? { shell: '#17181c', edge: '#33363d', bar: '#26282e', body: '#1d1f24', accent: '#3b82f6', side: '#26282e' }
                    : (window.matchMedia('(prefers-color-scheme: dark)').matches
                    ? { shell: '#17181c', edge: '#33363d', bar: '#26282e', body: '#1d1f24', accent: '#3b82f6', side: '#26282e' }
                    : { shell: '#f8fafc', edge: '#cbd5e1', bar: '#e2e8f0', body: '#ffffff', accent: '#3b82f6', side: '#f1f5f9' });
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateAppearance({ theme: opt.value })}
                      aria-pressed={selected}
                      className={`flex flex-col items-center gap-2 p-2 rounded-[3px] border cursor-pointer transition-colors ${
                        selected
                          ? 'border-brand bg-brand-tint text-brand'
                          : 'border-neutral-300 bg-white hover:border-brand-tintEdge text-neutral-600'
                      }`}
                    >
                      {/* mini window preview swatch */}
                      <span
                        aria-hidden="true"
                        className="w-full h-9 rounded-[2px] border flex flex-col overflow-hidden"
                        style={{ background: pv.shell, borderColor: pv.edge }}
                      >
                        <span className="h-2 w-full border-b" style={{ background: pv.bar, borderColor: pv.edge }} />
                        <span className="flex-1 flex gap-1 p-1">
                          <span className="w-1.5 h-full rounded-[1px]" style={{ background: pv.side }} />
                          <span className="flex-1 h-full rounded-[1px]" style={{ background: pv.accent, opacity: 0.85 }} />
                          <span className="w-2 h-full rounded-[1px]" style={{ background: pv.body }} />
                        </span>
                      </span>
                      <span className="text-[11.5px] font-medium">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="text-[11px] text-neutral-500">
                {appearance.theme === 'system'
                  ? 'Following your Windows color mode.'
                  : appearance.theme === 'dark'
                  ? 'Dark mode is on.'
                  : 'Light mode is on.'}
              </div>
            </WinGroupBox>

            <WinGroupBox title="UI Scale / Zoom" className="space-y-2">
              <div className="flex items-center gap-3">
                <label className="text-neutral-600 font-medium">Interface size:</label>
                <WinSelect
                  value={appearance.uiScale}
                  onChange={(e) => updateAppearance({ uiScale: Number(e.target.value) })}
                  className="w-44"
                >
                  {UI_SCALE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label} ({o.value}px)</option>
                  ))}
                </WinSelect>
                <WinButton
                  variant="secondary"
                  className="ml-auto"
                  onClick={() => updateAppearance({ uiScale: 15 })}
                  disabled={appearance.uiScale === 15}
                >
                  Reset to default
                </WinButton>
              </div>
              <div className="text-[11px] text-neutral-500">
                Applies immediately across every window; dialogs resize to fit. Compact fits smaller screens.
              </div>
            </WinGroupBox>

            <WinGroupBox title="Icon Style" className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                {ICON_STYLE_OPTIONS.map((o) => {
                  const selected = appearance.iconStyle === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => updateAppearance({ iconStyle: o.value as IconStyle })}
                      aria-pressed={selected}
                      title={o.hint}
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-[3px] border cursor-pointer transition-colors ${
                        selected
                          ? 'border-brand bg-brand-tint text-brand'
                          : 'border-neutral-300 bg-white hover:border-brand-tintEdge text-neutral-600'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={`w-4 h-4 rounded-full ${selected ? 'bg-brand' : 'bg-neutral-400'}`} />
                        <span className={`w-4 h-4 rounded-[2px] ${selected ? 'bg-brand-glow' : 'bg-neutral-500'}`} />
                        <span className={`w-4 h-4 rotate-45 ${selected ? 'bg-brand-active' : 'bg-neutral-600'}`} />
                      </span>
                      <span className="text-[11.5px] font-medium">{o.label}</span>
                    </button>
                    );
                })}
              </div>
              <div className="text-[11px] text-neutral-500">
                {ICON_STYLE_OPTIONS.find((o) => o.value === appearance.iconStyle)?.hint}
              </div>
            </WinGroupBox>
          </div>
        )}

        {/* Connection Tab */}
        {activeTab === 'connection' && (
          <div className="space-y-4">
            <WinGroupBox title="Multi-Connection Stream Engine" className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-neutral-600 font-medium">Default Range Streams / Chunks:</label>
                  <WinSelect
                    value={defaultConnections}
                    onChange={(e) => setDefaultConnections(Number(e.target.value))}
                    className="w-full"
                  >
                    <option value={0}>Auto (Recommended, app picks per download)</option>
                    <option value={4}>4 Streams (Manual)</option>
                    <option value={8}>8 Streams (Manual)</option>
                    <option value={16}>16 Streams (Manual)</option>
                    <option value={32}>32 Streams (Manual, High Speed)</option>
                  </WinSelect>
                </div>

                <div className="space-y-1.5">
                  <label className="text-neutral-600 font-medium">Simultaneous Downloads Limit:</label>
                  <div className="flex items-center gap-3">
                    <WinInput
                      type="number"
                      min="1"
                      disabled={isLimitless}
                      value={isLimitless ? '' : maxConcurrent}
                      onChange={(e) => setMaxConcurrent(Math.max(1, Number(e.target.value) || 1))}
                      className="w-24 font-mono text-[12px]"
                      placeholder={isLimitless ? '∞ Unlimited' : '5'}
                    />
                    <WinCheckbox
                      checked={isLimitless}
                      onChange={(checked) => {
                        setIsLimitless(checked);
                        if (!checked && maxConcurrent <= 0) {
                          setMaxConcurrent(5);
                        }
                      }}
                      label="Unlimited / No Limit (Default)"
                    />
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    {isLimitless
                      ? 'Downloads run simultaneously without artificial queuing (Default).'
                      : `Only ${maxConcurrent} download${maxConcurrent === 1 ? '' : 's'} will run at the same time; extras wait in queue.`}
                  </div>
                </div>
              </div>
            </WinGroupBox>

            <WinGroupBox title="Bandwidth Throttling / Speed Limiter" className="space-y-2.5">
              <WinCheckbox
                checked={speedLimitEnabled}
                onChange={setSpeedLimitEnabled}
                label="Enable global speed limiter"
              />
              <div className="flex items-center gap-2 pl-6">
                <WinInput
                  type="number"
                  disabled={!speedLimitEnabled}
                  value={Math.round((speedLimitBps || 1024 * 1024) / 1024)}
                  onChange={(e) => setSpeedLimitBps(Number(e.target.value) * 1024)}
                  className="w-28 font-mono"
                />
                <span className="text-neutral-500">KB/s maximum aggregate transfer rate</span>
              </div>
            </WinGroupBox>
          </div>
        )}

        {/* Save To Tab */}
        {activeTab === 'saveto' && (
          <div className="space-y-4">
            <WinGroupBox title="Storage Directories" className="space-y-3">
              <div className="space-y-1">
                <label className="text-neutral-600 font-medium">Default Download Folder:</label>
                <div className="flex gap-2">
                  <WinInput
                    type="text"
                    value={defaultFolder}
                    onChange={(e) => setDefaultFolder(e.target.value)}
                    className="flex-1 font-mono"
                  />
                  <WinButton
                    variant="secondary"
                    className="px-3"
                    onClick={async () => {
                      const api_any = (window as any).electronAPI;
                      if (api_any?.selectFolder) {
                        const res = await api_any.selectFolder(defaultFolder);
                        if (!res?.canceled && res?.folderPath) setDefaultFolder(res.folderPath);
                      }
                    }}
                  >
                    Browse...
                  </WinButton>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-neutral-600 font-medium">Temporary Assembly Directory:</label>
                <div className="flex gap-2">
                  <WinInput
                    type="text"
                    value={tempDir}
                    onChange={(e) => setTempDir(e.target.value)}
                    className="flex-1 font-mono"
                  />
                  <WinButton
                    variant="secondary"
                    className="px-3"
                    onClick={async () => {
                      const api_any = (window as any).electronAPI;
                      if (api_any?.selectFolder) {
                        const res = await api_any.selectFolder(tempDir);
                        if (!res?.canceled && res?.folderPath) setTempDir(res.folderPath);
                      }
                    }}
                  >
                    Browse...
                  </WinButton>
                </div>
              </div>

              <div className="pt-1 space-y-2">
                <WinCheckbox
                  checked={autoCategorize}
                  onChange={setAutoCategorize}
                  label="Automatically categorize downloads into subfolders by file type"
                />
                <div />
                <WinCheckbox
                  checked={rememberLastFolder}
                  onChange={setRememberLastFolder}
                  label="Remember last selected folder per category"
                />
              </div>
            </WinGroupBox>
          </div>
        )}

        {/* File Types Tab */}
        {activeTab === 'filetypes' && (
          <div className="space-y-3">
            <WinGroupBox title="Auto-Categorization Rules & File Extensions" className="space-y-3">
              <p className="text-[11.5px] text-neutral-500">
                Comma-separated file extensions automatically routed into categories:
              </p>
              <div className="space-y-2 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="w-24 font-semibold text-neutral-900 shrink-0">Compressed:</span>
                  <WinInput
                    value={extCompressed}
                    onChange={(e) => setExtCompressed(e.target.value)}
                    className="flex-1 font-mono text-[11px]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-24 font-semibold text-neutral-900 shrink-0">Documents:</span>
                  <WinInput
                    value={extDocuments}
                    onChange={(e) => setExtDocuments(e.target.value)}
                    className="flex-1 font-mono text-[11px]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-24 font-semibold text-neutral-900 shrink-0">Music:</span>
                  <WinInput
                    value={extMusic}
                    onChange={(e) => setExtMusic(e.target.value)}
                    className="flex-1 font-mono text-[11px]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-24 font-semibold text-neutral-900 shrink-0">Programs:</span>
                  <WinInput
                    value={extPrograms}
                    onChange={(e) => setExtPrograms(e.target.value)}
                    className="flex-1 font-mono text-[11px]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-24 font-semibold text-neutral-900 shrink-0">Video:</span>
                  <WinInput
                    value={extVideo}
                    onChange={(e) => setExtVideo(e.target.value)}
                    className="flex-1 font-mono text-[11px]"
                  />
                </div>
              </div>
            </WinGroupBox>
          </div>
        )}

        {/* Proxy / SOCKS Tab */}
        {activeTab === 'proxy' && (
          <div className="space-y-4">
            <WinGroupBox title="Proxy / SOCKS Server Configuration" className="space-y-3">
              <WinCheckbox
                checked={proxyEnabled}
                onChange={setProxyEnabled}
                label="Use Proxy Server for HTTP/HTTPS downloads"
              />

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-neutral-600">Proxy Type:</label>
                  <WinSelect
                    disabled={!proxyEnabled}
                    value={proxyType}
                    onChange={(e) => setProxyType(e.target.value as any)}
                    className="w-full"
                  >
                    <option value="http">HTTP Proxy</option>
                    <option value="https">HTTPS Proxy</option>
                    <option value="socks5">SOCKS5 Proxy</option>
                  </WinSelect>
                </div>
                <div className="col-span-2">
                  <label className="text-neutral-600">Host / IP:</label>
                  <WinInput
                    type="text"
                    disabled={!proxyEnabled}
                    value={proxyHost}
                    onChange={(e) => setProxyHost(e.target.value)}
                    placeholder="127.0.0.1"
                    className="w-full font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-neutral-600">Port:</label>
                  <WinInput
                    type="number"
                    disabled={!proxyEnabled}
                    value={proxyPort}
                    onChange={(e) => setProxyPort(Number(e.target.value))}
                    className="w-full font-mono"
                  />
                </div>
                <div>
                  <label className="text-neutral-600">Username:</label>
                  <WinInput
                    type="text"
                    disabled={!proxyEnabled}
                    value={proxyUser}
                    onChange={(e) => setProxyUser(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-neutral-600">Password:</label>
                  <WinInput
                    type="password"
                    disabled={!proxyEnabled}
                    value={proxyPass}
                    onChange={(e) => setProxyPass(e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>
            </WinGroupBox>
          </div>
        )}

        {/* Site Logins Tab */}
        {activeTab === 'logins' && (
          <div className="space-y-3">
            <WinGroupBox title="Add Site Authentication Credential" className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <WinInput
                    type="text"
                    value={loginDomain}
                    onChange={(e) => setLoginDomain(e.target.value)}
                    placeholder="Domain (e.g. site.com)"
                    className="w-full"
                  />
                </div>
                <div>
                  <WinInput
                    type="text"
                    value={loginUser}
                    onChange={(e) => setLoginUser(e.target.value)}
                    placeholder="Username"
                    className="w-full"
                  />
                </div>
                <div className="flex gap-1">
                  <WinInput
                    type="password"
                    value={loginPass}
                    onChange={(e) => setLoginPass(e.target.value)}
                    placeholder="Password"
                    className="w-full"
                  />
                  <WinButton
                    variant="primary"
                    onClick={handleAddLogin}
                    className="min-w-[50px] px-2"
                  >
                    Add
                  </WinButton>
                </div>
              </div>
            </WinGroupBox>

            <WinGroupBox title="Saved Site Logins" className="space-y-2">
              <div className="h-32 border border-neutral-300 bg-neutral-50 overflow-y-auto">
                {savedLogins.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-neutral-400 italic text-[11px]">
                    No site credentials saved yet.
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-200">
                    {savedLogins.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between px-2 py-1 text-[11.5px]">
                        <span className="font-semibold text-brand">{item.domain}</span>
                        <span className="text-neutral-500">{item.username || '(token/cookie)'}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteLogin(item.domain)}
                          className="text-status-error hover:underline text-[11px]"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </WinGroupBox>
          </div>
        )}

        {/* Updates Tab (Section 26) */}
        {activeTab === 'updates' && (
          <div className="space-y-4">
            <WinGroupBox title="Version & Release Channel" className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-neutral-600 font-medium text-[11.5px]">Current Installed Version:</label>
                  <div className="text-[13px] font-bold text-neutral-900 bg-neutral-100 px-2.5 py-1 rounded-[2px] border border-neutral-300">
                    {APP_SHORT_NAME} v{APP_VERSION}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-neutral-600 font-medium text-[11.5px]">Release Channel:</label>
                  <WinSelect
                    value={updateChannel}
                    onChange={(e) => {
                      const ch = e.target.value as any;
                      setUpdateChannelLocal(ch);
                      persistUpdatePolicy(ch, checkAutomatically, notifyWhenReady, installAutomatically);
                      if ((window as any).electronAPI?.setUpdateChannel) {
                        (window as any).electronAPI.setUpdateChannel(ch);
                      }
                    }}
                  >
                    <option value="latest">Stable (Recommended)</option>
                    <option value="beta">Beta (Preview Features)</option>
                    <option value="alpha">Alpha (Experimental)</option>
                  </WinSelect>
                </div>
              </div>

              <div className="pt-2 flex items-center gap-3">
                <WinButton
                  variant="primary"
                  onClick={async () => {
                    setCheckingUpdate(true);
                    if ((window as any).electronAPI?.checkForUpdates) {
                      const res = await (window as any).electronAPI.checkForUpdates();
                      setUpdateState(res || { status: 'not-available' });
                    } else {
                      setTimeout(() => {
                        setUpdateState({ status: 'not-available' });
                      }, 600);
                    }
                    setCheckingUpdate(false);
                  }}
                  disabled={checkingUpdate}
                  className="min-w-[130px]"
                >
                  {checkingUpdate ? 'Checking...' : 'Check for Updates'}
                </WinButton>

                <div className="text-[11.5px] text-neutral-600">
                  {checkingUpdate && 'Contacting update server...'}
                  {!checkingUpdate && updateState.status === 'not-available' && "You're up to date."}
                  {!checkingUpdate && updateState.status === 'available' && `Update available: ${updateState.updateInfo?.version || ''}`}
                  {!checkingUpdate && updateState.status === 'error' && `Check failed: ${updateState.error || 'Server unreachable'}`}
                </div>
              </div>
            </WinGroupBox>

            <WinGroupBox title="Update Policy & Automation" className="space-y-2.5">
              <WinCheckbox
                checked={checkAutomatically}
                onChange={(v) => { setCheckAutomatically(v); persistUpdatePolicy(updateChannel, v, notifyWhenReady, installAutomatically); }}
                label="Check automatically for new versions"
              />
              <div />
              <WinCheckbox
                checked={notifyWhenReady}
                onChange={(v) => { setNotifyWhenReady(v); persistUpdatePolicy(updateChannel, checkAutomatically, v, installAutomatically); }}
                label="Notify when an update is downloaded and ready to install"
              />
              <div />
              <WinCheckbox
                checked={installAutomatically}
                onChange={(v) => { setInstallAutomatically(v); persistUpdatePolicy(updateChannel, checkAutomatically, notifyWhenReady, v); }}
                label="Install updates automatically on application exit (silent on restart)"
              />
            </WinGroupBox>
          </div>
        )}

        {/* Browser Tab — integration + capture exceptions */}
        {activeTab === 'browser' && (
          <div className="space-y-4">
            <WinGroupBox title="Browser/System Integration" className="space-y-3">
              <WinCheckbox
                checked={startupWithWindows}
                onChange={setStartupWithWindows}
                label="Launch NDM when my computer starts"
              />
              <WinCheckbox
                checked={showDownloadPanel}
                onChange={setShowDownloadPanel}
                label="Show the in-page download panel on pages with media (browser extension)"
              />
            </WinGroupBox>

            <WinGroupBox title="Capture Downloads from the Following Browsers" className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-[11px] pb-1">
                <span className="text-neutral-500">Connected:</span>
                {Object.keys(connectedBrowsers).length === 0 ? (
                  <span className="text-neutral-400 italic">No extension connected. Install the NDM extension and open your browser</span>
                ) : (
                  Object.entries(connectedBrowsers).map(([name, at]) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] bg-status-completedBg text-status-completed font-medium capitalize"
                      title={`Last heartbeat: ${new Date(at).toLocaleTimeString()}`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-status-completed animate-pulse" />
                      {name}
                    </span>
                  ))
                )}
              </div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
                {([
                  ['chrome', 'Google Chrome'],
                  ['edge', 'Microsoft Edge'],
                  ['firefox', 'Mozilla Firefox'],
                  ['opera', 'Opera'],
                  ['brave', 'Brave'],
                  ['vivaldi', 'Vivaldi'],
                ] as const).map(([key, label]) => (
                  <WinCheckbox
                    key={key}
                    checked={browserFlags[key]}
                    onChange={(v) => setBrowserFlags((prev) => ({ ...prev, [key]: v }))}
                    label={label}
                  />
                ))}
              </div>
              <div className="text-[11px] text-neutral-500">
                Each browser needs the NDM extension installed; unticking stops capture for that browser instantly.
              </div>
            </WinGroupBox>

            <WinGroupBox title="Capture Keys" className="space-y-2">
              <div className="text-[11.5px] text-neutral-600 leading-snug">
                Modifier keys held while a download starts override the rules above:
                force keys capture into NDM even when the type/site is excluded or
                interception is off; prevent keys always leave the download to the
                browser. If both match, prevent wins.
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-neutral-600 font-medium text-[11.5px]">Force download with NDM:</label>
                  <div className="flex gap-3">
                    {(['alt', 'ctrl', 'shift', 'meta'] as const).map((k) => (
                      <WinCheckbox
                        key={k}
                        checked={forceKeys.includes(k)}
                        onChange={(v) => setForceKeys((prev) => v ? [...prev, k] : prev.filter((x) => x !== k))}
                        label={k === 'meta' ? 'Win/⌘' : k === 'ctrl' ? 'Ctrl' : k === 'alt' ? 'Alt' : 'Shift'}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-neutral-600 font-medium text-[11.5px]">Prevent capture (keep in browser):</label>
                  <div className="flex gap-3">
                    {(['alt', 'ctrl', 'shift', 'meta'] as const).map((k) => (
                      <WinCheckbox
                        key={k}
                        checked={preventKeys.includes(k)}
                        onChange={(v) => setPreventKeys((prev) => v ? [...prev, k] : prev.filter((x) => x !== k))}
                        label={k === 'meta' ? 'Win/⌘' : k === 'ctrl' ? 'Ctrl' : k === 'alt' ? 'Alt' : 'Shift'}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </WinGroupBox>

            <WinGroupBox title="Browser Context Menu Items" className="space-y-2">
              <WinCheckbox
                checked={ctxMenu.downloadLink}
                onChange={(v) => setCtxMenu((p) => ({ ...p, downloadLink: v }))}
                label='"Download with NDM" on links'
              />
              <WinCheckbox
                checked={ctxMenu.downloadMedia}
                onChange={(v) => setCtxMenu((p) => ({ ...p, downloadMedia: v }))}
                label='"Download Media with NDM" on images, video and audio'
              />
              <WinCheckbox
                checked={ctxMenu.downloadAllLinks}
                onChange={(v) => setCtxMenu((p) => ({ ...p, downloadAllLinks: v }))}
                label='"Download all links with NDM" on pages'
              />
              <div className="text-[11px] text-neutral-500">Changes reach the extension within ~2 minutes, or instantly when you reopen a page.</div>
            </WinGroupBox>

            <WinGroupBox title="Browser Download Capture Exceptions" className="space-y-3">
              <div className="text-[11.5px] text-neutral-600 leading-snug">
                Downloads matching these are NEVER taken over from the browser —
                the browser handles them normally. Use this to stop NDM from
                grabbing every small image or known-update URL.
              </div>
              <div className="space-y-1">
                <label className="text-neutral-600 font-medium text-[11.5px]">Don't capture these file types (comma-separated, no dots):</label>
                <WinInput
                  value={captureExcludeExt}
                  onChange={(e: any) => setCaptureExcludeExt(e.target.value)}
                  placeholder="e.g. png, jpg, gif, css, js"
                />
                <div className="text-[11px] text-neutral-500">
                  {excludedExtCount > 0 ? `${excludedExtCount} file type${excludedExtCount === 1 ? '' : 's'} will be left to your browser` : 'All file types are captured.'}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-neutral-600 font-medium text-[11.5px]">Don't capture downloads from these sites (comma-separated domains):</label>
                <WinInput
                  value={captureExcludeDomains}
                  onChange={(e: any) => setCaptureExcludeDomains(e.target.value)}
                  placeholder="e.g. update.microsoft.com, download.windowsupdate.com"
                />
                <div className="text-[11px] text-neutral-500">Subdomains are included automatically.</div>
                <div className="text-[11px] text-neutral-500">
                  {excludedDomainCount > 0 ? `${excludedDomainCount} site${excludedDomainCount === 1 ? '' : 's'} will be left to your browser (subdomains included)` : 'All sites are captured.'}
                </div>
              </div>
            </WinGroupBox>
          </div>
        )}

        {/* Sounds Tab — event sounds */}
        {activeTab === 'sounds' && (
          <div className="space-y-4">
            <WinGroupBox title="Event Sounds" className="space-y-3">
              <div className="text-[11.5px] text-neutral-600 leading-snug">
                Play a sound when these events happen. Leave the file empty for
                the built-in system chime, or point to a .wav/.mp3 file. Test
                plays it instantly, exactly as the real event will.
              </div>
              <SoundRow
                event="downloadComplete"
                label="Download complete"
                enabled={soundCompleteEnabled}
                file={soundCompleteFile}
                onEnabled={setSoundCompleteEnabled}
                onFile={setSoundCompleteFile}
              />
              <SoundRow
                event="downloadFailed"
                label="Download failed"
                enabled={soundFailedEnabled}
                file={soundFailedFile}
                onEnabled={setSoundFailedEnabled}
                onFile={setSoundFailedFile}
              />
              <SoundRow
                event="queueStarted"
                label="Queue processing started"
                enabled={soundQueueStartEnabled}
                file={soundQueueStartFile}
                onEnabled={setSoundQueueStartEnabled}
                onFile={setSoundQueueStartFile}
              />
              <SoundRow
                event="queueStopped"
                label="Queue processing stopped/finished"
                enabled={soundQueueStopEnabled}
                file={soundQueueStopFile}
                onEnabled={setSoundQueueStopEnabled}
                onFile={setSoundQueueStopFile}
              />
            </WinGroupBox>
          </div>
        )}
      </div>
    </WindowsDialog>
  );
};
