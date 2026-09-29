import React, { useEffect } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { APP_NAME } from '../config/appInfo';
import { playSystemBeep } from '../utils/soundUtils';

export interface MessageBoxButton {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  action: () => void;
}

export interface MessageBoxOptions {
  title?: string;
  message: string;
  type?: 'info' | 'warning' | 'error' | 'question';
  showCancel?: boolean;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  /**
   * Structured buttons. Legacy callers may pass 'yes_no'/'ok' or a string
   * array; these are normalized below instead of crashing the app.
   */
  buttons?: MessageBoxButton[] | string[] | 'yes_no' | 'ok';
}

export interface MessageBoxDialogProps {
  isOpen: boolean;
  options: MessageBoxOptions | null;
  onClose: () => void;
}

/**
 * Normalize legacy button specs ('yes_no' / 'ok' / string[]) into structured
 * buttons wired to the confirm/cancel callbacks, so a bad caller can never
 * crash the app.
 */
function normalizeButtons(options: MessageBoxOptions): MessageBoxButton[] {
  const raw = options.buttons;
  if (typeof raw === 'string') {
    return raw === 'yes_no'
      ? [
          { label: options.confirmText || (options.type === 'question' ? 'Yes' : 'OK'), variant: 'primary', action: () => options.onConfirm?.() },
          { label: options.cancelText || (options.type === 'question' ? 'No' : 'Cancel'), action: () => options.onCancel?.() },
        ]
      : [{ label: options.confirmText || 'OK', variant: 'primary', action: () => options.onConfirm?.() }];
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof (raw as any[])[0] === 'string') {
    return (raw as string[]).map((label, idx) => ({
      label,
      variant: idx === 0 ? ('primary' as const) : undefined,
      action: () => (idx === 0 ? options.onConfirm?.() : options.onCancel?.()),
    }));
  }
  return (raw as MessageBoxButton[]) || [];
}

export const MessageBoxDialog: React.FC<MessageBoxDialogProps> = ({
  isOpen,
  options,
  onClose,
}) => {
  useEffect(() => {
    if (isOpen && options) {
      playSystemBeep();

      if ((window as any).electronAPI?.showNativeMessageBox) {
        const structured = normalizeButtons(options);
        const btnLabels = structured.length > 0
          ? structured.map(b => b.label)
          : (options.showCancel ? [options.confirmText || (options.type === 'question' ? 'Yes' : 'OK'), options.cancelText || (options.type === 'question' ? 'No' : 'Cancel')] : [options.confirmText || 'OK']);

        (window as any).electronAPI.showNativeMessageBox({
          type: options.type || 'info',
          buttons: btnLabels,
          defaultId: 0,
          cancelId: btnLabels.length > 1 ? btnLabels.length - 1 : 0,
          title: options.title || APP_NAME,
          message: options.message || '',
        }).then((responseIdx: number) => {
          if (structured[responseIdx]) {
            structured[responseIdx].action();
          } else if (responseIdx === 0 && options.onConfirm) {
            options.onConfirm();
          }
          onClose();
        }).catch(() => {});
      }
    }
  }, [isOpen, options, onClose]);

  if (!isOpen || !options) return null;

  // In Electron environment, native dialog handles presentation completely
  if ((window as any).electronAPI?.showNativeMessageBox) {
    return null;
  }

  // Normalize legacy button specs so a bad caller can never crash the app.
  const buttons = normalizeButtons(options);

  const {
    title = APP_NAME,
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
          <div className="w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-xs select-none">
            ?
          </div>
        );
      case 'warning':
        return (
          <div className="w-9 h-9 rounded-full bg-status-paused text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-xs select-none">
            !
          </div>
        );
      case 'error':
        return (
          <div className="w-9 h-9 rounded-full bg-status-error text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-xs select-none">
            ✕
          </div>
        );
      case 'info':
      default:
        return (
          <div className="w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-xs select-none">
            i
          </div>
        );
    }
  };

  const footer = buttons && buttons.length > 0 ? (
    <>
      {buttons.map((btn, idx) => (
        <button
          key={idx}
          type="button"
          onClick={btn.action}
          className={`min-w-[84px] h-[26px] px-3 font-medium rounded-[2px] text-[12px] shadow-xs cursor-pointer transition-colors ${
            btn.variant === 'primary'
              ? 'bg-brand hover:bg-brand-hover text-white border border-brand-active'
              : 'bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 text-neutral-800'
          }`}
        >
          {btn.label}
        </button>
      ))}
    </>
  ) : (
    <>
      <button
        type="button"
        onClick={() => {
          if (onConfirm) onConfirm();
          onClose();
        }}
        className="min-w-[84px] h-[26px] bg-brand hover:bg-brand-hover text-white font-medium rounded-[2px] shadow-xs cursor-pointer"
      >
        {confirmText}
      </button>
      {showCancel && (
        <button
          type="button"
          onClick={onClose}
          className="min-w-[84px] h-[26px] bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 rounded-[2px] text-neutral-800 cursor-pointer"
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
      width="w-[460px]"
      footer={footer}
    >
      <div className="flex items-center gap-4 py-2">
        {renderIcon()}
        <p className="text-[12.5px] text-neutral-800 leading-relaxed select-text flex-1">
          {message}
        </p>
      </div>
    </WindowsDialog>
  );
};
