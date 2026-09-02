import React, { useState, useEffect } from 'react';
import { AppSettings } from '../types/download';
import { WindowsDialog } from './common/WindowsDialog';
import { WinCheckbox, WinInput, WinSelect, WinButton, WinGroupBox, WinTabs } from './common/WinControls';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'connection' | 'saveto' | 'filetypes' | 'proxy' | 'logins'>('general');

  // General
  const [doubleClickAction, setDoubleClickAction] = useState(settings.doubleClickAction || 'open_file');
  const [autoStart, setAutoStart] = useState(settings.autoStartDownloads ?? true);
  const [overwrite, setOverwrite] = useState(settings.overwriteExisting ?? false);
  const [monitorClipboard, setMonitorClipboard] = useState(true);

  // Connection
  const [maxConcurrent, setMaxConcurrent] = useState(settings.maxConcurrentDownloads || 5);
  const [defaultConnections, setDefaultConnections] = useState(settings.defaultConnections || 32);
  const [speedLimitBps, setSpeedLimitBps] = useState(settings.speedLimitBps || 0);
  const [speedLimitEnabled, setSpeedLimitEnabled] = useState(Boolean(settings.speedLimitBps && settings.speedLimitBps > 0));

  // Save To Paths
  const userDownloads = 'C:\\Users\\nanas\\Downloads';
  const userTemp = 'C:\\Users\\nanas\\AppData\\Local\\Temp\\NogadexDownloads';
  const [defaultFolder, setDefaultFolder] = useState(settings.defaultFolder || settings.defaultDownloadFolder || userDownloads);
  const [tempDir, setTempDir] = useState(settings.tempDir || settings.tempDownloadFolder || userTemp);
  const [autoCategorize, setAutoCategorize] = useState(settings.autoCategorize ?? true);
  const [rememberLastFolder, setRememberLastFolder] = useState(settings.rememberLastFolder ?? true);

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

  useEffect(() => {
    if (isOpen) {
      fetch('/api/proxy')
        .then((r) => r.json())
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
      const res = await fetch('/api/credentials', {
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
      await fetch(`/api/credentials/${encodeURIComponent(domain)}`, { method: 'DELETE' });
      setSavedLogins(savedLogins.filter((l) => l.domain !== domain));
    } catch {}
  };

  const handleSave = async () => {
    try {
      await fetch('/api/proxy', {
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
      });
    } catch {}

    await onSaveSettings({
      doubleClickAction,
      autoStartDownloads: autoStart,
      overwriteExisting: overwrite,
      maxConcurrentDownloads: maxConcurrent,
      defaultConnections,
      speedLimitBps: speedLimitEnabled ? (speedLimitBps || 1024 * 1024) : 0,
      defaultDownloadFolder: defaultFolder,
      tempDownloadFolder: tempDir,
      defaultFolder,
      tempDir,
      autoCategorize,
      rememberLastFolder,
    });
    onClose();
  };

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
    { id: 'general', label: 'General' },
    { id: 'connection', label: 'Connection' },
    { id: 'saveto', label: 'Save To' },
    { id: 'filetypes', label: 'File Types' },
    { id: 'proxy', label: 'Proxy / SOCKS' },
    { id: 'logins', label: 'Site Logins' },
  ];

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Configuration Options"
      width="w-[620px]"
      footer={footer}
    >
      <WinTabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as any)} />

      <div className="space-y-4 min-h-[280px]">
        {/* General Tab */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <WinGroupBox title="Startup & Integration" className="space-y-2.5">
              <WinCheckbox
                checked={autoStart}
                onChange={setAutoStart}
                label="Start downloading immediately when a new URL is added"
              />
              <div />
              <WinCheckbox
                checked={monitorClipboard}
                onChange={setMonitorClipboard}
                label="Automatically monitor clipboard for downloadable media links"
              />
              <div />
              <WinCheckbox
                checked={overwrite}
                onChange={setOverwrite}
                label="Overwrite existing files automatically without prompting"
              />
            </WinGroupBox>

            <WinGroupBox title="List Interaction" className="space-y-2">
              <div className="flex items-center gap-3">
                <label className="text-[#475569]">Double-click item action:</label>
                <WinSelect
                  value={doubleClickAction}
                  onChange={(e) => setDoubleClickAction(e.target.value as any)}
                >
                  <option value="open_file">Open downloaded file</option>
                  <option value="open_folder">Open containing folder in Explorer</option>
                  <option value="properties">Show download properties sheet</option>
                </WinSelect>
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
                  <label className="text-[#475569] font-medium">Default Range Streams / Chunks:</label>
                  <WinSelect
                    value={defaultConnections}
                    onChange={(e) => setDefaultConnections(Number(e.target.value))}
                    className="w-full"
                  >
                    <option value={4}>4 Streams</option>
                    <option value={8}>8 Streams</option>
                    <option value={16}>16 Streams</option>
                    <option value={32}>32 Streams (High Speed Multi-Thread)</option>
                  </WinSelect>
                </div>

                <div className="space-y-1">
                  <label className="text-[#475569] font-medium">Max Simultaneous Downloads:</label>
                  <WinSelect
                    value={maxConcurrent}
                    onChange={(e) => setMaxConcurrent(Number(e.target.value))}
                    className="w-full"
                  >
                    <option value={1}>1 download at a time</option>
                    <option value={3}>3 concurrent downloads</option>
                    <option value={5}>5 concurrent downloads (Recommended)</option>
                    <option value={10}>10 concurrent downloads</option>
                  </WinSelect>
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
                <span className="text-[#64748b]">KB/s maximum aggregate transfer rate</span>
              </div>
            </WinGroupBox>
          </div>
        )}

        {/* Save To Tab */}
        {activeTab === 'saveto' && (
          <div className="space-y-4">
            <WinGroupBox title="Storage Directories" className="space-y-3">
              <div className="space-y-1">
                <label className="text-[#475569] font-medium">Default Download Folder:</label>
                <div className="flex gap-2">
                  <WinInput
                    type="text"
                    value={defaultFolder}
                    onChange={(e) => setDefaultFolder(e.target.value)}
                    className="flex-1 font-mono"
                  />
                  <WinButton variant="secondary" className="px-3">Browse...</WinButton>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[#475569] font-medium">Temporary Assembly Directory:</label>
                <div className="flex gap-2">
                  <WinInput
                    type="text"
                    value={tempDir}
                    onChange={(e) => setTempDir(e.target.value)}
                    className="flex-1 font-mono"
                  />
                  <WinButton variant="secondary" className="px-3">Browse...</WinButton>
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
            <WinGroupBox title="Auto-Categorization Extensions" className="space-y-2">
              <div className="space-y-2 text-[11.5px]">
                <div>
                  <span className="font-semibold text-[#0f172a]">Compressed:</span>{' '}
                  <span className="font-mono text-[#64748b]">ZIP, RAR, 7Z, TAR, GZ, BZ2, ISO, DMG</span>
                </div>
                <div>
                  <span className="font-semibold text-[#0f172a]">Documents:</span>{' '}
                  <span className="font-mono text-[#64748b]">PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT</span>
                </div>
                <div>
                  <span className="font-semibold text-[#0f172a]">Music:</span>{' '}
                  <span className="font-mono text-[#64748b]">MP3, WAV, FLAC, AAC, OGG, M4A</span>
                </div>
                <div>
                  <span className="font-semibold text-[#0f172a]">Programs:</span>{' '}
                  <span className="font-mono text-[#64748b]">EXE, MSI, BAT, CMD, APK, BIN</span>
                </div>
                <div>
                  <span className="font-semibold text-[#0f172a]">Video:</span>{' '}
                  <span className="font-mono text-[#64748b]">MP4, MKV, AVI, MOV, WMV, FLV, WEBM</span>
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
                  <label className="text-[#475569]">Proxy Type:</label>
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
                  <label className="text-[#475569]">Host / IP:</label>
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
                  <label className="text-[#475569]">Port:</label>
                  <WinInput
                    type="number"
                    disabled={!proxyEnabled}
                    value={proxyPort}
                    onChange={(e) => setProxyPort(Number(e.target.value))}
                    className="w-full font-mono"
                  />
                </div>
                <div>
                  <label className="text-[#475569]">Username:</label>
                  <WinInput
                    type="text"
                    disabled={!proxyEnabled}
                    value={proxyUser}
                    onChange={(e) => setProxyUser(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-[#475569]">Password:</label>
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
              <div className="h-32 border border-[#cbd5e1] bg-[#fafafa] overflow-y-auto">
                {savedLogins.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-[#94a3b8] italic text-[11px]">
                    No site credentials saved yet.
                  </div>
                ) : (
                  <div className="divide-y divide-[#e2e8f0]">
                    {savedLogins.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between px-2 py-1 text-[11.5px]">
                        <span className="font-semibold text-[#005a9e]">{item.domain}</span>
                        <span className="text-[#64748b]">{item.username || '(token/cookie)'}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteLogin(item.domain)}
                          className="text-[#dc2626] hover:underline text-[11px]"
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
      </div>
    </WindowsDialog>
  );
};
