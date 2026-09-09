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
        bull: '#22c55e',
        bear: '#ef4444',
        flat: '#eab308',
        info: '#38bdf8',
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
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.35), 0 1px 1px rgba(0,0,0,.25)',
        elevated: '0 16px 40px -12px rgba(0,0,0,.6)',
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
      },
      animation: {
        'fade-in-up': 'fade-in-up .35s ease-out both',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
