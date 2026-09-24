import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Vedsutra brand system
        'ved-green': {
          50: '#eef7f4',
          100: '#d5ebe3',
          200: '#aed7c8',
          300: '#7cbcab',
          400: '#4f9e8b',
          500: '#0d5c4d',
          600: '#0b4f45',
          700: '#093f37',
          800: '#07332c',
          900: '#052821',
          950: '#031814',
        },
        'ved-gold': {
          50: '#fbf6ea',
          100: '#f5ebcf',
          200: '#ead7a0',
          300: '#dcc06c',
          400: '#c9a64a',
          500: '#b08a32',
          600: '#8f6e28',
          700: '#6f5520',
          800: '#57431c',
          900: '#46381a',
        },
        'ved-cream': {
          50: '#fffcf7',
          100: '#f7f4ee',
          200: '#efe9de',
          300: '#e2d8c6',
        },
        // Legacy aliases kept so older class names don't break while pages migrate
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
          50: '#fffcf7',
          100: '#f7f4ee',
          200: '#efe9de',
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
        flicker: {
          '0%, 100%': { opacity: '0.9', transform: 'scale(1)' },
          '25%': { opacity: '0.8', transform: 'scale(0.95)' },
          '50%': { opacity: '1', transform: 'scale(1.1)' },
          '75%': { opacity: '1', transform: 'scale(1.05)' },
        },
        swing: {
          '0%': { transform: 'rotate(6deg)' },
          '100%': { transform: 'rotate(-6deg)' },
        },
        fall: {
          '0%': { transform: 'translateY(-10vh) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(110vh) rotate(360deg)', opacity: '0' },
        },
      },
      animation: {
        'spin-slow': 'spin 40s linear infinite',
        flicker: 'flicker 1.5s ease-in-out infinite alternate',
        swing: 'swing 3s ease-in-out infinite alternate',
        fall: 'fall linear forwards',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.24, 0, 0.38, 1) infinite',
        'fade-up': 'fade-up 0.7s ease-out both',
        float: 'float 5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
