/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Inter Variable', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // Canonical Aspen semantic tokens.
        page: 'rgb(var(--page))',
        surface: {
          DEFAULT: 'rgb(var(--surface))',
          subtle: 'rgb(var(--surface-subtle))',
          hover: 'rgb(var(--surface-hover))',
          selected: 'rgb(var(--surface-selected))',
          muted: 'rgb(var(--surface-muted))',
        },
        border: {
          DEFAULT: 'rgb(var(--border-default))',
          subtle: 'rgb(var(--border-subtle))',
          strong: 'rgb(var(--border-strong))',
        },
        text: {
          primary: 'rgb(var(--text-primary))',
          secondary: 'rgb(var(--text-secondary))',
          tertiary: 'rgb(var(--text-tertiary))',
          disabled: 'rgb(var(--text-disabled))',
        },
        primary: {
          DEFAULT: 'rgb(var(--primary))',
          foreground: 'rgb(var(--on-primary))',
        },
        success: {
          DEFAULT: 'rgb(var(--success))',
          foreground: 'rgb(var(--on-primary))',
        },
        warning: {
          DEFAULT: 'rgb(var(--warning))',
          foreground: 'rgb(var(--on-primary))',
        },
        destructive: {
          DEFAULT: 'rgb(var(--destructive))',
          foreground: 'rgb(var(--on-primary))',
        },
        info: {
          DEFAULT: 'rgb(var(--info))',
          foreground: 'rgb(var(--on-primary))',
        },

        // Compatibility aliases retained while consumers migrate.
        line: 'rgb(var(--line))',
        shell: {
          DEFAULT: 'rgb(var(--shell))',
          border: 'rgb(var(--shell-border))',
          text: 'rgb(var(--shell-text))',
          muted: 'rgb(var(--shell-muted))',
          hover: 'rgb(var(--shell-hover))',
          active: 'rgb(var(--shell-active))',
          primary: 'rgb(var(--shell-primary))',
        },
        fg: {
          DEFAULT: 'rgb(var(--fg))',
          muted: 'rgb(var(--fg-muted))',
        },
        'on-solid': 'rgb(var(--on-solid))',

        // shadcn-compatible names for primitives that use the standard API.
        input: 'rgb(var(--border-default))',
        ring: 'rgb(var(--primary))',
        background: 'rgb(var(--page))',
        foreground: 'rgb(var(--text-primary))',
        card: {
          DEFAULT: 'rgb(var(--surface))',
          foreground: 'rgb(var(--text-primary))',
        },
        popover: {
          DEFAULT: 'rgb(var(--surface))',
          foreground: 'rgb(var(--text-primary))',
        },
        secondary: {
          DEFAULT: 'rgb(var(--surface-subtle))',
          foreground: 'rgb(var(--text-primary))',
        },
        muted: {
          DEFAULT: 'rgb(var(--surface-subtle))',
          foreground: 'rgb(var(--text-secondary))',
        },
        accent: {
          DEFAULT: 'rgb(var(--surface-hover))',
          foreground: 'rgb(var(--text-primary))',
        },
        sidebar: {
          DEFAULT: 'rgb(var(--shell))',
          foreground: 'rgb(var(--text-primary))',
          hover: 'rgb(var(--surface-hover))',
          active: 'rgb(var(--surface-selected))',
        },
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        full: '9999px',
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
