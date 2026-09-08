import { lazy, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Columns3,
  FileText,
  MessageSquare,
  Package,
  Radio,
  Settings,
  Send,
  ShoppingCart,
  Users,
} from 'lucide-react';
import { matchSegments, prefix } from '@/app/match-route';
import LoginPage from '@/app/LoginPage';
import NotFoundPage from '@/components/shared/NotFoundPage';
import type { SetHashRouteGuard } from '@/hooks/useHashRoute';

const DashboardPage = lazy(() => import('@/features/dashboard/pages/DashboardPage'));
const QuotationsPage = lazy(() => import('@/features/quotations/pages/QuotationsPage'));
const QuotationDetailPage = lazy(() => import('@/features/quotations/pages/QuotationDetailPage'));
const SalesOrdersPage = lazy(() => import('@/features/sales-orders/pages/SalesOrdersPage'));
const SalesOrderDetailPage = lazy(() => import('@/features/sales-orders/pages/SalesOrderDetailPage'));
const CrmKanbanPage = lazy(() => import('@/features/crm/pages/CrmKanbanPage'));
const CatalogPage = lazy(() => import('@/features/products/pages/CatalogPage'));
const ProductDetailPage = lazy(() => import('@/features/products/pages/ProductDetailPage'));
const LeadsPage = lazy(() => import('@/features/customers/pages/LeadsPage'));
const LeadDetailPage = lazy(() => import('@/features/customers/pages/LeadDetailPage'));
const SettingsPage = lazy(() => import('@/features/settings/pages/SettingsPage'));
const ComunicacaoPage = lazy(() => import('@/features/communication/pages/ComunicacaoPage'));
const WhatsAppDeliveriesPage = lazy(() => import('@/features/quotations/pages/WhatsAppDeliveriesPage'));
const FollowUpsPage = lazy(() => import('@/features/follow-ups/pages/FollowUpsPage'));
const NewQuotationPage = lazy(() => import('@/features/quotations/pages/NewQuotationPage'));

export interface RouteContext {
  navigate: (hash: string) => void;
  params: Record<string, string>;
  setNavigationGuard: SetHashRouteGuard;
}

export interface AppRoute {
  path: string;
  match?: (route: string) => Record<string, string> | null;
  render: (ctx: RouteContext) => ReactNode;
  /** Envolve o conteúdo em Suspense/PageLoader (default: false). */
  suspense?: boolean;
  /** Renderiza dentro do Layout shell (default: true). */
  layout?: boolean;
  nav?: { label: string; icon: LucideIcon; section: string };
}

export const routes: AppRoute[] = [
  {
    path: '/login',
    layout: false,
    render: ({ navigate }) => <LoginPage navigate={navigate} />,
  },
  {
    path: '/quotations/:id',
    match: prefix('/quotations/'),
    suspense: true,
    render: ({ navigate, params }) => <QuotationDetailPage key={params.id} id={params.id} navigate={navigate} />,
  },
  {
    path: '/sales-orders/:id',
    match: prefix('/sales-orders/'),
    suspense: true,
    render: ({ navigate, params }) => <SalesOrderDetailPage key={params.id} id={params.id} navigate={navigate} />,
  },
  {
    path: '/products/:sku',
    match: prefix('/products/'),
    suspense: true,
    render: ({ navigate, params }) => <ProductDetailPage key={params.id} sku={params.id} navigate={navigate} />,
  },
  {
    path: '/leads/:tipo/:id',
    match: (route) => {
      const params = matchSegments('/leads/:tipo/:id*', route);
      return params && params.tipo && params.id ? params : null;
    },
    suspense: true,
    render: ({ navigate, params }) => <LeadDetailPage key={`${params.tipo}:${params.id}`} tipo={params.tipo} id={params.id} navigate={navigate} />,
  },
  {
    path: '/novo-orcamento',
    suspense: true,
    render: () => <NewQuotationPage initialMode="conversation" />,
    nav: { label: 'Novo orçamento', icon: FileText, section: 'Operacional' },
  },
  {
    path: '/auto',
    suspense: true,
    render: () => <NewQuotationPage initialMode="conversation" />,
  },
  {
    path: '/whatsapp-deliveries',
    suspense: true,
    render: () => <WhatsAppDeliveriesPage />,
    nav: { label: 'Envios WhatsApp', icon: Send, section: 'Operacional' },
  },
  {
    path: '/dashboard',
    suspense: true,
    render: ({ navigate }) => <DashboardPage navigate={navigate} />,
    nav: { label: 'Dashboard', icon: BarChart3, section: 'Operacional' },
  },
  {
    path: '/sales-orders',
    suspense: true,
    render: ({ navigate }) => <SalesOrdersPage navigate={navigate} />,
    nav: { label: 'Pedidos', icon: ShoppingCart, section: 'Operacional' },
  },
  {
    path: '/crm',
    suspense: true,
    render: () => <CrmKanbanPage />,
    nav: { label: 'CRM', icon: Columns3, section: 'Operacional' },
  },
  {
    path: '/follow-ups',
    suspense: true,
    render: ({ navigate }) => <FollowUpsPage navigate={navigate} />,
    nav: { label: 'Follow-ups', icon: MessageSquare, section: 'Operacional' },
  },
  {
    path: '/quotations',
    suspense: true,
    render: ({ navigate }) => <QuotationsPage navigate={navigate} />,
    nav: { label: 'Orçamentos', icon: FileText, section: 'Operacional' },
  },
  {
    path: '/catalog',
    suspense: true,
    render: () => <CatalogPage />,
    nav: { label: 'Catálogo', icon: Package, section: 'Cadastros' },
  },
  {
    path: '/products',
    suspense: true,
    render: () => <CatalogPage legacy />,
  },
  {
    path: '/leads',
    suspense: true,
    render: ({ navigate }) => <LeadsPage navigate={navigate} />,
    nav: { label: 'Clientes', icon: Users, section: 'Operacional' },
  },
  {
    path: '/comunicacao',
    suspense: true,
    render: ({ navigate }) => <ComunicacaoPage navigate={navigate} />,
    nav: { label: 'Comunicação', icon: Radio, section: 'Outros' },
  },
  {
    path: '/settings',
    suspense: true,
    render: () => <SettingsPage />,
    nav: { label: 'Configurações', icon: Settings, section: 'Outros' },
  },
  {
    path: '/manual',
    suspense: true,
    render: () => <NewQuotationPage initialMode="manual" />,
  },
  {
    path: '/404',
    render: ({ navigate }) => <NotFoundPage navigate={navigate} />,
  },
];
