/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Base surfaces — dark trading-terminal ground, darkest to most elevated.
        surface: '#0a0e17',
        card: '#121826',
        'card-hover': '#161d2c',
        border: '#1e2636',
        'border-strong': '#2a3348',
        // Semantic signal colors — load-bearing meaning across the app, do not repurpose.
        // These stay WCAG-safe for text/icons; `neon-*` below are the higher-voltage glow
        // variants used only for shadows/borders (decorative, layered on top of these).
        bull: '#22c55e',
        bear: '#ef4444',
        flat: '#eab308',
        info: '#38bdf8',
        'neon-bull': '#39ff14',
        'neon-bear': '#ff1744',
        // Interactive/brand accent — nav, focus rings, links, primary actions.
        accent: '#3b82f6',
        'accent-hover': '#60a5fa',
      },
      fontFamily: {
        sans: [
          '"IBM Plex Sans"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Arial',
          '"Noto Sans Hebrew"',
          '"Arial Hebrew"',
          'sans-serif',
        ],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // Display face for the brand, headings and hero numbers — the visible identity shift.
        display: ['"Space Grotesk"', '"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.35), 0 1px 1px rgba(0,0,0,.25)',
        elevated: '0 16px 40px -12px rgba(0,0,0,.6)',
        'glow-accent': '0 0 0 1px rgba(59,130,246,.5), 0 0 16px rgba(59,130,246,.45)',
        'glow-accent-sm': '0 0 0 1px rgba(59,130,246,.4), 0 0 8px rgba(59,130,246,.35)',
        'glow-bull': '0 0 0 1px rgba(57,255,20,.35), 0 0 22px -2px rgba(57,255,20,.4)',
        'glow-bear': '0 0 0 1px rgba(255,23,68,.35), 0 0 22px -2px rgba(255,23,68,.4)',
        'glow-flat': '0 0 0 1px rgba(234,179,8,.3), 0 0 18px -2px rgba(234,179,8,.35)',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-glow-bull': {
          '0%, 100%': { boxShadow: '0 0 0 1px rgba(57,255,20,.3), 0 0 16px -4px rgba(57,255,20,.3)' },
          '50%': { boxShadow: '0 0 0 1px rgba(57,255,20,.5), 0 0 34px -2px rgba(57,255,20,.55)' },
        },
        'pulse-glow-bear': {
          '0%, 100%': { boxShadow: '0 0 0 1px rgba(255,23,68,.3), 0 0 16px -4px rgba(255,23,68,.3)' },
          '50%': { boxShadow: '0 0 0 1px rgba(255,23,68,.5), 0 0 34px -2px rgba(255,23,68,.55)' },
        },
        'pulse-glow-flat': {
          '0%, 100%': { boxShadow: '0 0 0 1px rgba(234,179,8,.25), 0 0 14px -4px rgba(234,179,8,.25)' },
          '50%': { boxShadow: '0 0 0 1px rgba(234,179,8,.4), 0 0 26px -2px rgba(234,179,8,.4)' },
        },
        'price-pulse-bull': {
          '0%': { textShadow: '0 0 0 rgba(57,255,20,0)' },
          '30%': { textShadow: '0 0 18px rgba(57,255,20,.95), 0 0 42px rgba(57,255,20,.55)' },
          '100%': { textShadow: '0 0 9px rgba(57,255,20,.55), 0 0 24px rgba(57,255,20,.28)' },
        },
        'price-pulse-bear': {
          '0%': { textShadow: '0 0 0 rgba(255,23,68,0)' },
          '30%': { textShadow: '0 0 18px rgba(255,23,68,.95), 0 0 42px rgba(255,23,68,.55)' },
          '100%': { textShadow: '0 0 9px rgba(255,23,68,.55), 0 0 24px rgba(255,23,68,.28)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up .35s ease-out both',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
        'pulse-glow-bull': 'pulse-glow-bull 2.6s ease-in-out infinite',
        'pulse-glow-bear': 'pulse-glow-bear 2.6s ease-in-out infinite',
        'pulse-glow-flat': 'pulse-glow-flat 2.6s ease-in-out infinite',
        'price-pulse-bull': 'price-pulse-bull 900ms ease-out',
        'price-pulse-bear': 'price-pulse-bear 900ms ease-out',
      },
    },
  },
  plugins: [],
};
