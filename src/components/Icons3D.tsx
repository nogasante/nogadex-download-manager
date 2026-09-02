import React from 'react';

export const Icon3DAdd: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 36 36" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="add_grad" x1="18" y1="2" x2="18" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#4ade80" />
        <stop offset="40%" stopColor="#22c55e" />
        <stop offset="100%" stopColor="#15803d" />
      </linearGradient>
      <filter id="add_shadow" x="0" y="2" width="36" height="36" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#15803d" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#add_shadow)">
      {/* 3D Circular Base */}
      <circle cx="18" cy="17" r="14" fill="url(#add_grad)" stroke="#166534" strokeWidth="1" />
      {/* Specular Top Rim */}
      <path d="M7 14C9.5 7.5 26.5 7.5 29 14" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      {/* 3D Embossed Plus */}
      <path d="M18 10V24M11 17H25" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 10.5V23.5M11.5 17H24.5" stroke="#ecfdf5" strokeWidth="2" strokeLinecap="round" />
    </g>
  </svg>
);

export const Icon3DResume: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 36 36" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="resume_grad" x1="18" y1="2" x2="18" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#6ee7b7" />
        <stop offset="50%" stopColor="#10b981" />
        <stop offset="100%" stopColor="#047857" />
      </linearGradient>
      <filter id="resume_shadow" x="0" y="2" width="36" height="36" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#047857" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#resume_shadow)">
      <circle cx="18" cy="17" r="14" fill="url(#resume_grad)" stroke="#065f46" strokeWidth="1" />
      <path d="M7 14C9.5 7.5 26.5 7.5 29 14" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      {/* 3D Play Triangle */}
      <polygon points="14,11 26,17 14,23" fill="#ffffff" stroke="#065f46" strokeWidth="0.5" />
      <polygon points="15,13 23,17 15,21" fill="#ecfdf5" opacity="0.9" />
    </g>
  </svg>
);

export const Icon3DStop: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 36 36" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="stop_grad" x1="18" y1="2" x2="18" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fde047" />
        <stop offset="50%" stopColor="#eab308" />
        <stop offset="100%" stopColor="#a16207" />
      </linearGradient>
      <filter id="stop_shadow" x="0" y="2" width="36" height="36" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#854d0e" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#stop_shadow)">
      <circle cx="18" cy="17" r="14" fill="url(#stop_grad)" stroke="#854d0e" strokeWidth="1" />
      <path d="M7 14C9.5 7.5 26.5 7.5 29 14" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      {/* 3D Pause Bars */}
      <rect x="13" y="11" width="3.5" height="12" rx="1" fill="#ffffff" />
      <rect x="19.5" y="11" width="3.5" height="12" rx="1" fill="#ffffff" />
    </g>
  </svg>
);

export const Icon3DStopAll: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 36 36" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="stopall_grad" x1="18" y1="2" x2="18" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#f87171" />
        <stop offset="50%" stopColor="#ef4444" />
        <stop offset="100%" stopColor="#b91c1c" />
      </linearGradient>
      <filter id="stopall_shadow" x="0" y="2" width="36" height="36" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#991b1b" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#stopall_shadow)">
      <circle cx="18" cy="17" r="14" fill="url(#stopall_grad)" stroke="#991b1b" strokeWidth="1" />
      <path d="M7 14C9.5 7.5 26.5 7.5 29 14" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      {/* 3D Stop Square */}
      <rect x="12" y="11" width="12" height="12" rx="2" fill="#ffffff" />
      <rect x="13.5" y="12.5" width="9" height="9" rx="1" fill="#fef2f2" opacity="0.9" />
    </g>
  </svg>
);

export const Icon3DDelete: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 36 36" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="del_grad" x1="18" y1="2" x2="18" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fca5a5" />
        <stop offset="50%" stopColor="#f43f5e" />
        <stop offset="100%" stopColor="#be123c" />
      </linearGradient>
      <filter id="del_shadow" x="0" y="2" width="36" height="36" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#9f1239" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#del_shadow)">
      <circle cx="18" cy="17" r="14" fill="url(#del_grad)" stroke="#9f1239" strokeWidth="1" />
      <path d="M7 14C9.5 7.5 26.5 7.5 29 14" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      {/* 3D Trash Symbol */}
      <path d="M12 13H24M14 13V22C14 23.1 14.9 24 16 24H20C21.1 24 22 23.1 22 22V13M16 10H20" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  </svg>
);

export const Icon3DDeleteCompleted: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 36 36" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="delc_grad" x1="18" y1="2" x2="18" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#c084fc" />
        <stop offset="50%" stopColor="#9333ea" />
        <stop offset="100%" stopColor="#6b21a8" />
      </linearGradient>
      <filter id="delc_shadow" x="0" y="2" width="36" height="36" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#581c87" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#delc_shadow)">
      <circle cx="18" cy="17" r="14" fill="url(#delc_grad)" stroke="#581c87" strokeWidth="1" />
      <path d="M7 14C9.5 7.5 26.5 7.5 29 14" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      {/* 3D Checkmarks */}
      <path d="M12 17L16 21L24 13" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  </svg>
);

export const Icon3DOptions: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 36 36" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="opt_grad" x1="18" y1="2" x2="18" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#94a3b8" />
        <stop offset="50%" stopColor="#475569" />
        <stop offset="100%" stopColor="#1e293b" />
      </linearGradient>
      <filter id="opt_shadow" x="0" y="2" width="36" height="36" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#0f172a" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#opt_shadow)">
      <circle cx="18" cy="17" r="14" fill="url(#opt_grad)" stroke="#0f172a" strokeWidth="1" />
      <path d="M7 14C9.5 7.5 26.5 7.5 29 14" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      {/* 3D Gear */}
      <circle cx="18" cy="17" r="4" fill="#f8fafc" />
      <path d="M18 9V11M18 23V25M10 17H12M24 17H26M12.3 11.3L13.7 12.7M22.3 21.3L23.7 22.7M12.3 22.7L13.7 21.3M22.3 12.7L23.7 11.3" stroke="#f8fafc" strokeWidth="2.5" strokeLinecap="round" />
    </g>
  </svg>
);

export const Icon3DScheduler: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 36 36" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sched_grad" x1="18" y1="2" x2="18" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fdba74" />
        <stop offset="50%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#c2410c" />
      </linearGradient>
      <filter id="sched_shadow" x="0" y="2" width="36" height="36" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#9a3412" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#sched_shadow)">
      <circle cx="18" cy="17" r="14" fill="url(#sched_grad)" stroke="#9a3412" strokeWidth="1" />
      <path d="M7 14C9.5 7.5 26.5 7.5 29 14" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      {/* 3D Clock Hands */}
      <circle cx="18" cy="17" r="8" fill="#fff7ed" />
      <path d="M18 12V17L21.5 19" stroke="#ea580c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  </svg>
);

export const Icon3DBatch: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 36 36" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="batch_grad" x1="18" y1="2" x2="18" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#60a5fa" />
        <stop offset="50%" stopColor="#2563eb" />
        <stop offset="100%" stopColor="#1d4ed8" />
      </linearGradient>
      <filter id="batch_shadow" x="0" y="2" width="36" height="36" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#1e40af" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#batch_shadow)">
      <circle cx="18" cy="17" r="14" fill="url(#batch_grad)" stroke="#1e40af" strokeWidth="1" />
      <path d="M7 14C9.5 7.5 26.5 7.5 29 14" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      {/* 3D Stacked Layers */}
      <path d="M18 10L10 14L18 18L26 14L18 10Z" fill="#eff6ff" />
      <path d="M10 17.5L18 21.5L26 17.5" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 21L18 25L26 21" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
    </g>
  </svg>
);


export const Icon3DGrabber: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 36 36" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grabber_grad" x1="18" y1="2" x2="18" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="40%" stopColor="#0284c7" />
        <stop offset="100%" stopColor="#0369a1" />
      </linearGradient>
      <filter id="grabber_shadow" x="0" y="2" width="36" height="36" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#0369a1" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#grabber_shadow)">
      <circle cx="18" cy="18" r="14" fill="url(#grabber_grad)" stroke="#ffffff" strokeWidth="1.2" />
      {/* Globe Lat/Long grid */}
      <ellipse cx="18" cy="18" rx="7" ry="14" stroke="#ffffff" strokeWidth="1.2" fill="none" opacity="0.8" />
      <line x1="4" y1="18" x2="32" y2="18" stroke="#ffffff" strokeWidth="1.2" opacity="0.8" />
      <line x1="6" y1="11" x2="30" y2="11" stroke="#ffffff" strokeWidth="1" opacity="0.6" />
      <line x1="6" y1="25" x2="30" y2="25" stroke="#ffffff" strokeWidth="1" opacity="0.6" />
    </g>
  </svg>
);
