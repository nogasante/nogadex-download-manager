import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { Minus, X } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { playSystemBeep } from '../../utils/soundUtils';
import ndmLogo from '../../assets/logo.png';

export interface WindowsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: string;
  width?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  isStandalone?: boolean;
  showMinimize?: boolean;
  noScroll?: boolean;
  /** Standalone windows only: keep the OS window height fitted to the content. */
  autoFitHeight?: boolean;
}

export const WindowsDialog: React.FC<WindowsDialogProps> = ({
  isOpen,
  onClose,
  title,
  icon = ndmLogo,
  width = 'w-[560px]',
  children,
  footer,
  className = '',
  isStandalone = false,
  showMinimize = false,
  noScroll = false,
  autoFitHeight = false,
}) => {
  const [isFlashing, setIsFlashing] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  useEscapeKey(onClose, isOpen);

  // Auto-fit: when enabled, a standalone OS window is resized to its natural
  // content height. Without this, collapsing a section (e.g. the download-status
  // dialog's per-connection details table) shrinks the DOM but the BrowserWindow
  // keeps its old fixed size, leaving dead space above the footer.
  // Measured with a Range over the body's children (no wrapper element, so the
  // body's space-y gutters stay intact). The reported height EASES toward the
  // target (exponential smoothing per frame), so content changes like ticking
  // "Use authorization" grow/shrink the window smoothly instead of snapping.
  // The first measurement after open snaps instantly (the window starts at its
  // spec size — easing from zero would look like a flicker).
  useEffect(() => {
    if (!isOpen || !isStandalone || !autoFitHeight) return;

    let raf = 0;
    let current = 0; // last height we reported; eased toward the target
    const range = document.createRange();

    const fit = () => {
      const body = bodyRef.current;
      if (!body || !body.isConnected) return;
      range.selectNodeContents(body);
      const rect = range.getBoundingClientRect();
      if (rect.height <= 0) return;
      const titleBarH = 32; // h-8 native title bar
      const bodyPadY = 32;  // p-4 top + bottom on the body
      const footerH = footerRef.current?.offsetHeight || 0;
      const target = Math.ceil(titleBarH + bodyPadY + rect.height + footerH);
      if (current === 0) {
        current = target;
        (window as any).electronAPI?.autoFitWindowHeight?.(current);
      } else if (target !== Math.round(current)) {
        current += (target - current) * 0.35; // ~90% settled in ~100ms
        if (Math.abs(target - current) < 1) current = target;
        (window as any).electronAPI?.autoFitWindowHeight?.(Math.round(current));
      }
      raf = requestAnimationFrame(fit);
    };
    raf = requestAnimationFrame(fit);

    return () => cancelAnimationFrame(raf);
  }, [isOpen, isStandalone, autoFitHeight]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    playSystemBeep();
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 220);
  };

  const handleMinimize = () => {
    if ((window as any).electronAPI?.minimize) {
      (window as any).electronAPI.minimize();
    }
  };

  // Standalone OS Window Layout (fills 100% of the BrowserWindow)
  if (isStandalone) {
    const footerNode = footer ? (
      <div ref={footerRef} className="h-12 ndm-footer px-4 py-2 flex items-center justify-end gap-2 shrink-0 z-10 box-border rounded-b-[6px]">
        {footer}
      </div>
    ) : null;

    return (
      <div ref={rootRef} className={`w-full h-full flex flex-col ndm-window text-[12px] text-neutral-800 select-none font-sans overflow-hidden box-border transition-all duration-100 ${
        isFlashing ? 'border-brand scale-[1.002]' : ''
      } ${className}`}>
        {/* Exact Parent-Matching Native Title Bar */}
        <div
          style={{ WebkitAppRegion: 'drag' } as any}
          className="h-8 ndm-titlebar flex items-center justify-between px-3 select-none text-[13px] font-sans shrink-0 z-50 border-b border-neutral-200"
        >
          <div className="flex items-center gap-2 pointer-events-none">
            <img
              src={icon}
              alt=""
              className="w-[18px] h-[18px] shrink-0 object-contain pointer-events-none"
              style={{ imageRendering: '-webkit-optimize-contrast' }}
            />
            <span className="font-semibold text-neutral-800 tracking-tight text-[12.5px]">
              {title}
            </span>
          </div>
          <div
            style={{ WebkitAppRegion: 'no-drag' } as any}
            className="flex items-center h-full -mr-3"
          >
            {showMinimize && (
              <button
                type="button"
                onClick={handleMinimize}
                className="w-11 h-full flex items-center justify-center hover:bg-neutral-100 text-neutral-600 transition-colors"
                title="Minimize"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-full flex items-center justify-center hover:bg-danger hover:text-white text-neutral-600 transition-colors"
              title="Close (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Content Body — body keeps space-y gutters; auto-fit measures its
            children with a Range so no wrapper element is needed. */}
        <div ref={bodyRef} className={`p-4 space-y-3.5 flex-1 min-h-0 ndm-body ${noScroll ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {children}
        </div>

        {/* Unified Footer */}
        {footerNode}
      </div>
    );
  }

  // In-DOM Modal Fallback Layout (for headless browser tests & embedded views)
  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 font-sans select-none p-4"
    >
      <div
        className={`${width} max-h-[92vh] bg-white flex flex-col text-[12px] text-neutral-800 transition-all duration-100 box-border overflow-hidden shadow-dialog border border-neutral-200 ${
          isFlashing ? 'border-brand scale-[1.005]' : ''
        } ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Exact Parent-Matching Native Title Bar */}
        <div
          style={{ WebkitAppRegion: 'drag' } as any}
          className="h-8 ndm-titlebar flex items-center justify-between px-3 select-none text-[13px] font-sans shrink-0 z-50 border-b border-neutral-200"
        >
          <div className="flex items-center gap-2 pointer-events-none">
            <img
              src={icon}
              alt=""
              className="w-[18px] h-[18px] shrink-0 object-contain pointer-events-none"
              style={{ imageRendering: '-webkit-optimize-contrast' }}
            />
            <span className="font-semibold text-neutral-800 tracking-tight text-[12.5px]">
              {title}
            </span>
          </div>
          <div
            style={{ WebkitAppRegion: 'no-drag' } as any}
            className="flex items-center h-full -mr-3"
          >
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-full flex items-center justify-center hover:bg-danger hover:text-white text-neutral-600 transition-colors"
              title="Close (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className={`p-4 space-y-3.5 ${noScroll ? 'overflow-hidden' : 'overflow-y-auto'} flex-1 min-h-0 w-full box-border ndm-body`}>
          {children}
        </div>

        {/* Unified Footer */}
        {footer && (
          <div className="h-12 ndm-footer px-4 py-2 flex items-center justify-end gap-2 shrink-0 rounded-b-[6px] box-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
