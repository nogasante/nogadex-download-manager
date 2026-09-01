import React from 'react';
import { ChunkProgress } from '../types/download';

interface ChunkVisualizerProps {
  chunks: ChunkProgress[];
  totalBytes: number;
}

export const ChunkVisualizer: React.FC<ChunkVisualizerProps> = ({ chunks, totalBytes }) => {
  if (!chunks || chunks.length === 0) {
    return (
      <div className="h-4 w-full bg-[#0d0d10] rounded border border-[#222226] flex items-center justify-center text-[10px] text-zinc-500 font-mono">
        Single Stream Connection
      </div>
    );
  }

  const finishedCount = chunks.filter(c => c.status === 'done' || (c.totalBytes > 0 && c.downloadedBytes >= c.totalBytes)).length;

  return (
    <div className="space-y-1.5 select-none">
      <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
        <span className="flex items-center gap-1.5 text-white">
          <span className="w-2 h-2 rounded-full bg-[#d8c8b4] animate-pulse"></span>
          Parallel 64-Thread Stream Matrix ({chunks.length} Connections)
        </span>
        <span className="text-[#d8c8b4] font-semibold">
          {finishedCount}/{chunks.length} Streams Completed
        </span>
      </div>

      {/* Multi-Segment Warm Beige Visualizer Bar */}
      <div className="h-5 w-full bg-[#0d0d10] rounded-lg overflow-hidden border border-[#27272a] p-0.5 flex gap-0.5">
        {chunks.map((chunk) => {
          const percent = chunk.totalBytes > 0 
            ? Math.min(100, Math.round((chunk.downloadedBytes / chunk.totalBytes) * 100))
            : 0;

          const isDone = chunk.status === 'done' || percent >= 100;
          const isActive = chunk.status === 'active' && !isDone;

          return (
            <div
              key={chunk.id}
              className="relative h-full flex-1 bg-[#18181c] rounded-[2px] overflow-hidden group cursor-pointer"
              title={`Thread #${chunk.id + 1}: ${percent}% (${(chunk.downloadedBytes / (1024 * 1024)).toFixed(2)} MB / ${(chunk.totalBytes / (1024 * 1024)).toFixed(2)} MB)`}
            >
              {/* Progress Fill in Warm Champagne & Beige */}
              <div
                className={`h-full transition-all duration-200 ${
                  isDone
                    ? 'bg-[#d8c8b4]'
                    : isActive
                    ? 'bg-gradient-to-t from-[#c4b5a0] to-[#f0e8dc] chunk-beige-active shadow-[0_0_8px_rgba(216,200,180,0.6)]'
                    : 'bg-[#27272a]'
                }`}
                style={{ width: `${percent}%` }}
              />

              <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
            </div>
          );
        })}
      </div>
    </div>
  );
};
