/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'Segoe UI', 'Arial', 'sans-serif'],
      },
      colors: {
        // Aspen sketch V01 visual tokens.
        canvas: 'rgb(var(--canvas))',
        sage: 'rgb(var(--sage))',
        'light-sage': 'rgb(var(--light-sage))',
        'chat-background': 'rgb(var(--chat-background))',
        orange: 'rgb(var(--orange))',
        taupe: 'rgb(var(--taupe))',
        cream: 'rgb(var(--cream))',
        rust: 'rgb(var(--rust))',
        raised: 'rgb(var(--surface-subtle))',
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
          control: 'rgb(var(--border-control))',
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
          fill: 'rgb(var(--success-fill))',
          foreground: 'rgb(var(--on-success))',
        },
        warning: {
          DEFAULT: 'rgb(var(--warning))',
          fill: 'rgb(var(--warning-fill))',
          foreground: 'rgb(var(--on-warning))',
        },
        destructive: {
          DEFAULT: 'rgb(var(--destructive))',
          fill: 'rgb(var(--destructive-fill))',
          foreground: 'rgb(var(--on-destructive))',
        },
        info: {
          DEFAULT: 'rgb(var(--info))',
          foreground: 'rgb(var(--on-primary))',
        },
        link: 'rgb(var(--link))',
        'primary-text': 'rgb(var(--primary-text))',

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
        sm: '11px',
        md: '14px',
        lg: '16px',
        card: '25px',
        shell: '31px',
        control: '11px',
        nav: '14px',
        full: '9999px',
      },
      spacing: {
        frame: '18px',
        workspace: '24px',
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
