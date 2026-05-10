/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'], // kept for compatibility — all tokens are dark-only in :root
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Inter Variable', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // ── Framer named tokens (theme-aware via CSS variables) ──
        framer: {
          canvas: 'hsl(var(--canvas))',
          'surface-1': 'hsl(var(--surface-1))',
          'surface-2': 'hsl(var(--surface-2))',
          hairline: 'hsl(var(--hairline))',
          'hairline-soft': 'hsl(var(--hairline-soft))',
          ink: 'hsl(var(--ink))',
          'ink-muted': 'hsl(var(--ink-muted))',
          'accent-blue': 'hsl(var(--accent-blue))',
          success: 'hsl(var(--success))',
          'gradient-violet': '#6a4cf5',
          'gradient-magenta': '#d44df0',
          'gradient-orange': '#ff7a3d',
          'gradient-coral': '#ff5577',
        },

        // ── Sidebar (theme-aware Framer shell) ──
        sidebar: {
          DEFAULT: 'hsl(var(--surface-1))',
          foreground: 'hsl(var(--ink))',
          hover: 'hsl(var(--surface-2))',
          active: 'hsl(var(--hairline))',
        },
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '10px',
        lg: '15px',
        xl: '20px',
        '2xl': '30px',
        '3xl': '40px',
        pill: '100px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
