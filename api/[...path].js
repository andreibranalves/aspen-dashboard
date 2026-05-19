import { wrapNetlifyHandler } from './_lib/netlify-adapter.js';

import { handler as crmDeals } from '../netlify/functions/crm-deals.js';
import { handler as crmUpdateDeal } from '../netlify/functions/crm-update-deal.js';
import { handler as editDraft } from '../netlify/functions/edit-draft.js';
import { handler as extract } from '../netlify/functions/extract.js';
import { handler as freight } from '../netlify/functions/freight.js';
import { handler as leadsClients } from '../netlify/functions/leads-clients.js';
import { handler as orcamento } from '../netlify/functions/orcamento.js';
import { handler as pricingLookup } from '../netlify/functions/pricing-lookup.js';
import { handler as productDetail } from '../netlify/functions/product-detail.js';
import { handler as productPricingUpdate } from '../netlify/functions/product-pricing-update.js';
import { handler as productPricing } from '../netlify/functions/product-pricing.js';
import { handler as products } from '../netlify/functions/products.js';
import { handler as quotations } from '../netlify/functions/quotations.js';
import { handler as salesDashboard } from '../netlify/functions/sales-dashboard.js';
import { handler as salesOrderFromQuotation } from '../netlify/functions/sales-order-from-quotation.js';
import { handler as salesOrders } from '../netlify/functions/sales-orders.js';
import { handler as sendWhatsapp } from '../netlify/functions/send-whatsapp.js';
import { handler as view } from '../netlify/functions/view.js';

const ROUTES = {
  'crm-deals': crmDeals,
  'crm-update-deal': crmUpdateDeal,
  'edit-draft': editDraft,
  extract,
  freight,
  'leads-clients': leadsClients,
  orcamento,
  'pricing-lookup': pricingLookup,
  'product-detail': productDetail,
  'product-pricing-update': productPricingUpdate,
  'product-pricing': productPricing,
  products,
  quotations,
  'sales-dashboard': salesDashboard,
  'sales-order-from-quotation': salesOrderFromQuotation,
  'sales-orders': salesOrders,
  'send-whatsapp': sendWhatsapp,
  view,
};

function getRouteName(req) {
  const path = req.query?.path;
  if (Array.isArray(path)) return path[0];
  return path;
}

export default async function handler(req, res) {
  const routeName = getRouteName(req);
  const routeHandler = ROUTES[routeName];

  if (!routeHandler) {
    return res.status(404).json({ error: 'Endpoint não encontrado.' });
  }

  return wrapNetlifyHandler(routeHandler)(req, res);
}
