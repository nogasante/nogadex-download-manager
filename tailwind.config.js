/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        win: {
          bg: '#f9f9f8',
          surface: '#ffffff',
          toolbar: '#f3f3f2',
          border: '#e5e5e3',
          borderDark: '#d1d1cf',
          headerBg: '#f6f6f5',
          hoverRow: '#f3f3f1',
          selectedRow: '#ece6df',
          selectedBorder: '#d6c8b8',
          text: '#1e1e1e',
          textSecondary: '#606060',
          textDisabled: '#9e9e9e',
        },
        accent: {
          DEFAULT: '#e6d8c7',
          hover: '#dccebc',
          pressed: '#cdbfae',
          border: '#c4b5a3',
          text: '#3a2d1d',
          dark: '#93785a',
        },
        status: {
          downloading: '#0067b8',
          downloadingBg: '#e5f3ff',
          completed: '#107c41',
          completedBg: '#dff6dd',
          paused: '#8a6600',
          pausedBg: '#fff4ce',
          failed: '#a80000',
          failedBg: '#fde7e9',
        }
      },
      fontFamily: {
        sans: ['Segoe UI Variable', 'Segoe UI', '-apple-system', 'BlinkMacSystemFont', 'Roboto', 'sans-serif'],
        mono: ['Consolas', 'JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'dialog': '0 8px 32px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.08)',
        'context': '0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06)',
      }
    },
  },
  plugins: [],
}