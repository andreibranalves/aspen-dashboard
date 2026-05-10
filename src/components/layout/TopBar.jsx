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

import { Menu } from 'lucide-react';

/**
 * TopBar — Framer dark top navigation bar.
 * canvas background, hairline bottom border, no light-mode toggle.
 */
export default function TopBar({ route, onMenuClick }) {
  const title = PAGE_TITLES[route] || 'Aspen Orçamento';

  return (
    <header className="h-14 border-b border-[hsl(var(--hairline))] bg-framer-canvas flex items-center justify-between px-4 md:px-6 shrink-0">
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
      </div>
    </header>
  );
}
