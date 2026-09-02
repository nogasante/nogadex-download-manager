import React, { ReactNode } from 'react';

export interface WindowsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: string;
  width?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export const WindowsDialog: React.FC<WindowsDialogProps> = ({
  isOpen,
  onClose,
  title,
  icon = '/logo.png',
  width = 'w-[520px]',
  children,
  footer,
  className = '',
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 font-sans select-none">
      <div
        className={`${width} max-h-[90vh] bg-[#ffffff] border border-[#70baff] shadow-[0_10px_25px_rgba(0,0,0,0.25)] rounded-[4px] flex flex-col text-[12px] text-[#1e293b] ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Unified Win32 Title Bar with App Logo */}
        <div className="h-8 bg-[#f8fafc] border-b border-[#e2e8f0] px-3 flex items-center justify-between text-[#0f172a] shrink-0 rounded-t-[3px]">
          <div className="flex items-center gap-2 font-semibold text-[12.5px] truncate pr-2">
            <img src={icon} alt="" className="w-4 h-4 object-contain shrink-0" />
            <span className="truncate">{title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center hover:bg-[#e81123] hover:text-white rounded-[2px] text-[#64748b] transition-colors shrink-0 font-mono text-[11px]"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 space-y-3.5 overflow-y-auto flex-1">
          {children}
        </div>

        {/* Unified Footer */}
        {footer && (
          <div className="h-11 bg-[#f8fafc] border-t border-[#e2e8f0] px-4 flex items-center justify-end gap-2 shrink-0 rounded-b-[3px]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
