const PAGE_TITLES = {
  '/quotations': 'Orçamentos',
  '/auto':       'Auto — Extração',
  '/freight':    'Cotação de Frete',
  '/crm':        'CRM — Kanban',
  '/products':   'Catálogo de Produtos',
  '/leads':      'Leads / Clientes',
  '/settings':   'Configurações',
};

export default function TopBar({ route }) {
  const title = PAGE_TITLES[route] || 'Aspen Orçamento';

  return (
    <header className="h-14 border-b bg-white flex items-center justify-between px-6 shrink-0">
      <h1 className="text-lg font-semibold text-gray-800">{title}</h1>
      <div className="flex items-center gap-3">
        {/* Placeholder para ações futuras (ex: botão de sincronizar) */}
        <span className="text-xs text-muted-foreground">Aspen Estamparia</span>
      </div>
    </header>
  );
}
