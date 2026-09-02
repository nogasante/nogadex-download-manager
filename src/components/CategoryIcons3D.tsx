import React from 'react';

// 1. All Downloads - Semi-3D Golden Manila Folder
export const Semi3DFolder: React.FC<{ className?: string; isOpen?: boolean }> = ({ className = 'w-4 h-4', isOpen = false }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fold_back" x1="10" y1="3" x2="10" y2="17" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
      <linearGradient id="fold_front" x1="10" y1="7" x2="10" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#f59e0b" />
      </linearGradient>
    </defs>
    {/* Folder Back Tab */}
    <path d="M2 4.5C2 3.67 2.67 3 3.5 3H7.5L9.5 5H16.5C17.33 5 18 5.67 18 6.5V14.5C18 15.33 17.33 16 16.5 16H3.5C2.67 16 2 15.33 2 14.5V4.5Z" fill="url(#fold_back)" />
    {/* Folder Back Highlight */}
    <path d="M3.5 3.5H7.3L9.3 5.5H16.5" stroke="#fde68a" strokeWidth="0.8" strokeLinecap="round" />
    {/* Folder Front Flap */}
    <path d={isOpen ? "M1.5 8.5H18.5L16.8 16.5C16.6 17.3 15.9 18 15.1 18H4.9C4.1 18 3.4 17.3 3.2 16.5L1.5 8.5Z" : "M2 7.5C2 6.67 2.67 6 3.5 6H16.5C17.33 6 18 6.67 18 7.5V15.5C18 16.33 17.33 17 16.5 17H3.5C2.67 17 2 16.33 2 15.5V7.5Z"} fill="url(#fold_front)" />
    <path d="M2.5 6.5H16.5" stroke="#fef3c7" strokeWidth="0.8" strokeLinecap="round" />
  </svg>
);

// 2. Compressed - Semi-3D Zip File / Archive Box with Steel Zipper
export const Semi3DZip: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="zip_body" x1="10" y1="2" x2="10" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fb923c" />
        <stop offset="100%" stopColor="#ea580c" />
      </linearGradient>
    </defs>
    {/* Folder/Box Outline */}
    <rect x="3" y="2.5" width="14" height="15" rx="2" fill="url(#zip_body)" stroke="#c2410c" strokeWidth="0.8" />
    <path d="M4 3.5H16" stroke="#fed7aa" strokeWidth="0.8" strokeLinecap="round" />
    {/* Steel Zipper Track */}
    <rect x="8.5" y="2.5" width="3" height="10" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.5" />
    <line x1="8.5" y1="4.5" x2="11.5" y2="4.5" stroke="#475569" strokeWidth="0.8" />
    <line x1="8.5" y1="6.5" x2="11.5" y2="6.5" stroke="#475569" strokeWidth="0.8" />
    <line x1="8.5" y1="8.5" x2="11.5" y2="8.5" stroke="#475569" strokeWidth="0.8" />
    <line x1="8.5" y1="10.5" x2="11.5" y2="10.5" stroke="#475569" strokeWidth="0.8" />
    {/* Zipper Puller */}
    <rect x="8" y="11.5" width="4" height="4.5" rx="1" fill="#f1f5f9" stroke="#64748b" strokeWidth="0.6" />
    <circle cx="10" cy="14" r="0.8" fill="#475569" />
  </svg>
);

// 3. Documents - Semi-3D Blue & White Sheet with Dog-Ear
export const Semi3DDocument: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="doc_body" x1="10" y1="2" x2="10" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#e2e8f0" />
      </linearGradient>
    </defs>
    {/* Sheet with Corner Fold */}
    <path d="M4 4C4 2.9 4.9 2 6 2H12L16 6V16C16 17.1 15.1 18 14 18H6C4.9 18 4 17.1 4 16V4Z" fill="url(#doc_body)" stroke="#94a3b8" strokeWidth="0.8" />
    {/* Dog-ear Triangle */}
    <path d="M12 2V5C12 5.5 12.5 6 13 6H16L12 2Z" fill="#3b82f6" opacity="0.9" />
    {/* Blue Text Lines */}
    <line x1="6.5" y1="8" x2="13.5" y2="8" stroke="#3b82f6" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="6.5" y1="11" x2="13.5" y2="11" stroke="#64748b" strokeWidth="1" strokeLinecap="round" />
    <line x1="6.5" y1="14" x2="11" y2="14" stroke="#64748b" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

// 4. Music - Semi-3D Purple Audio Disc / Note
export const Semi3DMusic: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mus_body" x1="10" y1="2" x2="10" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#c084fc" />
        <stop offset="100%" stopColor="#7e22ce" />
      </linearGradient>
    </defs>
    <circle cx="10" cy="10" r="8" fill="url(#mus_body)" stroke="#6b21a8" strokeWidth="0.8" />
    <circle cx="10" cy="10" r="7.2" stroke="#e9d5ff" strokeWidth="0.6" opacity="0.6" />
    {/* Music Note */}
    <path d="M8 12.5C8 11.7 8.7 11 9.5 11C9.8 11 10.1 11.1 10.3 11.3V6.5L14 5.5V8.5L11 9.3V13.5C11 14.3 10.3 15 9.5 15C8.7 15 8 14.3 8 13.5V12.5Z" fill="#ffffff" />
  </svg>
);

// 5. Programs - Semi-3D Emerald Software Package / EXE Box
export const Semi3DProgram: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="prog_top" x1="10" y1="2" x2="10" y2="8" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#4ade80" />
        <stop offset="100%" stopColor="#22c55e" />
      </linearGradient>
      <linearGradient id="prog_left" x1="3" y1="6" x2="10" y2="17" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#16a34a" />
        <stop offset="100%" stopColor="#15803d" />
      </linearGradient>
      <linearGradient id="prog_right" x1="10" y1="6" x2="17" y2="17" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#15803d" />
        <stop offset="100%" stopColor="#166534" />
      </linearGradient>
    </defs>
    {/* Isometric Cube Top */}
    <polygon points="10,2.5 16.5,6 10,9.5 3.5,6" fill="url(#prog_top)" stroke="#15803d" strokeWidth="0.6" />
    {/* Isometric Cube Left */}
    <polygon points="3.5,6 10,9.5 10,17 3.5,13.5" fill="url(#prog_left)" stroke="#14532d" strokeWidth="0.6" />
    {/* Isometric Cube Right */}
    <polygon points="10,9.5 16.5,6 16.5,13.5 10,17" fill="url(#prog_right)" stroke="#14532d" strokeWidth="0.6" />
    {/* CD Symbol on Top */}
    <ellipse cx="10" cy="6" rx="2.5" ry="1.2" fill="#dcfce7" opacity="0.8" />
  </svg>
);

// 6. Video - Semi-3D Dark Clapperboard / Film Frame
export const Semi3DVideo: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="vid_body" x1="10" y1="2" x2="10" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="100%" stopColor="#0284c7" />
      </linearGradient>
    </defs>
    <rect x="2.5" y="4" width="15" height="12" rx="2" fill="url(#vid_body)" stroke="#0369a1" strokeWidth="0.8" />
    <path d="M3.5 5H16.5" stroke="#bae6fd" strokeWidth="0.8" strokeLinecap="round" />
    {/* Film Clapper Stripes */}
    <rect x="2.5" y="4" width="15" height="4" rx="1.5" fill="#0f172a" />
    <line x1="5" y1="4" x2="7" y2="8" stroke="#ffffff" strokeWidth="1.2" />
    <line x1="9" y1="4" x2="11" y2="8" stroke="#ffffff" strokeWidth="1.2" />
    <line x1="13" y1="4" x2="15" y2="8" stroke="#ffffff" strokeWidth="1.2" />
    {/* Play Triangle */}
    <polygon points="8.5,10 13,12.5 8.5,15" fill="#ffffff" />
  </svg>
);

// 7. Unfinished - Semi-3D Sapphire Time Indicator
export const Semi3DUnfinished: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="unfin_body" x1="10" y1="2" x2="10" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#60a5fa" />
        <stop offset="100%" stopColor="#2563eb" />
      </linearGradient>
    </defs>
    <circle cx="10" cy="10" r="7.5" fill="url(#unfin_body)" stroke="#1d4ed8" strokeWidth="0.8" />
    <circle cx="10" cy="10" r="6.8" stroke="#dbeafe" strokeWidth="0.6" opacity="0.6" />
    {/* Clock Hands */}
    <path d="M10 5.5V10.5L13.5 12" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// 8. Finished - Semi-3D Emerald Checkmark Badge
export const Semi3DFinished: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fin_body" x1="10" y1="2" x2="10" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#4ade80" />
        <stop offset="100%" stopColor="#16a34a" />
      </linearGradient>
    </defs>
    <circle cx="10" cy="10" r="7.5" fill="url(#fin_body)" stroke="#15803d" strokeWidth="0.8" />
    <circle cx="10" cy="10" r="6.8" stroke="#dcfce7" strokeWidth="0.6" opacity="0.6" />
    {/* White Check */}
    <path d="M6.5 10.5L9 13L13.5 7.5" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// 9. Queues - Semi-3D Indigo Document Stack
export const Semi3DQueues: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="q_body" x1="10" y1="2" x2="10" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#818cf8" />
        <stop offset="100%" stopColor="#4f46e5" />
      </linearGradient>
    </defs>
    {/* Bottom Layer */}
    <path d="M4 14L10 16.5L16 14" stroke="#4338ca" strokeWidth="1.8" strokeLinecap="round" />
    {/* Mid Layer */}
    <path d="M4 10.5L10 13L16 10.5" stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round" />
    {/* Top Diamond */}
    <polygon points="10,4.5 16,7.5 10,10.5 4,7.5" fill="url(#q_body)" stroke="#3730a3" strokeWidth="0.8" />
    <polygon points="10,5.5 14.5,7.5 10,9.5 5.5,7.5" fill="#e0e7ff" opacity="0.6" />
  </svg>
);
