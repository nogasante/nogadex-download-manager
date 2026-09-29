import React from 'react';
import { useTranslation } from 'react-i18next';
import { EngineStats } from '../types/download';
import { APP_VERSION_LABEL, APP_NAME, APP_VERSION, APP_ARCH } from '../config/appInfo';
import { formatSize, formatSpeed } from '../utils/formatters';

interface StatusBarProps {
  totalCount: number;
  filteredCount: number;
  selectedCount: number;
  selectedBytes: number;
  activeCount: number;
  completedCount: number;
  stats: EngineStats;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  totalCount,
  filteredCount,
  selectedCount,
  selectedBytes,
  activeCount,
  completedCount,
  stats,
}) => {
  const { t } = useTranslation();

  // Pane 1: Items Count & Selection status (Windows Explorer format)
  const renderItemsPane = () => {
    const baseCount = filteredCount !== totalCount 
      ? `${filteredCount} / ${totalCount} ${t('status.items', { count: totalCount })}`
      : t('status.items', { count: totalCount });

    if (selectedCount > 0) {
      const sizeSuffix = selectedBytes > 0 ? ` (${formatSize(selectedBytes)})` : '';
      return `${baseCount}  •  ${t('status.selected', { count: selectedCount })}${sizeSuffix}`;
    }
    return baseCount;
  };

  // Pane 2: Transfer activity status
  const renderActivityPane = () => {
    if (activeCount > 0 && completedCount > 0) {
      return `${t('status.downloadingCount', { count: activeCount })}, ${t('status.completeCount', { count: completedCount })}`;
    }
    if (activeCount > 0) {
      return t('status.downloadingCount', { count: activeCount });
    }
    if (completedCount > 0) {
      return t('status.completeCount', { count: completedCount });
    }
    return t('status.ready');
  };

  // Authentic Windows Sizing Grip Drag-Resize Handler
  const handleGripMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    let lastX = e.clientX;
    let lastY = e.clientY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - lastX;
      const deltaY = moveEvent.clientY - lastY;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;

      if ((window as any).electronAPI?.resizeStep) {
        (window as any).electronAPI.resizeStep(deltaX, deltaY);
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <footer 
      role="contentinfo" 
      aria-label="Status Bar"
      className="h-[24px] ndm-titlebar border-t border-neutral-300 flex items-center gap-1.5 px-2 text-[11.5px] text-neutral-800 select-none font-sans shrink-0"
    >
      {/* Pane 1: Items & Selection */}
      <div 
        title="Total items and current selection"
        className="h-[18px] px-2.5 bg-white border border-neutral-300 border-b-neutral-400 border-r-neutral-400 rounded-[1px] flex items-center min-w-[140px] text-neutral-800"
      >
        <span>{renderItemsPane()}</span>
      </div>

      {/* Pane 2: Activity Status */}
      <div 
        title="Download activity status"
        className="h-[18px] px-2.5 bg-white border border-neutral-300 border-b-neutral-400 border-r-neutral-400 rounded-[1px] flex items-center min-w-[150px] text-neutral-800"
      >
        <span>{renderActivityPane()}</span>
      </div>

      {/* Pane 3: Transfer Speed */}
      <div 
        title="Current total bandwidth speed"
        className="h-[18px] px-2.5 bg-white border border-neutral-300 border-b-neutral-400 border-r-neutral-400 rounded-[1px] flex items-center min-w-[100px] text-neutral-800"
      >
        <span className={stats.totalSpeedBps > 0 ? 'text-status-completed font-medium' : 'text-neutral-600'}>
          {formatSpeed(stats.totalSpeedBps)}
        </span>
      </div>

      {/* Flexible Spacer pushing the version pane to the far right */}
      <div className="flex-1" />

      {/* Pane 4: Realtime App Version on the far right linked from appInfo/package.json */}
      <div 
        title={`${APP_NAME} Version ${APP_VERSION} (${APP_ARCH})`}
        className="h-[18px] px-2.5 bg-white border border-neutral-300 border-b-neutral-400 border-r-neutral-400 rounded-[1px] flex items-center shrink-0 text-neutral-600 font-medium"
      >
        <span>{APP_VERSION_LABEL}</span>
      </div>

      {/* Authentic Windows SBARS_SIZEGRIP: 3 diagonal 3D grooved ridges with active drag-resize */}
      <div 
        onMouseDown={handleGripMouseDown}
        title="Drag to resize window"
        className="w-3.5 h-3.5 flex items-end justify-end cursor-nwse-resize select-none pb-0.5 pr-0.5 opacity-65 hover:opacity-100 transition-opacity shrink-0"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Ridge 1: Longest */}
          <line x1="1" y1="11" x2="11" y2="1" stroke="#8492a6" strokeWidth="1" strokeLinecap="round" />
          <line x1="2" y1="12" x2="12" y2="2" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" />
          {/* Ridge 2: Middle */}
          <line x1="5" y1="11" x2="11" y2="5" stroke="#8492a6" strokeWidth="1" strokeLinecap="round" />
          <line x1="6" y1="12" x2="12" y2="6" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" />
          {/* Ridge 3: Shortest */}
          <line x1="9" y1="11" x2="11" y2="9" stroke="#8492a6" strokeWidth="1" strokeLinecap="round" />
          <line x1="10" y1="12" x2="12" y2="10" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" />
        </svg>
      </div>
    </footer>
  );
};
