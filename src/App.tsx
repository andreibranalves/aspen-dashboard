import { useHashRoute } from '@/hooks/useHashRoute';
import Layout from '@/components/layout/Layout';
import DashboardPage from '@/pages/DashboardPage';
import QuotationsPage from '@/pages/QuotationsPage';
import QuotationDetailPage from '@/pages/QuotationDetailPage';
import SalesOrdersPage from '@/pages/SalesOrdersPage';
import SalesOrderDetailPage from '@/pages/SalesOrderDetailPage';
import AutoQuotePage from '@/pages/AutoQuotePage';
import CrmKanbanPage from '@/pages/CrmKanbanPage';
import ProductsPage from '@/pages/ProductsPage';
import ProductDetailPage from '@/pages/ProductDetailPage';
import LeadsPage from '@/pages/LeadsPage';
import LeadDetailPage from '@/pages/LeadDetailPage';
import SettingsPage from '@/pages/SettingsPage';
import ManualOrcamentoPage from '@/pages/ManualOrcamentoPage';
import ComunicacaoPage from '@/pages/ComunicacaoPage';
import LoginPage from '@/pages/LoginPage';

function renderPage(route: string, navigate: (hash: string) => void) {
  // Login page — full screen, no layout
  if (route === '/login') return <LoginPage navigate={navigate} />;
  // Detail page: #/quotations/ORC-20261143
  if (route.startsWith('/quotations/')) {
    const id = route.split('/quotations/')[1];
    return <QuotationDetailPage id={id} navigate={navigate} />;
  }

  // Detail page: #/sales-orders/VP-20261143
  if (route.startsWith('/sales-orders/')) {
    const id = route.split('/sales-orders/')[1];
    return <SalesOrderDetailPage id={id} navigate={navigate} />;
  }

  // Product detail page: #/products/LNC-SED-70
  if (route.startsWith('/products/')) {
    const sku = route.split('/products/')[1];
    return <ProductDetailPage sku={sku} navigate={navigate} />;
  }

  // Lead/Customer detail page: #/leads/lead/CRM-LEAD-... or #/leads/cliente/CUST-...
  if (route.startsWith('/leads/')) {
    const parts = route.split('/');
    const tipo = parts[2];
    const id = parts.slice(3).join('/');
    if (tipo && id) return <LeadDetailPage tipo={tipo} id={id} navigate={navigate} />;
  }

  switch (route) {
    case '/dashboard':
      return <DashboardPage navigate={navigate} />;
    case '/quotations':
      return <QuotationsPage navigate={navigate} />;
    case '/auto':
      return <AutoQuotePage />;
    case '/sales-orders':
      return <SalesOrdersPage navigate={navigate} />;
    case '/crm':
      return <CrmKanbanPage />;
    case '/products':
      return <ProductsPage />;
    case '/leads':
      return <LeadsPage navigate={navigate} />;
    case '/settings':
      return <SettingsPage />;
    case '/manual':
      return <ManualOrcamentoPage />;
    case '/comunicacao':
      return <ComunicacaoPage />;
    default:
      return <AutoQuotePage />;
  }
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
