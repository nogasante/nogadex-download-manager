import React, { useState } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { WinButton, WinInput, WinCheckbox, WinTabs } from './common/WinControls';
import { getApiBaseUrl } from '../config/apiConfig';

interface AdvancedSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isStandalone?: boolean;
  onSave?: (auth: { username?: string; password?: string; remember?: boolean }) => void;
}

export const AdvancedSettingsDialog: React.FC<AdvancedSettingsDialogProps> = ({
  isOpen,
  onClose,
  isStandalone = false,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState<'auth' | 'proxy'>('auth');
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [remember, setRemember] = useState<boolean>(true);

  // Proxy settings state
  const [useProxy, setUseProxy] = useState<boolean>(false);
  const [proxyHost, setProxyHost] = useState<string>('');
  const [proxyPort, setProxyPort] = useState<string>('8080');

  const handleOk = async () => {
    // Proxy tab: apply to the live proxy subsystem (same store as Settings →
    // Proxy / SOCKS); Auth tab: save as a site credential for later reuse.
    try {
      await fetch(`${getApiBaseUrl()}/api/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: useProxy,
          type: 'http',
          host: proxyHost,
          port: Number(proxyPort) || 8080,
        }),
      });
    } catch {}
    if (username.trim()) {
      try {
        await fetch(`${getApiBaseUrl()}/api/credentials`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: new URL(window.location.href).hostname || 'manual-entry',
            authType: 'basic',
            username: username.trim(),
            password,
          }),
        });
      } catch {}
    }
    onSave?.({ username, password, remember });
    onClose();
  };

  const tabs = [
    { id: 'auth', label: 'Authentication' },
    { id: 'proxy', label: 'Proxy settings' },
  ];

  const footer = (
    <div className="flex items-center justify-end gap-2 w-full">
      <WinButton variant="primary" onClick={handleOk} className="min-w-[76px]">
        OK
      </WinButton>
      <WinButton variant="secondary" onClick={onClose} className="min-w-[76px]">
        Cancel
      </WinButton>
    </div>
  );

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Advanced settings"
      width="w-[500px]"
      footer={footer}
      isStandalone={isStandalone}
      autoFitHeight={isStandalone}
    >
      <div className="space-y-4 font-sans text-[12px]">
        <WinTabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={(id) => setActiveTab(id as 'auth' | 'proxy')}
        />

        {activeTab === 'auth' && (
          <div className="space-y-3.5 pt-2">
            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
              <label className="text-neutral-400 text-[12px]">User Name</label>
              <WinInput
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder=""
                className="w-full h-[28px] text-[12px]"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
              <label className="text-neutral-400 text-[12px]">Password</label>
              <WinInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder=""
                className="w-full h-[28px] text-[12px]"
              />
            </div>

            <div className="pt-2 pl-[100px]">
              <WinCheckbox
                checked={remember}
                onChange={setRemember}
                label="Remember authentication for this website"
              />
            </div>
          </div>
        )}

        {activeTab === 'proxy' && (
          <div className="space-y-3.5 pt-2">
            <WinCheckbox
              checked={useProxy}
              onChange={setUseProxy}
              label="Use custom proxy for this download"
            />

            {useProxy && (
              <div className="space-y-2.5 pt-1">
                <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                  <label className="text-neutral-400 text-[12px]">Proxy Server</label>
                  <WinInput
                    type="text"
                    value={proxyHost}
                    onChange={(e) => setProxyHost(e.target.value)}
                    placeholder="e.g. proxy.example.com"
                    className="w-full h-[28px] text-[12px]"
                  />
                </div>

                <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                  <label className="text-neutral-400 text-[12px]">Port</label>
                  <WinInput
                    type="text"
                    value={proxyPort}
                    onChange={(e) => setProxyPort(e.target.value)}
                    placeholder="8080"
                    className="w-[100px] h-[28px] text-[12px]"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </WindowsDialog>
  );
};
