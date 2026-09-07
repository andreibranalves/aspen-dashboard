import { useState, useCallback, useEffect, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { cn } from '@/lib/utils';
import { useDarkMode } from '@/hooks/useDarkMode';
import { getHashHistoryPreviousRoute } from '@/hooks/useHashRoute';
import { routePath } from '@/app/match-route';
import { BreadcrumbLabelProvider } from './BreadcrumbLabelContext';

export interface BreadcrumbItem {
  label: string;
  hash: string | null;
}

const PAGE_LABELS: Record<string, string> = {
  '/dashboard': 'Início',
  '/quotations': 'Orçamentos',
  '/auto': 'Auto',
  '/manual': 'Novo Orçamento',
  '/sales-orders': 'Pedidos',
  '/crm': 'CRM',
  '/follow-ups': 'Follow-ups',
  '/products': 'Produtos',
  '/leads': 'Clientes',
  '/settings': 'Configurações',
  '/whatsapp-deliveries': 'Envios WhatsApp',
  '/comunicacao': 'Comunicação',
  '/404': 'Página não encontrada',
};

function getParentRoute(fallback: string): string {
  const previousRoute = getHashHistoryPreviousRoute();
  return previousRoute && routePath(previousRoute) === fallback ? previousRoute : fallback;
}

function getQuotationParent(): BreadcrumbItem {
  const previousRoute = getHashHistoryPreviousRoute();
  if (previousRoute && routePath(previousRoute) === '/follow-ups') {
    return { label: 'Follow-ups', hash: previousRoute };
  }
  if (previousRoute && routePath(previousRoute) === '/comunicacao') {
    const query = previousRoute.split('?')[1] || '';
    if (new URLSearchParams(query).get('tab') === 'history') {
      return { label: 'Histórico de envios', hash: previousRoute };
    }
  }
  return { label: 'Orçamentos', hash: getParentRoute('/quotations') };
}

function decodeLabel(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getBreadcrumb(route: string, detailLabel: string | null): BreadcrumbItem[] {
  const path = routePath(route);
  if (path === '/dashboard')
    return [
      { label: 'Início', hash: '/dashboard' },
      { label: 'Dashboard', hash: null },
    ];

  if (path.startsWith('/quotations/')) {
    return [
      { label: 'Início', hash: '/dashboard' },
      getQuotationParent(),
      { label: 'Orçamento', hash: null },
    ];
  }
  if (path.startsWith('/sales-orders/')) {
    const id = path.slice('/sales-orders/'.length);
    return [
      { label: 'Início', hash: '/dashboard' },
      { label: 'Pedidos', hash: getParentRoute('/sales-orders') },
      { label: decodeLabel(id), hash: null },
    ];
  }
  if (path.startsWith('/products/')) {
    const sku = path.slice('/products/'.length);
    return [
      { label: 'Início', hash: '/dashboard' },
      { label: 'Produtos', hash: getParentRoute('/products') },
      { label: sku === 'new' ? 'Novo produto' : decodeLabel(sku), hash: null },
    ];
  }
  if (path.startsWith('/leads/')) {
    const id = path.split('/').slice(3).join('/');
    return [
      { label: 'Início', hash: '/dashboard' },
      { label: 'Clientes', hash: getParentRoute('/leads') },
      { label: id === 'new' ? 'Novo cliente' : detailLabel || 'Detalhes do cliente', hash: null },
    ];
  }

  const label = PAGE_LABELS[path];
  if (label)
    return [
      { label: 'Início', hash: '/dashboard' },
      { label, hash: null },
    ];
  return [
    { label: 'Início', hash: '/dashboard' },
    { label: 'Página não encontrada', hash: null },
  ];
}

export interface LayoutProps {
  route: string;
  onNavigate: (hash: string) => void;
  children: ReactNode;
}

const MOBILE_MEDIA_QUERY = '(max-width: 767px)';
const COMPACT_MEDIA_QUERY = '(max-width: 1024px)';

export default function Layout({ route, onNavigate, children }: LayoutProps) {
  const { darkMode, toggleDarkMode } = useDarkMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth <= 1024;
    return false;
  });
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768
  );
  const [detailBreadcrumb, setDetailBreadcrumb] = useState<{
    route: string;
    label: string | null;
  }>({ route, label: null });

  const toggleSidebar = useCallback(() => setSidebarCollapsed((previous) => !previous), []);
  const setDetailBreadcrumbLabel = useCallback(
    (label: string | null) => setDetailBreadcrumb({ route, label }),
    [route]
  );
  const detailLabel = detailBreadcrumb.route === route ? detailBreadcrumb.label : null;

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mobileMedia = window.matchMedia(MOBILE_MEDIA_QUERY);
    const compactMedia = window.matchMedia(COMPACT_MEDIA_QUERY);
    const updateMobile = () => setIsMobile(mobileMedia.matches);
    const collapseAtCompactWidth = () => {
      if (compactMedia.matches) setSidebarCollapsed(true);
    };
    updateMobile();
    mobileMedia.addEventListener?.('change', updateMobile);
    compactMedia.addEventListener?.('change', collapseAtCompactWidth);
    return () => {
      mobileMedia.removeEventListener?.('change', updateMobile);
      compactMedia.removeEventListener?.('change', collapseAtCompactWidth);
    };
  }, []);

  useEffect(() => {
    if (isMobile) setSidebarCollapsed(true);
  }, [isMobile, route]);

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-page">
      <Sidebar
        collapsed={sidebarCollapsed}
        mobile={isMobile}
        onToggle={toggleSidebar}
        currentRoute={route}
        onNavigate={onNavigate}
      />
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col transition-[margin] duration-200',
          'md:ml-16',
          !sidebarCollapsed && 'md:ml-[216px]'
        )}
      >
        <TopBar
          route={route}
          onMenuClick={toggleSidebar}
          sidebarOpen={!sidebarCollapsed}
          isMobile={isMobile}
          breadcrumbItems={getBreadcrumb(route, detailLabel)}
          onNavigate={onNavigate}
          darkMode={darkMode}
          toggleDarkMode={toggleDarkMode}
        />
        <BreadcrumbLabelProvider setLabel={setDetailBreadcrumbLabel}>
          <main
            className="min-h-0 flex-1 overflow-auto p-4 md:p-6"
            inert={isMobile && !sidebarCollapsed ? true : undefined}
          >
            {children}
          </main>
        </BreadcrumbLabelProvider>
      </div>
    </div>
  );
}
