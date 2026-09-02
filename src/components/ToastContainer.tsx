import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-9 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none select-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto bg-[#ffffff] border border-[#d4d4cf] rounded shadow-lg p-3 flex items-start gap-2.5 text-[13px] text-[#222222]"
        >
          {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-[#0f7b3d] shrink-0 mt-0.5" />}
          {t.type === 'error' && <AlertCircle className="w-4 h-4 text-[#b3261e] shrink-0 mt-0.5" />}
          {t.type === 'info' && <Info className="w-4 h-4 text-[#026aa7] shrink-0 mt-0.5" />}

          <div className="flex-1">
            <div className="font-semibold text-[#1a1a1a]">{t.title}</div>
            <div className="text-[#555550] text-[12.5px] mt-0.5 break-all">{t.message}</div>
          </div>

          <button
            onClick={() => onDismiss(t.id)}
            className="text-[#888880] hover:text-[#111111] leading-none text-base"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
