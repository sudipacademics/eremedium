import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        saffron: {
          50: '#fff8ed',
          100: '#ffefd4',
          200: '#ffdba8',
          300: '#ffc071',
          400: '#ff9d38',
          500: '#ff7f11',
          600: '#f06207',
          700: '#c74908',
          800: '#9e390f',
          900: '#7f3010',
        },
        night: {
          700: '#241b45',
          800: '#1b1435',
          900: '#130e26',
          950: '#0b0818',
        },
        // Nakshya marketing palette (homepage + shell)
        navy: {
          700: '#1a2a4a',
          800: '#12203a',
          900: '#0c1a33',
          950: '#081226',
        },
        gold: {
          300: '#e8c98a',
          400: '#d4a84b',
          500: '#c4932e',
          600: '#a67a22',
        },
        cream: {
          50: '#fdfbf7',
          100: '#f7f3ea',
          200: '#efe8d8',
        },
        sage: {
          100: '#e8f0e4',
          200: '#d4e5cc',
          500: '#6b8f5e',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '80%, 100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.24, 0, 0.38, 1) infinite',
        'fade-up': 'fade-up 0.7s ease-out both',
        float: 'float 5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
