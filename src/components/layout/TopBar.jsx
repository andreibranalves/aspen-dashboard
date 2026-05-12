const PAGE_TITLES = {
  '/quotations': 'Orçamentos',
  '/auto':       'Auto — Extração',
  '/manual':     'Novo Orçamento',
  '/freight':    'Cotação de Frete',
  '/crm':        'CRM — Kanban',
  '/products':   'Catálogo de Produtos',
  '/leads':      'Leads / Clientes',
  '/settings':   'Configurações',
};

import { Menu, Moon, Sun } from 'lucide-react';

/**
 * TopBar — Framer-inspired top navigation bar with light/dark toggle.
 */
export default function TopBar({ route, onMenuClick, darkMode, toggleDarkMode }) {
  const title = PAGE_TITLES[route] || 'Aspen Orçamento';

  return (
    <header className="flex items-center justify-between px-4 md:px-6 shrink-0 border-b border-framer-hairline bg-framer-canvas" style={{ height: '4rem' }}>
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="p-1.5 rounded-md hover:bg-framer-surface-2 transition-colors lg:hidden"
          aria-label="Abrir menu"
        >
          <Menu size={20} className="text-framer-ink" />
        </button>
        <h1 className="text-lg font-semibold text-framer-ink tracking-[-0.8px]">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-framer-ink-muted hidden sm:inline">Aspen Estamparia</span>
        <button
          type="button"
          onClick={toggleDarkMode}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-framer-hairline bg-framer-surface-1 px-3 text-xs font-medium text-framer-ink transition-colors hover:bg-framer-surface-2 focus-visible:ring-2 focus-visible:ring-framer-accent-blue/40"
          aria-label={darkMode ? 'Ativar modo claro' : 'Ativar modo escuro'}
          title={darkMode ? 'Modo claro' : 'Modo escuro'}
        >
          {darkMode ? <Sun size={15} /> : <Moon size={15} />}
          <span className="hidden sm:inline">{darkMode ? 'Claro' : 'Escuro'}</span>
        </button>
      </div>
    </header>
  );
}
