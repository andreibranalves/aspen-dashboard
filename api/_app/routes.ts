// Única definição de rotas da API. Novos endpoints são registrados aqui, uma única vez.
import type { LegacyHandler } from '../_http/types.js';

import { handler as crmDeals } from '../_functions/crm-deals.js';
import { handler as crmUpdateDeal } from '../_functions/crm-update-deal.js';
import { handler as crmPruneCandidates } from '../_functions/crm-prune-candidates.js';
import { handler as duplicateQuotation } from '../modules/duplicate-quotation.js';
import { handler as editDraft } from '../modules/edit-draft.js';
import { handler as extract } from '../modules/extract.js';
import { handler as clientDetail } from '../modules/client-detail.js';
import { handler as leadsClients } from '../modules/leads-clients.js';
import { handler as login } from '../_functions/login.js';
import { handler as logout } from '../_functions/logout.js';
import { handler as orcamento } from '../modules/orcamento.js';
import { handler as pricingLookup } from '../modules/pricing-lookup.js';
import { handler as productDetail } from '../modules/product-detail.js';
import { handler as productUpdate } from '../modules/product-update.js';
import { handler as productPricingUpdate } from '../modules/product-pricing-update.js';
import { handler as productActivity } from '../modules/product-activity.js';
import { handler as productPricing } from '../modules/product-pricing.js';
import { handler as products } from '../modules/products.js';
import { handler as quoteLeads } from '../modules/quote-leads.js';
import { handler as quotations } from '../modules/quotations.js';
import { handler as quotationTemplates } from '../modules/quotation-templates.js';
import { handler as orderTemplates } from '../modules/order-templates.js';
import { handler as quotationPreview } from '../modules/quotation-preview.js';
import { handler as quotationIssues } from '../modules/quotation-issues.js';
import { handler as publicQuotation } from '../modules/public-quotation.js';
import { handler as salesDashboard } from '../_functions/sales-dashboard.js';
import { handler as salesOrderFromQuotation } from '../_functions/sales-order-from-quotation.js';
import { handler as salesOrders } from '../_functions/sales-orders.js';
import { handler as sendWhatsapp } from '../modules/send-whatsapp.js';
import { handler as sendWhatsappFlow } from '../modules/send-whatsapp-flow.js';
import { handler as whatsappSendStatus } from '../modules/whatsapp-send-status.js';
import { handler as settings } from '../_functions/settings.js';
import { handler as typebotLeadCapture } from '../modules/typebot-lead-capture.js';
import { handler as whatsappConversations } from '../modules/whatsapp-conversations.js';
import { handler as whatsappFlows } from '../modules/whatsapp-flows.js';
import { handler as whatsappLeads } from '../modules/whatsapp-leads.js';
import { handler as communicationFlowPreview } from '../modules/communication-flow-preview.js';
import { handler as communicationSendEvents } from '../modules/communication-send-events.js';
import { handler as communicationFlows } from '../modules/communication-flows.js';
import { handler as communicationMedia } from '../modules/communication-media.js';
import { handler as communicationMediaUpload } from '../modules/communication-media-upload.js';
import { handler as pdf } from '../modules/pdf.js';
import { handler as view } from '../modules/view.js';
import { handler as operationalStatus } from '../_functions/operational-status.js';

export const routes: Record<string, LegacyHandler> = {
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
