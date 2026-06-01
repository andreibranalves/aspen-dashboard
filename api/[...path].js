import { wrapFunctionHandler } from './_lib/function-adapter.js';
import { isAuthenticated, getRouteName } from './_lib/auth.js';
import { checkRateLimit } from './_lib/rate-limit.js';

import { handler as crmDeals } from './_functions/crm-deals.js';
import { handler as crmUpdateDeal } from './_functions/crm-update-deal.js';
import { handler as duplicateQuotation } from './_functions/duplicate-quotation.js';
import { handler as editDraft } from './_functions/edit-draft.js';
import { handler as extract } from './_functions/extract.js';
import { handler as freight } from './_functions/freight.js';
import { handler as clientDetail } from './_functions/client-detail.js';
import { handler as leadsClients } from './_functions/leads-clients.js';
import { handler as login } from './_functions/login.js';
import { handler as logout } from './_functions/logout.js';
import { handler as orcamento } from './_functions/orcamento.js';
import { handler as pricingLookup } from './_functions/pricing-lookup.js';
import { handler as productDetail } from './_functions/product-detail.js';
import { handler as productUpdate } from './_functions/product-update.js';
import { handler as productPricingUpdate } from './_functions/product-pricing-update.js';
import { handler as productPricing } from './_functions/product-pricing.js';
import { handler as products } from './_functions/products.js';
import { handler as quotations } from './_functions/quotations.js';
import { handler as salesDashboard } from './_functions/sales-dashboard.js';
import { handler as salesOrderFromQuotation } from './_functions/sales-order-from-quotation.js';
import { handler as salesOrders } from './_functions/sales-orders.js';
import { handler as sendWhatsapp } from './_functions/send-whatsapp.js';
import { handler as pdf } from './_functions/pdf.js';
import { handler as view } from './_functions/view.js';

const ROUTES = {
  'client-detail': clientDetail,
  'crm-deals': crmDeals,
  'crm-update-deal': crmUpdateDeal,
  'duplicate-quotation': duplicateQuotation,
  'edit-draft': editDraft,
  extract,
  freight,
  'leads-clients': leadsClients,
  orcamento,
  pdf,
  'pricing-lookup': pricingLookup,
  'product-detail': productDetail,
  'product-update': productUpdate,
  'product-pricing-update': productPricingUpdate,
  'product-pricing': productPricing,
  products,
  quotations,
  'sales-dashboard': salesDashboard,
  'sales-order-from-quotation': salesOrderFromQuotation,
  'sales-orders': salesOrders,
  'send-whatsapp': sendWhatsapp,
  view,
  login,
  logout,
};

export default async function handler(req, res) {
  // ── Auth guard ──
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Não autorizado. Faça login em /api/login.' });
  }

  // ── Rate limit ──
  if (!checkRateLimit(req)) {
    return res.status(429).json({ error: 'Muitas requisições. Aguarde um minuto.' });
  }

  const routeName = getRouteName(req);
  const routeHandler = ROUTES[routeName];

  if (!routeHandler) {
    return res.status(404).json({ error: 'Endpoint não encontrado.' });
  }

  return wrapFunctionHandler(routeHandler)(req, res);
}
