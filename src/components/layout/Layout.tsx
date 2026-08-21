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
import { getHashHistoryPreviousRoute } from '@/hooks/useHashRoute';
import { routePath } from '@/app/match-route';

export type SetTopBarActions = Dispatch<SetStateAction<ReactNode | null>>;

export const SetTopBarActionsCtx = createContext<SetTopBarActions | null>(null);

export function useSetTopBarActions(): SetTopBarActions | null {
  return useContext(SetTopBarActionsCtx);
}

export interface BreadcrumbItem {
  label: string;
  hash: string | null;
}

const PAGE_LABELS: Record<string, string> = {
  '/dashboard': 'Início',
  '/quotations': 'Orçamentos',
  '/auto': 'Auto — Extração',
  '/manual': 'Novo Orçamento',
  '/sales-orders': 'Pedidos',
  '/crm': 'CRM — Kanban',
  '/products': 'Catálogo de Produtos',
  '/leads': 'Clientes',
  '/settings': 'Configurações',
  '/whatsapp-deliveries': 'Envios WhatsApp',
};

function getParentRoute(fallback: string): string {
  const previousRoute = getHashHistoryPreviousRoute();
  return previousRoute && routePath(previousRoute) === fallback ? previousRoute : fallback;
}

function getBreadcrumb(route: string): BreadcrumbItem[] {
  const path = routePath(route);
  if (path === '/dashboard') return [{ label: 'Início', hash: null }];

  if (path.startsWith('/quotations/')) {
    const id = path.split('/quotations/')[1];
    return [
      { label: 'Início', hash: '/dashboard' },
      { label: 'Orçamentos', hash: getParentRoute('/quotations') },
      { label: id, hash: null },
    ];
  }
  if (path.startsWith('/sales-orders/')) {
    const id = path.split('/sales-orders/')[1];
    return [
      { label: 'Início', hash: '/dashboard' },
      { label: 'Pedidos', hash: getParentRoute('/sales-orders') },
      { label: id, hash: null },
    ];
  }
  if (path.startsWith('/products/')) {
    const sku = path.split('/products/')[1];
    return [
      { label: 'Início', hash: '/dashboard' },
      { label: 'Catálogo de Produtos', hash: getParentRoute('/products') },
      { label: sku, hash: null },
    ];
  }
  if (path.startsWith('/leads/')) {
    const id = path.split('/').slice(3).join('/');
    return [
      { label: 'Início', hash: '/dashboard' },
      { label: 'Clientes', hash: getParentRoute('/leads') },
      { label: id, hash: null },
    ];
  }

  const label = PAGE_LABELS[path];
  if (label) return [{ label: 'Início', hash: '/dashboard' }, { label, hash: null }];
  return [{ label: 'Início', hash: '/dashboard' }, { label: path, hash: null }];
}

export interface LayoutProps {
  route: string;
  onNavigate: (hash: string) => void;
  children: ReactNode;
}

export default function Layout({ route, onNavigate, children }: LayoutProps) {
  const { darkMode, toggleDarkMode } = useDarkMode();
  const [topBarActions, setTopBarActions] = useState<ReactNode | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth < 1024;
    return false;
  });

  const toggleSidebar = useCallback(() => setSidebarCollapsed((previous) => !previous), []);

  useEffect(() => {
    if (window.innerWidth < 1024) setSidebarCollapsed(true);
  }, [route]);

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
          !sidebarCollapsed && 'lg:ml-64',
        )}
      >
        <TopBar
          route={route}
          onMenuClick={toggleSidebar}
          breadcrumbItems={getBreadcrumb(route)}
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
