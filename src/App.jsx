import { useHashRoute } from '@/hooks/useHashRoute.js';
import Layout from '@/components/layout/Layout.jsx';
import QuotationsPage from '@/pages/QuotationsPage.jsx';
import QuotationDetailPage from '@/pages/QuotationDetailPage.jsx';
import AutoQuotePage from '@/pages/AutoQuotePage.jsx';
import FreightPage from '@/pages/FreightPage.jsx';
import CrmKanbanPage from '@/pages/CrmKanbanPage.jsx';
import ProductsPage from '@/pages/ProductsPage.jsx';
import ProductDetailPage from '@/pages/ProductDetailPage.jsx';
import LeadsPage from '@/pages/LeadsPage.jsx';
import SettingsPage from '@/pages/SettingsPage.jsx';

function renderPage(route, navigate) {
  // Detail page: #/quotations/ORC-20261143
  if (route.startsWith('/quotations/')) {
    const id = route.split('/quotations/')[1];
    return <QuotationDetailPage id={id} navigate={navigate} />;
  }

  // Product detail page: #/products/LNC-SED-70
  if (route.startsWith('/products/')) {
    const sku = route.split('/products/')[1];
    return <ProductDetailPage sku={sku} navigate={navigate} />;
  }

  switch (route) {
    case '/quotations': return <QuotationsPage navigate={navigate} />;
    case '/auto':       return <AutoQuotePage />;
    case '/freight':    return <FreightPage />;
    case '/crm':        return <CrmKanbanPage />;
    case '/products':   return <ProductsPage />;
    case '/leads':      return <LeadsPage />;
    case '/settings':   return <SettingsPage />;
    default:            return <QuotationsPage navigate={navigate} />;
  }
}

export default function App() {
  const [route, navigate] = useHashRoute();

  return (
    <Layout route={route} onNavigate={navigate}>
      {renderPage(route, navigate)}
    </Layout>
  );
}
