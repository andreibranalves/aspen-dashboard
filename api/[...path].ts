import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  VercelRequestLike,
  VercelResponseLike,
  FunctionEvent,
  FunctionResult,
} from './_lib/types.js';
import { wrapFunctionHandler } from './_lib/function-adapter.js';
import { isAuthenticated, getRouteName, isMachineRoute } from './_lib/auth.js';
import { checkRateLimitAsync } from './_lib/rate-limit.js';

import { handler as crmDeals } from './_functions/crm-deals.js';
import { handler as crmUpdateDeal } from './_functions/crm-update-deal.js';
import { handler as crmPruneCandidates } from './_functions/crm-prune-candidates.js';
import { handler as duplicateQuotation } from './_functions/duplicate-quotation.js';
import { handler as editDraft } from './_functions/edit-draft.js';
import { handler as extract } from './_functions/extract.js';
import { handler as clientDetail } from './_functions/client-detail.js';
import { handler as leadsClients } from './_functions/leads-clients.js';
import { handler as login } from './_functions/login.js';
import { handler as logout } from './_functions/logout.js';
import { handler as orcamento } from './_functions/orcamento.js';
import { handler as pricingLookup } from './_functions/pricing-lookup.js';
import { handler as productDetail } from './_functions/product-detail.js';
import { handler as productUpdate } from './_functions/product-update.js';
import { handler as productPricingUpdate } from './_functions/product-pricing-update.js';
import { handler as productActivity } from './_functions/product-activity.js';
import { handler as productPricing } from './_functions/product-pricing.js';
import { handler as products } from './_functions/products.js';
import { handler as quoteLeads } from './_functions/quote-leads.js';
import { handler as quotations } from './_functions/quotations.js';
import { handler as quotationTemplates } from './_functions/quotation-templates.js';
import { handler as orderTemplates } from './_functions/order-templates.js';
import { handler as quotationPreview } from './_functions/quotation-preview.js';
import { handler as quotationIssues } from './_functions/quotation-issues.js';
import { handler as publicQuotation } from './_functions/public-quotation.js';
import { handler as salesDashboard } from './_functions/sales-dashboard.js';
import { handler as salesOrderFromQuotation } from './_functions/sales-order-from-quotation.js';
import { handler as salesOrders } from './_functions/sales-orders.js';
import { handler as sendWhatsapp } from './_functions/send-whatsapp.js';
import { handler as sendWhatsappFlow } from './_functions/send-whatsapp-flow.js';
import { handler as whatsappSendStatus } from './_functions/whatsapp-send-status.js';
import { handler as quotationDeliveries } from './_functions/quotation-deliveries.js';
import {
  handler as evolutionWebhook,
  MAX_EVOLUTION_WEBHOOK_BODY_BYTES,
} from './_functions/evolution-webhook.js';
import { handler as quotationDeliveryWorker } from './_functions/quotation-delivery-worker.js';
import { handler as settings } from './_functions/settings.js';
import { handler as typebotLeadCapture } from './_functions/typebot-lead-capture.js';
import { handler as whatsappConversations } from './_functions/whatsapp-conversations.js';
import { handler as whatsappFlows } from './_functions/whatsapp-flows.js';
import { handler as whatsappLeads } from './_functions/whatsapp-leads.js';
import { handler as communicationFlowPreview } from './_functions/communication-flow-preview.js';
import { handler as communicationSendEvents } from './_functions/communication-send-events.js';
import { handler as communicationFlows } from './_functions/communication-flows.js';
import { handler as communicationMedia } from './_functions/communication-media.js';
import { handler as communicationMediaUpload } from './_functions/communication-media-upload.js';
import { handler as pdf } from './_functions/pdf.js';
import { handler as view } from './_functions/view.js';
import { handler as operationalStatus } from './_functions/operational-status.js';

type HandlerFunction = (event: FunctionEvent) => Promise<FunctionResult>;

const ROUTES: Record<string, HandlerFunction> = {
  'operational-status': operationalStatus,
  'client-detail': clientDetail,
  'crm-deals': crmDeals,
  'crm-prune-candidates': crmPruneCandidates,
  'crm-update-deal': crmUpdateDeal,
  'duplicate-quotation': duplicateQuotation,
  'edit-draft': editDraft,
  extract,
  'leads-clients': leadsClients,
  orcamento,
  pdf,
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
  'order-templates': orderTemplates,
  'quotation-preview': quotationPreview,
  'quotation-issues': quotationIssues,
  'public-quotation': publicQuotation,
  'sales-dashboard': salesDashboard,
  'sales-order-from-quotation': salesOrderFromQuotation,
  'sales-orders': salesOrders,
  'send-whatsapp': sendWhatsapp,
  'send-whatsapp-flow': sendWhatsappFlow,
  'whatsapp-send-status': whatsappSendStatus,
  'quotation-deliveries': quotationDeliveries,
  'evolution-webhook': evolutionWebhook,
  'quotation-delivery-worker': quotationDeliveryWorker,
  settings,
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
  login,
  logout,
};

function requestHeader(
  req: VercelRequestLike,
  name: string,
): string | undefined {
  const canonicalName = name
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('-');
  const value = req.headers?.[name] ?? req.headers?.[canonicalName];
  if (Array.isArray(value)) return value[0];
  return value;
}

function requestBodyByteLength(body: unknown): number {
  if (body === undefined || body === null) return 0;
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  if (Buffer.isBuffer(body)) return body.length;
  if (body && typeof (body as { on?: unknown }).on === 'function') {
    return Number.POSITIVE_INFINITY;
  }
  try {
    const serialized = JSON.stringify(body);
    return typeof serialized === 'string' ? Buffer.byteLength(serialized, 'utf8') : 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isOversizedEvolutionWebhookRequest(req: VercelRequestLike): boolean {
  const rawContentLength = requestHeader(req, 'content-length');
  if (rawContentLength !== undefined) {
    const contentLength = Number(rawContentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) return true;
    if (contentLength > MAX_EVOLUTION_WEBHOOK_BODY_BYTES) return true;
  }
  return requestBodyByteLength(req.body) > MAX_EVOLUTION_WEBHOOK_BODY_BYTES;
}

export default async function handler(
  req: VercelRequestLike,
  res: VercelResponseLike
): Promise<void> {
  const routeName = getRouteName(req);

  if (routeName === 'evolution-webhook' && isOversizedEvolutionWebhookRequest(req)) {
    res.status(413).json({ error: 'Corpo da requisição excede o limite permitido.' });
    return;
  }

  // ── Auth guard ──
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'Não autorizado. Faça login em /api/login.' });
    return;
  }

  // ── Rate limit ──
  if (!isMachineRoute(routeName) && !(await checkRateLimitAsync(req))) {
    res.status(429).json({ error: 'Muitas requisições. Aguarde um minuto.' });
    return;
  }
  const routeHandler = ROUTES[routeName];

  if (!routeHandler) {
    res.status(404).json({ error: 'Endpoint não encontrado.' });
    return;
  }

  return wrapFunctionHandler(routeHandler)(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse
  );
}
