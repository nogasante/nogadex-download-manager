/**
 * NDM Design System - single source of truth for color, type, and elevation.
 *
 * THREE LAYERS + THEME VARIABLES:
 *  - brand    : the Windows accent blue family (interactive + selected states)
 *  - neutral  : text / chrome grays (slate-based, 50-900)
 *  - status   : transfer-state colors shared by badges, chips, rows, progress
 *
 * THEME: every color below references a CSS variable from index.css.
 * The default (light) values live on :root; `.theme-dark` on <html> swaps the
 * variable values, so ALL existing utility classes (bg-white, text-neutral-800,
 * bg-neutral-100 ...) adapt without touching a single component.
 * The Appearance tab in Settings sets .theme-dark / font scale / icon style.
 *
 * Rules of the system:
 *  - No arbitrary hex classes in components. If you need a new color, add a
 *    token here first.
 *  - Semantic role first: `bg-brand-tint text-status-downloading`, never
 *    "light blue". Status tokens pair: `X` (text/dot) with `XBg` (chip bg).
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand: Windows accent blue (buttons, links, selection, focus)
        brand: {
          DEFAULT: 'var(--brand)',
          hover:   'var(--brand-hover)',
          active:  'var(--brand-active)',
          soft:    'var(--brand-soft)',
          bright:  'var(--brand-bright)',
          glow:    'var(--brand-glow)',
          deep:    'var(--brand-deep)',
          tint:      'var(--brand-tint)',
          tintHover: 'var(--brand-tint-hover)',
          tintEdge:  'var(--brand-tint-edge)',
        },
        // Neutral: text + chrome grays
        neutral: {
          50:  'var(--neutral-50)',
          100: 'var(--neutral-100)',
          200: 'var(--neutral-200)',
          300: 'var(--neutral-300)',
          400: 'var(--neutral-400)',
          500: 'var(--neutral-500)',
          600: 'var(--neutral-600)',
          700: 'var(--neutral-700)',
          800: 'var(--neutral-800)',
          900: 'var(--neutral-900)',
        },
        // Status: transfer states (badge text + chip background pairs)
        status: {
          downloading:    'var(--status-downloading)',
          downloadingBg:  'var(--status-downloading-bg)',
          completed:      'var(--status-completed)',
          completedBg:    'var(--status-completed-bg)',
          paused:         'var(--status-paused)',
          pausedBg:       'var(--status-paused-bg)',
          error:          'var(--status-error)',
          errorBg:        'var(--status-error-bg)',
          queued:         'var(--status-queued)',
          assembling:     'var(--status-assembling)',
        },
        danger: 'var(--danger)',
        // Physical whites/blacks that must NOT flip with the theme
        // (progress-bar gloss, text on colored fills, dialog dimmer).
        surface: {
          fixed:  '#ffffff',
          fixedBg: '#000000',
        },
      },
      fontFamily: {
        sans: ['Segoe UI Variable', 'Segoe UI', '-apple-system', 'BlinkMacSystemFont', 'Roboto', 'sans-serif'],
        mono: ['Consolas', 'JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'dialog': '0 8px 32px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.08)',
        'context': '0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06)',
        'menu': '0 4px 12px rgba(0, 0, 0, 0.15)',
      }
    },
  },
  plugins: [],
}
