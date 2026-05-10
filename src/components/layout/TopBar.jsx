const PAGE_TITLES = {
  '/quotations': 'Orçamentos',
  '/auto':       'Auto — Extração',
  '/freight':    'Cotação de Frete',
  '/crm':        'CRM — Kanban',
  '/products':   'Catálogo de Produtos',
  '/leads':      'Leads / Clientes',
  '/settings':   'Configurações',
};

import { Menu, Sun, Moon } from 'lucide-react';

export default function TopBar({ route, onMenuClick, darkMode, onToggleDarkMode }) {
  const title = PAGE_TITLES[route] || 'Aspen Orçamento';

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="p-1.5 rounded-md hover:bg-muted transition-colors lg:hidden"
          aria-label="Abrir menu"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleDarkMode}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
          aria-label={darkMode ? 'Modo claro' : 'Modo escuro'}
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <span className="text-xs text-muted-foreground hidden sm:inline">Aspen Estamparia</span>
      </div>
    </header>
  );
}
