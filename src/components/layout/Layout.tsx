import {
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { cn } from '@/lib/utils';
import { useDarkMode } from '@/hooks/useDarkMode';

// ── TopBar actions context ──
// Pages call useSetTopBarActions(jsx) to set action buttons in the TopBar.
// Pass null to clear (e.g. on unmount).

export type SetTopBarActions = Dispatch<SetStateAction<ReactNode | null>>;

export const SetTopBarActionsCtx = createContext<SetTopBarActions | null>(null);

export function useSetTopBarActions(): SetTopBarActions | null {
  return useContext(SetTopBarActionsCtx);
}

export interface BreadcrumbItem {
  label: string;
  hash: string | null;
}

// ── Breadcrumb mapping ──

const PAGE_LABELS: Record<string, string> = {
  '/dashboard': 'Início',
  '/pre-orcamentos': 'Pré-orçamentos',
  '/quotations': 'Orçamentos',
  '/auto': 'Auto — Extração',
  '/manual': 'Novo Orçamento',
  '/sales-orders': 'Pedidos',
  '/crm': 'CRM — Kanban',
  '/products': 'Catálogo de Produtos',
  '/leads': 'Leads / Clientes',
  '/settings': 'Configurações',
};

function getBreadcrumb(route: string): BreadcrumbItem[] {
  if (route === '/dashboard') {
    return [{ label: 'Início', hash: null }];
  }

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

  const label = PAGE_LABELS[route];
  if (label) {
    return [
      { label: 'Início', hash: '/dashboard' },
      { label, hash: null },
    ];
  }

  return [
    { label: 'Início', hash: '/dashboard' },
    { label: route, hash: null },
  ];
}

// ── Layout ──

export interface LayoutProps {
  route: string;
  onNavigate: (hash: string) => void;
  children: ReactNode;
}

export default function Layout({ route, onNavigate, children }: LayoutProps) {
  const { darkMode, toggleDarkMode } = useDarkMode();
  const [topBarActions, setTopBarActions] = useState<ReactNode | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 1024;
    }
    return false;
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  useEffect(() => {
    if (window.innerWidth < 1024) {
      setSidebarCollapsed(true);
    }
  }, [route]);

  const breadcrumbItems = getBreadcrumb(route);

  return (
    <div className="h-screen flex overflow-hidden bg-page">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        currentRoute={route}
        onNavigate={onNavigate}
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
      />

      <div
        className={cn(
          'flex-1 flex flex-col min-w-0 transition-all duration-300',
          'ml-0 lg:ml-16',
          !sidebarCollapsed && 'lg:ml-64'
        )}
      >
        <TopBar
          route={route}
          onMenuClick={toggleSidebar}
          breadcrumbItems={breadcrumbItems}
          onNavigate={onNavigate}
          actions={topBarActions}
        />
        <SetTopBarActionsCtx.Provider value={setTopBarActions}>
          <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
        </SetTopBarActionsCtx.Provider>
      </div>
    </div>
  );
}
