/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
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
        // ── Alpine vocabulary (canonical) ──
        line: 'hsl(var(--line))',
        page: 'hsl(var(--page))',
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          muted: 'hsl(var(--surface-muted))',
        },
        shell: 'hsl(var(--shell))',
        fg: {
          DEFAULT: 'hsl(var(--fg))',
          muted: 'hsl(var(--fg-muted))',
        },
        'on-solid': 'hsl(var(--on-solid))',

        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--on-solid))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--on-solid))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--on-solid))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--on-solid))',
        },
        info: {
          DEFAULT: 'hsl(var(--primary))',          // alias → primary
          foreground: 'hsl(var(--on-solid))',
        },

        // ── Shadcn compatibility aliases (internos, não públicos) ──
        border: 'hsl(var(--line))',
        input: 'hsl(var(--line))',
        ring: 'hsl(var(--primary))',
        background: 'hsl(var(--page))',
        foreground: 'hsl(var(--fg))',
        card: {
          DEFAULT: 'hsl(var(--surface))',
          foreground: 'hsl(var(--fg))',
        },
        popover: {
          DEFAULT: 'hsl(var(--surface))',
          foreground: 'hsl(var(--fg))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--surface-muted))',
          foreground: 'hsl(var(--fg))',
        },
        muted: {
          DEFAULT: 'hsl(var(--surface-muted))',
          foreground: 'hsl(var(--fg-muted))',
        },
        accent: {
          DEFAULT: 'hsl(var(--surface-muted))',
          foreground: 'hsl(var(--fg))',
        },

        // ── Sidebar (theme-aware) ──
        sidebar: {
          DEFAULT: 'hsl(var(--shell))',
          foreground: 'hsl(var(--fg))',
          hover: 'hsl(var(--surface-muted))',
          active: 'hsl(var(--line))',
        },

        // ── Framer legacy aliases (backward compat, remove in Stage 2) ──
        framer: {
          canvas: 'hsl(var(--page))',
          'surface-1': 'hsl(var(--surface))',
          'surface-2': 'hsl(var(--surface-muted))',
          'surface-3': 'hsl(var(--surface-muted))',
          hairline: 'hsl(var(--line))',
          'hairline-soft': 'hsl(var(--line))',
          ink: 'hsl(var(--fg))',
          'ink-muted': 'hsl(var(--fg-muted))',
          'accent-blue': 'hsl(var(--primary))',
          success: 'hsl(var(--success))',
          warning: 'hsl(var(--warning))',
          'gradient-violet': '#6a4cf5',
          'gradient-magenta': '#d44df0',
          'gradient-orange': '#ff7a3d',
          'gradient-coral': '#ff5577',
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
