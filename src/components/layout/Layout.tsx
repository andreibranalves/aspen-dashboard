import { useState, useCallback, useEffect, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { getHashHistoryPreviousRoute } from '@/hooks/useHashRoute';
import { routePath } from '@/app/match-route';
import { BreadcrumbLabelProvider } from './BreadcrumbLabelContext';

export interface BreadcrumbItem {
  label: string;
  hash: string | null;
}

const PAGE_LABELS: Record<string, string> = {
  '/dashboard': 'Resultados',
  '/quotations': 'Orçamentos',
  '/novo-orcamento': 'Novo orçamento',
  '/auto': 'Auto',
  '/manual': 'Novo Orçamento',
  '/sales-orders': 'Pedidos',
  '/crm': 'Comercial',
  '/products': 'Produtos',
  '/catalog': 'Catálogo',
  '/leads': 'Clientes',
  '/settings': 'Configurações',
  '/whatsapp-deliveries': 'Envios',
  '/comunicacao': 'Comunicação',
  '/404': 'Página não encontrada',
};

function getParentRoute(fallback: string): string {
  const previousRoute = getHashHistoryPreviousRoute();
  return previousRoute && routePath(previousRoute) === fallback ? previousRoute : fallback;
}

function getQuotationParent(): BreadcrumbItem {
  const previousRoute = getHashHistoryPreviousRoute();
  if (previousRoute && routePath(previousRoute) === '/crm') {
    return { label: 'Comercial', hash: previousRoute };
  }
  if (previousRoute && routePath(previousRoute) === '/whatsapp-deliveries') {
    return { label: 'Envios', hash: previousRoute };
  }
  if (previousRoute && routePath(previousRoute) === '/comunicacao') {
    const query = previousRoute.split('?')[1] || '';
    if (new URLSearchParams(query).get('tab') === 'history') {
      return { label: 'Histórico de envios', hash: previousRoute };
    }
  }
  return { label: 'Orçamentos', hash: getParentRoute('/quotations') };
}

function getProductParent(): BreadcrumbItem {
  const previousRoute = getHashHistoryPreviousRoute();
  if (previousRoute && routePath(previousRoute) === '/catalog') {
    return { label: 'Catálogo', hash: previousRoute };
  }
  return { label: 'Catálogo', hash: '/catalog' };
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
      { label: 'Resultados', hash: null },
    ];

  if (path.startsWith('/quotations/')) {
    return [
      { label: 'Início', hash: '/dashboard' },
      getQuotationParent(),
      { label: detailLabel || 'Orçamento', hash: null },
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
      getProductParent(),
      { label: sku === 'new' ? 'Novo produto' : decodeLabel(sku), hash: null },
    ];
  }
  if (path.startsWith('/leads/')) {
    const id = path === '/leads/new' ? 'new' : path.split('/').slice(3).join('/');
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
export default function Layout({ route, onNavigate, children }: LayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth < 768;
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
  const breadcrumbItems = getBreadcrumb(route, detailLabel);
  const isDetailRoute = breadcrumbItems.length > 2;

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mobileMedia = window.matchMedia(MOBILE_MEDIA_QUERY);
    const updateMobile = () => setIsMobile(mobileMedia.matches);
    updateMobile();
    mobileMedia.addEventListener?.('change', updateMobile);
    return () => {
      mobileMedia.removeEventListener?.('change', updateMobile);
    };
  }, []);

  useEffect(() => {
    setSidebarCollapsed(isMobile);
  }, [isMobile]);

  useEffect(() => {
    if (isMobile) setSidebarCollapsed(true);
  }, [isMobile, route]);

  return (
    <div className="flex h-dvh min-h-0 gap-frame overflow-hidden bg-canvas md:p-frame">
      <Sidebar
        collapsed={sidebarCollapsed}
        mobile={isMobile}
        onToggle={toggleSidebar}
        currentRoute={route}
        onNavigate={onNavigate}
      />
      <div className="aspen-workspace min-h-0 min-w-0 flex-1 overflow-y-auto bg-page p-4 text-fg md:rounded-shell md:p-workspace">
        <div key={routePath(route)} className="relative min-h-full motion-safe:animate-page-enter">
          <TopBar
            route={route}
            onMenuClick={toggleSidebar}
            sidebarOpen={!sidebarCollapsed}
            isMobile={isMobile}
            breadcrumbItems={breadcrumbItems}
            onNavigate={onNavigate}
          />
          <BreadcrumbLabelProvider setLabel={setDetailBreadcrumbLabel}>
            <main
              className={isDetailRoute ? 'xl:pt-5' : undefined}
              inert={isMobile && !sidebarCollapsed ? true : undefined}
            >
              {children}
            </main>
          </BreadcrumbLabelProvider>
        </div>
      </div>
    </div>
  );
}
