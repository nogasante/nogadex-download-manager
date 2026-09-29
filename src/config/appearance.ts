/* ==========================================================================
   Appearance — theme, UI scale and icon style for the whole app.

   Single source of truth (persisted in localStorage under 'ndm_appearance').
   Every window (main + standalone dialogs) applies it on startup via the
   pre-paint script in index.html and keeps listening for changes, so a
   switch in Settings re-skins every open window instantly.

   Keep in sync with the pre-paint snippet in index.html (same keys/values).
   ========================================================================== */

export type ThemeMode = 'system' | 'light' | 'dark';
export type IconStyle = 'color' | 'mono' | 'contrast';

export interface AppearanceSettings {
  theme: ThemeMode;
  /** Base font size in px — the app's zoom dial (14 small, 15 default, 16 large, 18 extra large) */
  uiScale: number;
  iconStyle: IconStyle;
}

export const APPEARANCE_KEY = 'ndm_appearance';

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'system',
  uiScale: 15,
  iconStyle: 'color',
};

export const UI_SCALE_OPTIONS: { value: number; label: string }[] = [
  { value: 13, label: 'Compact' },
  { value: 14, label: 'Small' },
  { value: 15, label: 'Default' },
  { value: 16, label: 'Large' },
  { value: 18, label: 'Extra Large' },
];

export const ICON_STYLE_OPTIONS: { value: IconStyle; label: string; hint: string }[] = [
  { value: 'color', label: 'Color 3D', hint: 'The glossy colored icon set (default)' },
  { value: 'mono', label: 'Monochrome', hint: 'Grayscale icons — calm and ink-friendly' },
  { value: 'contrast', label: 'High contrast', hint: 'Punchier icons for dark rooms and low vision' },
];

const clampScale = (n: unknown): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_APPEARANCE.uiScale;
  return Math.min(22, Math.max(12, Math.round(v)));
};

const normTheme = (t: unknown): ThemeMode =>
  t === 'light' || t === 'dark' ? t : 'system';

const normIcons = (i: unknown): IconStyle =>
  i === 'mono' || i === 'contrast' ? i : 'color';

export function loadAppearance(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    const parsed = JSON.parse(raw);
    return {
      theme: normTheme(parsed?.theme),
      uiScale: clampScale(parsed?.uiScale),
      iconStyle: normIcons(parsed?.iconStyle),
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(a: AppearanceSettings): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a));
  } catch {}
}

/** Does the OS currently prefer dark? */
export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Effective dark decision for a mode. */
export function isDarkMode(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'system' && systemPrefersDark());
}

/**
 * Apply appearance to this window's DOM + the Electron native side.
 * Safe to call repeatedly; sets exactly what changed.
 */
export function applyAppearance(a: AppearanceSettings): void {
  const root = document.documentElement;
  const dark = isDarkMode(a.theme);

  root.classList.toggle('theme-dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  // The UI is px-based, so scale it with CSS zoom (15px = 1.0).
  root.style.setProperty('--ndm-ui-zoom', String(clampScale(a.uiScale) / 15));
  if (a.iconStyle === 'color') root.removeAttribute('data-icons');
  else root.setAttribute('data-icons', a.iconStyle);

  // Keep the native window chrome (frameless background) in step.
  try {
    (window as any).electronAPI?.setNativeTheme?.(a.theme);
  } catch {}
}

/**
 * Live-wire appearance: apply now and re-apply whenever it changes
 * (another window) or the OS theme flips while in 'system' mode.
 * Returns a cleanup function.
 */
export function watchAppearance(): () => void {
  let current = loadAppearance();
  applyAppearance(current);

  const onStorage = (e: StorageEvent) => {
    if (e.key !== APPEARANCE_KEY) return;
    current = loadAppearance();
    applyAppearance(current);
  };
  window.addEventListener('storage', onStorage);

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onOsFlip = () => {
    if (current.theme === 'system') applyAppearance(current);
  };
  try {
    mq.addEventListener('change', onOsFlip);
  } catch {
    // older Chromium
    mq.addListener?.(onOsFlip);
  }

  return () => {
    window.removeEventListener('storage', onStorage);
    try {
      mq.removeEventListener('change', onOsFlip);
    } catch {
      mq.removeListener?.(onOsFlip);
    }
  };
}

/**
 * Update + persist + broadcast to every other open window.
 * (Windows in the same renderer origin see it through the storage event.)
 */
export function changeAppearance(patch: Partial<AppearanceSettings>): AppearanceSettings {
  const next: AppearanceSettings = {
    ...loadAppearance(),
    ...patch,
  };
  next.theme = normTheme(next.theme);
  next.uiScale = clampScale(next.uiScale);
  next.iconStyle = normIcons(next.iconStyle);
  saveAppearance(next);
  applyAppearance(next);
  return next;
}
