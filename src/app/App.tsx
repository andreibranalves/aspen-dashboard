import { Suspense, lazy, type ReactNode } from 'react';
import { useHashRoute } from '@/hooks/useHashRoute';
import Layout from '@/components/layout/Layout';
import PageLoader from '@/components/shared/PageLoader';

import AutoQuotePage from '@/features/quotations/pages/AutoQuotePage';
import LoginPage from '@/app/LoginPage';

const DashboardPage = lazy(() => import('@/features/dashboard/pages/DashboardPage'));
const QuotationsPage = lazy(() => import('@/features/quotations/pages/QuotationsPage'));
const QuotationDetailPage = lazy(() => import('@/features/quotations/pages/QuotationDetailPage'));
const SalesOrdersPage = lazy(() => import('@/features/sales-orders/pages/SalesOrdersPage'));
const SalesOrderDetailPage = lazy(() => import('@/features/sales-orders/pages/SalesOrderDetailPage'));
const CrmKanbanPage = lazy(() => import('@/features/crm/pages/CrmKanbanPage'));
const ProductsPage = lazy(() => import('@/features/products/pages/ProductsPage'));
const ProductDetailPage = lazy(() => import('@/features/products/pages/ProductDetailPage'));
const LeadsPage = lazy(() => import('@/features/customers/pages/LeadsPage'));
const LeadDetailPage = lazy(() => import('@/features/customers/pages/LeadDetailPage'));
const SettingsPage = lazy(() => import('@/features/settings/pages/SettingsPage'));
const ManualOrcamentoPage = lazy(() => import('@/features/quotations/pages/ManualOrcamentoPage'));
const ComunicacaoPage = lazy(() => import('@/features/communication/pages/ComunicacaoPage'));
const WhatsAppInboxPage = lazy(() => import('@/features/whatsapp/pages/WhatsAppInboxPage'));

function renderPage(route: string, navigate: (hash: string) => void) {
  if (route === '/login') return <LoginPage navigate={navigate} />;

  if (route.startsWith('/quotations/')) {
    const id = route.split('/quotations/')[1];
    return (
      <Suspense fallback={<PageLoader />}>
        <QuotationDetailPage id={id} navigate={navigate} />
      </Suspense>
    );
  }

  if (route.startsWith('/sales-orders/')) {
    const id = route.split('/sales-orders/')[1];
    return (
      <Suspense fallback={<PageLoader />}>
        <SalesOrderDetailPage id={id} navigate={navigate} />
      </Suspense>
    );
  }

  if (route.startsWith('/products/')) {
    const sku = route.split('/products/')[1];
    return (
      <Suspense fallback={<PageLoader />}>
        <ProductDetailPage key={sku} sku={sku} navigate={navigate} />
      </Suspense>
    );
  }

  if (route.startsWith('/leads/')) {
    const parts = route.split('/');
    const tipo = parts[2];
    const id = parts.slice(3).join('/');
    if (tipo && id) {
      return (
        <Suspense fallback={<PageLoader />}>
          <LeadDetailPage tipo={tipo} id={id} navigate={navigate} />
        </Suspense>
      );
    }
  }

  let page: ReactNode;
  switch (route) {
    case '/dashboard':
      page = <DashboardPage navigate={navigate} />;
      break;
    case '/quotations':
      page = <QuotationsPage navigate={navigate} />;
      break;
    case '/auto':
      page = <AutoQuotePage />;
      break;
    case '/sales-orders':
      page = <SalesOrdersPage navigate={navigate} />;
      break;
    case '/crm':
      page = <CrmKanbanPage />;
      break;
    case '/products':
      page = <ProductsPage />;
      break;
    case '/leads':
      page = <LeadsPage navigate={navigate} />;
      break;
    case '/settings':
      page = <SettingsPage />;
      break;
    case '/manual':
      page = <ManualOrcamentoPage />;
      break;
    case '/comunicacao':
      page = <ComunicacaoPage />;
      break;
    case '/whatsapp-inbox':
      page = <WhatsAppInboxPage navigate={navigate} />;
      break;
    default:
      page = <AutoQuotePage />;
  }

  if (route === '/auto' || route === '' || route === '/') return page;
  return <Suspense fallback={<PageLoader />}>{page}</Suspense>;
}

export default function App() {
  const [route, navigate] = useHashRoute();

  if (route === '/login') return <LoginPage navigate={navigate} />;

  return (
    <Layout route={route} onNavigate={navigate}>
      {renderPage(route, navigate)}
    </Layout>
  );
}
