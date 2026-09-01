import React from 'react';
import { ChunkProgress } from '../types/download';

interface ChunkVisualizerProps {
  chunks: ChunkProgress[];
  totalBytes: number;
}

export const ChunkVisualizer: React.FC<ChunkVisualizerProps> = ({ chunks, totalBytes }) => {
  if (!chunks || chunks.length === 0) {
    return (
      <div className="h-4 w-full bg-slate-950 rounded-lg overflow-hidden border border-slate-800 flex items-center justify-center text-[10px] text-slate-500 font-mono">
        Single Stream (Non-Segmented)
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-cyan-400 animate-pulse"></span>
          Parallel Streams ({chunks.length} Connections)
        </span>
        <span className="text-slate-500">
          {chunks.filter(c => c.status === 'done').length}/{chunks.length} Finished
        </span>
      </div>

      {/* Multi-Segment Visualizer Bar */}
      <div className="h-5 w-full bg-slate-950 rounded-lg overflow-hidden border border-slate-800/80 p-0.5 flex gap-0.5">
        {chunks.map((chunk) => {
          const percent = chunk.totalBytes > 0 
            ? Math.min(100, Math.round((chunk.downloadedBytes / chunk.totalBytes) * 100))
            : 0;

          const isDone = chunk.status === 'done' || percent >= 100;
          const isActive = chunk.status === 'active' && !isDone;

          return (
            <div
              key={chunk.id}
              className="relative h-full flex-1 bg-slate-900 rounded-[2px] overflow-hidden group cursor-pointer"
              title={`Thread #${chunk.id + 1}: ${percent}% (${(chunk.downloadedBytes / (1024 * 1024)).toFixed(1)}MB / ${(chunk.totalBytes / (1024 * 1024)).toFixed(1)}MB)`}
            >
              {/* Progress Fill */}
              <div
                className={`h-full transition-all duration-200 ${
                  isDone
                    ? 'bg-emerald-500'
                    : isActive
                    ? 'bg-gradient-to-t from-cyan-600 to-cyan-400 animate-chunk-active shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                    : 'bg-slate-800'
                }`}
                style={{ width: `${percent}%` }}
              />

              {/* Hover Tooltip Glow */}
              <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
            </div>
          );
        })}
      </div>
    </div>
  );
};
