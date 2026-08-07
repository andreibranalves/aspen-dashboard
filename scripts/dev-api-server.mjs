// Dev API server — serves the Vercel Functions handlers on port 8888.
// Used for local testing without Vercel CLI auth.
// Start: node scripts/dev-api-server.mjs

import './load-env.mjs';
import { createServer } from 'node:http';

// Import all handlers
import { handler as crmDeals } from '../api/_functions/crm-deals.js';
import { handler as crmUpdateDeal } from '../api/_functions/crm-update-deal.js';
import { handler as crmPruneCandidates } from '../api/_functions/crm-prune-candidates.js';
import { handler as duplicateQuotation } from '../api/_functions/duplicate-quotation.js';
import { handler as editDraft } from '../api/_functions/edit-draft.js';
import { handler as clientDetail } from '../api/_functions/client-detail.js';
import { handler as extract } from '../api/_functions/extract.js';
import { handler as leadsClients } from '../api/_functions/leads-clients.js';
import { handler as login } from '../api/_functions/login.js';
import { handler as logout } from '../api/_functions/logout.js';
import { handler as orcamento } from '../api/_functions/orcamento.js';
import { handler as pricingLookup } from '../api/_functions/pricing-lookup.js';
import { handler as productDetail } from '../api/_functions/product-detail.js';
import { handler as productUpdate } from '../api/_functions/product-update.js';
import { handler as productPricingUpdate } from '../api/_functions/product-pricing-update.js';
import { handler as productActivity } from '../api/_functions/product-activity.js';
import { handler as productPricing } from '../api/_functions/product-pricing.js';
import { handler as products } from '../api/_functions/products.js';
import { handler as quoteLeads } from '../api/_functions/quote-leads.js';
import { handler as quotations } from '../api/_functions/quotations.js';
import { handler as quotationTemplates } from '../api/_functions/quotation-templates.js';
import { handler as quotationPreview } from '../api/_functions/quotation-preview.js';
import { handler as publicQuotation } from '../api/_functions/public-quotation.js';
import { handler as salesDashboard } from '../api/_functions/sales-dashboard.js';
import { handler as salesOrderFromQuotation } from '../api/_functions/sales-order-from-quotation.js';
import { handler as salesOrders } from '../api/_functions/sales-orders.js';
import { handler as sendWhatsapp } from '../api/_functions/send-whatsapp.js';
import { handler as sendWhatsappFlow } from '../api/_functions/send-whatsapp-flow.js';
import { handler as settings } from '../api/_functions/settings.js';
import { handler as typebotLeadCapture } from '../api/_functions/typebot-lead-capture.js';
import { handler as whatsappConversations } from '../api/_functions/whatsapp-conversations.js';
import { handler as whatsappFlows } from '../api/_functions/whatsapp-flows.js';
import { handler as whatsappLeads } from '../api/_functions/whatsapp-leads.js';
import { handler as communicationFlowPreview } from '../api/_functions/communication-flow-preview.js';
import { handler as communicationSendEvents } from '../api/_functions/communication-send-events.js';
import { handler as communicationFlows } from '../api/_functions/communication-flows.js';
import { handler as communicationMedia } from '../api/_functions/communication-media.js';
import { handler as communicationMediaUpload } from '../api/_functions/communication-media-upload.js';
import { handler as pdf } from '../api/_functions/pdf.js';
import { handler as operationalStatus } from '../api/_functions/operational-status.js';
import { handler as view } from '../api/_functions/view.js';

const ROUTES = {
  'client-detail': clientDetail,
  'crm-deals': crmDeals,
  'crm-prune-candidates': crmPruneCandidates,
  'crm-update-deal': crmUpdateDeal,
  'duplicate-quotation': duplicateQuotation,
  'edit-draft': editDraft,
  extract,
  'leads-clients': leadsClients,
  login,
  logout,
  orcamento,
  'pricing-lookup': pricingLookup,
  'product-detail': productDetail,
  'product-update': productUpdate,
  'product-pricing-update': productPricingUpdate,
  'product-activity': productActivity,
  'product-pricing': productPricing,
  products,
  'quote-leads': quoteLeads,
  quotations,
  'quotation-templates': quotationTemplates,
  'quotation-preview': quotationPreview,
  'public-quotation': publicQuotation,
  'sales-dashboard': salesDashboard,
  'sales-order-from-quotation': salesOrderFromQuotation,
  'sales-orders': salesOrders,
  'send-whatsapp': sendWhatsapp,
  'send-whatsapp-flow': sendWhatsappFlow,
  pdf,
  settings,
  'operational-status': operationalStatus,
  'typebot-lead-capture': typebotLeadCapture,
  'whatsapp-conversations': whatsappConversations,
  'whatsapp-flows': whatsappFlows,
  'whatsapp-leads': whatsappLeads,
  'communication-flow-preview': communicationFlowPreview,
  'communication-send-events': communicationSendEvents,
  'communication-flows': communicationFlows,
  'communication-media': communicationMedia,
  'communication-media-upload': communicationMediaUpload,
  view,
};

const PORT = 8888;

// Intentional non-production auth bypass: this local harness invokes handlers
// directly for development. The self-hosted production server uses the shared
// isAuthenticated guard instead of duplicating auth logic here.

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];
  const routeName = urlPath.replace(/^\/api\/?/, '').split('/')[0];
  const handler = ROUTES[routeName];

  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint não encontrado.' }));
    return;
  }

  try {
    const body = await parseBody(req);
    const event = {
      httpMethod: req.method,
      body: req.method === 'GET' ? undefined : JSON.stringify(body),
      queryStringParameters: Object.fromEntries(new URL(req.url, 'http://localhost').searchParams),
      headers: {
        ...req.headers,
        host: req.headers.host || `localhost:${PORT}`,
        'x-forwarded-proto': 'http',
      },
      rawUrl: req.url,
      url: req.url,
    };

    const result = await handler(event);
    const responseHeaders = { ...(result.headers || {}) };
    if (!Object.keys(responseHeaders).some((name) => name.toLowerCase() === 'content-type')) {
      responseHeaders['Content-Type'] = 'application/json';
    }
    res.writeHead(result.statusCode || 200, responseHeaders);
    res.end(
      result.isBase64Encoded && typeof result.body === 'string'
        ? Buffer.from(result.body, 'base64')
        : result.body || ''
    );
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error(`[${routeName}]`, err.message);
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Erro interno.' }));
  }
});

server.listen(PORT, () => console.log(`API server on http://localhost:${PORT}`));
