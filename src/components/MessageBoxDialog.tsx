import React from 'react';
import { WindowsDialog } from './common/WindowsDialog';

export interface MessageBoxOptions {
  title?: string;
  message: string;
  type?: 'info' | 'warning' | 'error' | 'question';
  showCancel?: boolean;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
}

export interface MessageBoxDialogProps {
  isOpen: boolean;
  options: MessageBoxOptions | null;
  onClose: () => void;
}

export const MessageBoxDialog: React.FC<MessageBoxDialogProps> = ({
  isOpen,
  options,
  onClose,
}) => {
  if (!isOpen || !options) return null;

  const {
    title = 'Nogadex Download Manager',
    message,
    type = 'info',
    showCancel = false,
    confirmText = type === 'question' ? 'Yes' : 'OK',
    cancelText = type === 'question' ? 'No' : 'Cancel',
    onConfirm,
  } = options;

  const renderIcon = () => {
    switch (type) {
      case 'question':
        return (
          <div className="w-9 h-9 rounded-full bg-[#005a9e] text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-xs">
            ?
          </div>
        );
      case 'warning':
        return (
          <div className="w-9 h-9 rounded-full bg-[#d97706] text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-xs">
            !
          </div>
        );
      case 'error':
        return (
          <div className="w-9 h-9 rounded-full bg-[#dc2626] text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-xs">
            ✕
          </div>
        );
      case 'info':
      default:
        return (
          <div className="w-9 h-9 rounded-full bg-[#005a9e] text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-xs">
            i
          </div>
        );
    }
  };

  const footer = (
    <>
      <button
        onClick={() => {
          if (onConfirm) onConfirm();
          onClose();
        }}
        className="min-w-[84px] h-[26px] bg-[#005a9e] hover:bg-[#1070ca] text-white font-medium rounded-[2px] shadow-xs"
      >
        {confirmText}
      </button>
      {showCancel && (
        <button
          onClick={onClose}
          className="min-w-[84px] h-[26px] bg-[#f1f5f9] hover:bg-[#e2e8f0] border border-[#cbd5e1] rounded-[2px] text-[#1e293b]"
        >
          {cancelText}
        </button>
      )}
    </>
  );

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      width="w-[440px]"
      footer={footer}
    >
      <div className="flex items-center gap-4 py-2">
        {renderIcon()}
        <p className="text-[12.5px] text-[#1e293b] leading-relaxed select-text flex-1">
          {message}
        </p>
      </div>
    </WindowsDialog>
  );
};
