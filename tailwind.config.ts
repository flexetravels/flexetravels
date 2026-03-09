import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand teal-green — eye-soothing, premium travel
        teal: {
          50:  '#edfaf4',
          100: '#d3f4e6',
          200: '#a9e9cf',
          300: '#6dd8b3',
          400: '#33c093',
          500: '#0fa876',
          600: '#0d8a62',  // primary action
          700: '#0a6e4f',  // primary brand (matches existing #0a6e50)
          800: '#095941',
          900: '#074a36',
          950: '#032e22',
        },
        // Warm amber-gold accent (replaces harsh red)
        amber: {
          50:  '#fff8ed',
          400: '#fbad41',
          500: '#f4911e',
          600: '#e8702a',  // accent buttons
          700: '#c55320',
        },
        // Dark mode surface stack
        navy: {
          950: '#0b0e18',  // page bg
          900: '#0f1320',  // sidebar bg
          800: '#151b2e',  // card bg
          700: '#1c2540',  // elevated card
          600: '#243050',  // hover states
          500: '#2e3d62',  // borders
          400: '#4a5878',  // muted borders
          300: '#7385a8',  // disabled text
          200: '#9baac8',  // secondary text
          100: '#c7d3e8',  // primary text (dark mode)
           50: '#e8edf8',  // headings (dark mode)
        },
        // Semantic
        border:      'hsl(var(--border))',
        input:       'hsl(var(--input))',
        ring:        'hsl(var(--ring))',
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontFamily: {
        sans:  ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono:  ['var(--font-mono)', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'typing-bounce': {
          '0%, 80%, 100%': { transform: 'translateY(0)' },
          '40%':           { transform: 'translateY(-6px)' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
        'pulse-ring': {
          '0%':   { transform: 'scale(1)',    opacity: '0.7' },
          '100%': { transform: 'scale(1.5)', opacity: '0' },
        },
        typewriter: {
          from: { width: '0' },
          to:   { width: '100%' },
        },
      },
      animation: {
        'typing-bounce':  'typing-bounce 1.4s ease-in-out infinite',
        'fade-in-up':     'fade-in-up 0.3s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        shimmer:          'shimmer 1.8s linear infinite',
        'pulse-ring':     'pulse-ring 1.5s ease-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
