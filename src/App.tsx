import { Suspense, lazy, type ReactNode } from 'react';
import { useHashRoute } from '@/hooks/useHashRoute';
import Layout from '@/components/layout/Layout';
import PageLoader from '@/components/PageLoader';

// Eager pages — rota padrão e tela de login (críticas, pequenas)
import AutoQuotePage from '@/pages/AutoQuotePage';
import LoginPage from '@/pages/LoginPage';

// Lazy pages — carregadas sob demanda ao navegar
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const PreQuotesPage = lazy(() => import('@/pages/PreQuotesPage'));
const QuotationsPage = lazy(() => import('@/pages/QuotationsPage'));
const QuotationDetailPage = lazy(() => import('@/pages/QuotationDetailPage'));
const SalesOrdersPage = lazy(() => import('@/pages/SalesOrdersPage'));
const SalesOrderDetailPage = lazy(() => import('@/pages/SalesOrderDetailPage'));
const CrmKanbanPage = lazy(() => import('@/pages/CrmKanbanPage'));
const ProductsPage = lazy(() => import('@/pages/ProductsPage'));
const ProductDetailPage = lazy(() => import('@/pages/ProductDetailPage'));
const LeadsPage = lazy(() => import('@/pages/LeadsPage'));
const LeadDetailPage = lazy(() => import('@/pages/LeadDetailPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const ManualOrcamentoPage = lazy(() => import('@/pages/ManualOrcamentoPage'));
const ComunicacaoPage = lazy(() => import('@/pages/ComunicacaoPage'));
const WhatsAppInboxPage = lazy(() => import('@/pages/WhatsAppInboxPage'));

function renderPage(route: string, navigate: (hash: string) => void) {
  // Login page — full screen, no layout
  if (route === '/login') return <LoginPage navigate={navigate} />;

  // Detail page: #/quotations/ORC-20261143
  if (route.startsWith('/quotations/')) {
    const id = route.split('/quotations/')[1];
    return (
      <Suspense fallback={<PageLoader />}>
        <QuotationDetailPage id={id} navigate={navigate} />
      </Suspense>
    );
  }

  // Detail page: #/sales-orders/VP-20261143
  if (route.startsWith('/sales-orders/')) {
    const id = route.split('/sales-orders/')[1];
    return (
      <Suspense fallback={<PageLoader />}>
        <SalesOrderDetailPage id={id} navigate={navigate} />
      </Suspense>
    );
  }

  // Product detail page: #/products/LNC-SED-70
  if (route.startsWith('/products/')) {
    const sku = route.split('/products/')[1];
    return (
      <Suspense fallback={<PageLoader />}>
        <ProductDetailPage sku={sku} navigate={navigate} />
      </Suspense>
    );
  }

  // Lead/Customer detail page: #/leads/lead/CRM-LEAD-... or #/leads/cliente/CUST-...
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
    case '/pre-orcamentos':
      page = <PreQuotesPage navigate={navigate} />;
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

  // AutoQuotePage is eager; wrap lazy pages (all switch cases except auto/default)
  if (route === '/auto' || route === '' || route === '/') {
    return page;
  }

  return <Suspense fallback={<PageLoader />}>{page}</Suspense>;
}

export default function App() {
  const [route, navigate] = useHashRoute();

  // Login page — full screen, no sidebar
  if (route === '/login') {
    return <LoginPage navigate={navigate} />;
  }

  return (
    <Layout route={route} onNavigate={navigate}>
      {renderPage(route, navigate)}
    </Layout>
  );
}
