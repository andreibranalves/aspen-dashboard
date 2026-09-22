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
        link: 'rgb(var(--link))',
        'primary-text': 'rgb(var(--primary-text))',
        // Deal status: ganho, perdido, em progresso.
        status: {
          won: 'rgb(var(--status-won))',
          lost: 'rgb(var(--status-lost))',
          progress: 'rgb(var(--status-progress))',
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
      // Escala tipográfica do design system (grid de 4px nas line-heights).
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.625rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.015em' }],
        '2xl': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.02em' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.024em' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.028em' }],
      },
      // Escala de sombras semânticas (níveis de elevação 1-5).
      // Grid de espaçamento segue o padrão Tailwind (base 4px); prefira
      // múltiplos de 2 unidades (8pt) em composições de tela.
      boxShadow: {
        'level-1': '0 1px 2px 0 rgb(16 24 40 / 0.05)',
        'level-2': '0 1px 3px 0 rgb(16 24 40 / 0.10), 0 1px 2px -1px rgb(16 24 40 / 0.06)',
        'level-3': '0 4px 8px -2px rgb(16 24 40 / 0.10), 0 2px 4px -2px rgb(16 24 40 / 0.06)',
        'level-4': '0 12px 20px -6px rgb(16 24 40 / 0.14), 0 4px 8px -4px rgb(16 24 40 / 0.05)',
        'level-5': '0 24px 40px -8px rgb(16 24 40 / 0.20), 0 8px 16px -8px rgb(16 24 40 / 0.08)',
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
