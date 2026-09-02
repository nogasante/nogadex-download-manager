import React from 'react';
import { DownloadChunk } from '../types/download';

interface ChunkVisualizerProps {
  chunks: DownloadChunk[];
  totalBytes?: number;
}

export const ChunkVisualizer: React.FC<ChunkVisualizerProps> = ({ chunks }) => {
  if (!chunks || chunks.length === 0) {
    return (
      <div className="p-4 text-center text-[13px] text-[#888880] font-sans">
        Single-stream direct download (no range chunks)
      </div>
    );
  }

  const completedCount = chunks.filter(c => c.status === 'completed').length;
  const activeCount = chunks.filter(c => c.status === 'downloading').length;

  return (
    <div className="space-y-3 select-none text-[13px]">
      <div className="flex justify-between items-center text-[12.5px] text-[#555550]">
        <span>Parallel Range Matrix ({chunks.length} streams)</span>
        <span className="font-mono">
          <b className="text-[#026aa7]">{activeCount}</b> active • {completedCount}/{chunks.length} completed
        </span>
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5 p-2 bg-[#f6f6f4] border border-[#e4e4e0] rounded">
        {chunks.map((chunk) => {
          const chunkLen = Math.max(1, chunk.end - chunk.start + 1);
          const pct = Math.min(100, Math.round((chunk.downloaded / chunkLen) * 100));
          const isDone = chunk.status === 'completed' || pct >= 100;
          const isActive = chunk.status === 'downloading';

          return (
            <div
              key={chunk.id}
              className={`h-7 rounded-sm border px-1 flex flex-col justify-center text-[11px] font-mono transition-colors ${
                isDone
                  ? 'bg-[#e2f0d9] border-[#b2d8a0] text-[#276a16]'
                  : isActive
                    ? 'bg-[#deecf9] border-[#9bc4e8] text-[#005a9e] animate-pulse'
                    : 'bg-[#ffffff] border-[#e0e0dc] text-[#70706a]'
              }`}
              title={`Chunk ${chunk.id + 1}: ${pct}% (${chunk.downloaded} / ${chunkLen} bytes)`}
            >
              <div className="flex justify-between items-center leading-none">
                <span>#{chunk.id + 1}</span>
                <span className="font-bold">{pct}%</span>
              </div>
              <div className="w-full bg-black/10 h-1 rounded-sm mt-0.5 overflow-hidden">
                <div
                  className={`h-full ${isDone ? 'bg-[#276a16]' : isActive ? 'bg-[#005a9e]' : 'bg-transparent'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
