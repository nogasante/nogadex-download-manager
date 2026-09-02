import React from 'react';
import { WindowsDialog } from './common/WindowsDialog';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({ isOpen, onClose }) => {
  const footer = (
    <button
      onClick={onClose}
      className="min-w-[84px] h-[26px] bg-[#005a9e] hover:bg-[#1070ca] text-white font-medium rounded-[2px] shadow-xs"
    >
      OK
    </button>
  );

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onClose}
      title="About Nogadex Download Manager"
      width="w-[420px]"
      footer={footer}
    >
      <div className="flex gap-4 py-1">
        <img src="/logo.png" alt="Nogadex" className="w-10 h-10 object-contain shrink-0" />
        <div className="space-y-2">
          <div>
            <h2 className="text-[14px] font-bold text-[#0f172a]">Nogadex Download Manager</h2>
            <div className="text-[11.5px] text-[#64748b]">Version 2.4.0 (Windows Native Build)</div>
          </div>
          <p className="text-[11.5px] text-[#475569] leading-relaxed">
            Multi-connection parallel stream download accelerator with dynamic segmenting, site grabber, and native Windows shell file associations.
          </p>
          <div className="text-[10.5px] text-[#94a3b8] pt-1 border-t border-[#e2e8f0]">
            Copyright  2026 Nogadex Systems. All rights reserved.
          </div>
        </div>
      </div>
    </WindowsDialog>
  );
};
