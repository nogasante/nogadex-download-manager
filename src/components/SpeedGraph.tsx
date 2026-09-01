import React from 'react';

interface SpeedGraphProps {
  history: number[]; // In KB/s
  currentBps: number;
}

export const SpeedGraph: React.FC<SpeedGraphProps> = ({ history, currentBps }) => {
  const maxVal = Math.max(...history, 500); // minimum scale 500 KB/s
  const height = 48;
  const width = 240;

  // Build SVG path points
  const points = history.map((val, idx) => {
    const x = (idx / (history.length - 1)) * width;
    const y = height - (val / maxVal) * (height - 8) - 4;
    return `${x},${y}`;
  }).join(' ');

  const areaPath = `${points} ${width},${height} 0,${height}`;

  return (
    <div className="flex items-center gap-4 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-3.5 backdrop-blur-md">
      <div className="flex flex-col justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Live Throughput</span>
        <div className="text-lg font-mono font-black text-cyan-400">
          {(currentBps / (1024 * 1024)).toFixed(2)} <span className="text-xs text-slate-400 font-normal">MB/s</span>
        </div>
        <span className="text-[10px] font-mono text-emerald-400/80">Peak: {(maxVal / 1024).toFixed(2)} MB/s</span>
      </div>

      <div className="relative w-[240px] h-[48px] overflow-hidden rounded-lg bg-slate-950/80 border border-slate-800/50">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
          <defs>
            <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          {/* Gradient Fill */}
          <polygon points={areaPath} fill="url(#speedGrad)" />
          {/* Smooth Line */}
          <polyline
            fill="none"
            stroke="#06b6d4"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />
        </svg>
      </div>
    </div>
  );
};
