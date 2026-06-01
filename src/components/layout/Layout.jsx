import { useState, useCallback, useEffect, Fragment } from 'react';
import Sidebar from './Sidebar.jsx';
import { cn } from '@/lib/utils.js';
import { useDarkMode } from '@/hooks/useDarkMode.js';
import { ChevronRight } from 'lucide-react';

// ── Breadcrumb mapping ──

const PAGE_LABELS = {
  '/dashboard':    'Início',
  '/quotations':   'Orçamentos',
  '/auto':         'Auto — Extração',
  '/manual':       'Novo Orçamento',
  '/sales-orders': 'Pedidos',
  '/freight':      'Cotação de Frete',
  '/crm':          'CRM — Kanban',
  '/products':     'Catálogo de Produtos',
  '/leads':        'Leads / Clientes',
  '/settings':     'Configurações',
};

function getBreadcrumb(route) {
  // Dashboard: "Início" is both the breadcrumb start and current page
  if (route === '/dashboard') {
    return [{ label: 'Início', hash: null }];
  }

  // Detail pages — three levels: Início > Parent > ID
  if (route.startsWith('/quotations/')) {
    const id = route.split('/quotations/')[1];
    return [
      { label: 'Início', hash: '/dashboard' },
      { label: 'Orçamentos', hash: '/quotations' },
      { label: id, hash: null },
    ];
  }
  if (route.startsWith('/sales-orders/')) {
    const id = route.split('/sales-orders/')[1];
    return [
      { label: 'Início', hash: '/dashboard' },
      { label: 'Pedidos', hash: '/sales-orders' },
      { label: id, hash: null },
    ];
  }
  if (route.startsWith('/products/')) {
    const sku = route.split('/products/')[1];
    return [
      { label: 'Início', hash: '/dashboard' },
      { label: 'Catálogo de Produtos', hash: '/products' },
      { label: sku, hash: null },
    ];
  }
  if (route.startsWith('/leads/')) {
    const parts = route.split('/');
    const id = parts.slice(3).join('/');
    return [
      { label: 'Início', hash: '/dashboard' },
      { label: 'Leads / Clientes', hash: '/leads' },
      { label: id, hash: null },
    ];
  }

  // Standard pages — two levels: Início > Page
  const label = PAGE_LABELS[route];
  if (label) {
    return [
      { label: 'Início', hash: '/dashboard' },
      { label, hash: null },
    ];
  }

  // Fallback (unknown route)
  return [{ label: 'Início', hash: '/dashboard' }, { label: route, hash: null }];
}

// ── Breadcrumb component ──

function Breadcrumb({ items, onNavigate }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm pt-1 pb-4">
      {items.map((item, i) => (
        <Fragment key={`${item.label}-${i}`}>
          {i > 0 && <ChevronRight size={14} className="text-framer-ink-muted shrink-0" />}
          {item.hash ? (
            <button
              type="button"
              onClick={() => onNavigate(item.hash)}
              className="text-framer-ink-muted hover:text-framer-ink transition-colors"
            >
              {item.label}
            </button>
          ) : (
            <span className="text-framer-ink font-medium">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

// ── Layout ──

/**
 * Layout — Framer dark shell.
 * Canvas background, responsive sidebar with Framer surface-1 styling.
 * Breadcrumb replaces the old TopBar header on every page.
 */
export default function Layout({ route, onNavigate, children }) {
  const { darkMode, toggleDarkMode } = useDarkMode();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 1024;
    }
    return false;
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  // Auto-collapse on mobile after navigation
  useEffect(() => {
    if (window.innerWidth < 1024) {
      setSidebarCollapsed(true);
    }
  }, [route]);

  const breadcrumbItems = getBreadcrumb(route);

  return (
    <div className="h-screen flex overflow-hidden bg-framer-canvas">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        currentRoute={route}
        onNavigate={onNavigate}
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
      />

      {/* Main content area */}
      <div
        className={cn(
          'flex-1 flex flex-col min-w-0 transition-all duration-300',
          'ml-0 lg:ml-16', // mobile: 0, desktop collapsed: 4rem
          !sidebarCollapsed && 'lg:ml-64', // desktop open: 16rem
        )}
      >
        <main className="flex-1 overflow-auto pt-2 pb-4 px-4 md:pt-3 md:pb-6 md:px-6">
          <Breadcrumb items={breadcrumbItems} onNavigate={onNavigate} />
          {children}
        </main>
      </div>
    </div>
  );
}
