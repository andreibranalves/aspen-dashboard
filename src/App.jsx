import { useHashRoute } from '@/hooks/useHashRoute.js';
import Layout from '@/components/layout/Layout.jsx';
import DashboardPage from '@/pages/DashboardPage.jsx';
import QuotationsPage from '@/pages/QuotationsPage.jsx';
import QuotationDetailPage from '@/pages/QuotationDetailPage.jsx';
import SalesOrdersPage from '@/pages/SalesOrdersPage.jsx';
import SalesOrderDetailPage from '@/pages/SalesOrderDetailPage.jsx';
import AutoQuotePage from '@/pages/AutoQuotePage.jsx';
import FreightPage from '@/pages/FreightPage.jsx';
import CrmKanbanPage from '@/pages/CrmKanbanPage.jsx';
import ProductsPage from '@/pages/ProductsPage.jsx';
import ProductDetailPage from '@/pages/ProductDetailPage.jsx';
import LeadsPage from '@/pages/LeadsPage.jsx';
import LeadDetailPage from '@/pages/LeadDetailPage.jsx';
import SettingsPage from '@/pages/SettingsPage.jsx';
import ManualOrcamentoPage from '@/pages/ManualOrcamentoPage.jsx';
import LoginPage from '@/pages/LoginPage.jsx';

function renderPage(route, navigate) {
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
    case '/dashboard':   return <DashboardPage navigate={navigate} />;
    case '/quotations':  return <QuotationsPage navigate={navigate} />;
    case '/auto':        return <AutoQuotePage />;
    case '/sales-orders': return <SalesOrdersPage navigate={navigate} />;
    case '/freight':     return <FreightPage />;
    case '/crm':         return <CrmKanbanPage />;
    case '/products':    return <ProductsPage />;
    case '/leads':       return <LeadsPage navigate={navigate} />;
    case '/settings':    return <SettingsPage />;
    case '/manual':      return <ManualOrcamentoPage />;
    default:             return <AutoQuotePage />;
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
