// Única definição de rotas da API. Novos endpoints são registrados aqui, uma única vez.
import type { LegacyHandler } from '../_http/types.js';

import { handler as crmDeals } from '../_modules/crm-deals.js';
import { handler as crmPipelineStages } from '../_modules/crm-pipeline-stages.js';
import { handler as crmUpdateDeal } from '../_modules/crm-update-deal.js';
import { handler as duplicateQuotation } from '../_modules/duplicate-quotation.js';
import { handler as editDraft } from '../_modules/edit-draft.js';
import { handler as extract } from '../_modules/extract.js';
import { handler as commercialExport } from '../_modules/commercial-export.js';
import { handler as commercialQueue } from '../_modules/commercial-queue.js';
import { handler as proposalOpportunities } from '../_modules/proposal-opportunities.js';
import { handler as clientDetail } from '../_modules/client-detail.js';
import { handler as clientMatches } from '../_modules/client-matches.js';
import { handler as leadsClients } from '../_modules/leads-clients.js';
import { handler as login } from '../_modules/login.js';
import { handler as logout } from '../_modules/logout.js';
import { handler as orcamento } from '../_modules/orcamento.js';
import { handler as pricingLookup } from '../_modules/pricing-lookup.js';
import { handler as productDetail } from '../_modules/product-detail.js';
import { handler as productUpdate } from '../_modules/product-update.js';
import { handler as productPricingUpdate } from '../_modules/product-pricing-update.js';
import { handler as productActivity } from '../_modules/product-activity.js';
import { handler as productPricing } from '../_modules/product-pricing.js';
import { handler as products } from '../_modules/products.js';
import { handler as quotations } from '../_modules/quotations.js';
import { handler as quotationTemplates } from '../_modules/quotation-templates.js';
import { handler as orderTemplates } from '../_modules/order-templates.js';
import { handler as quotationPreview } from '../_modules/quotation-preview.js';
import { handler as quotationIssues } from '../_modules/quotation-issues.js';
import { handler as publicQuotation } from '../_modules/public-quotation.js';
import { handler as salesDashboard } from '../_modules/sales-dashboard.js';
import { handler as salesOrderFromQuotation } from '../_modules/sales-order-from-quotation.js';
import { handler as salesOrders } from '../_modules/sales-orders.js';
import { handler as sendWhatsapp } from '../_modules/send-whatsapp.js';
import { handler as sendQuotationEmail } from '../_modules/send-quotation-email.js';
import { handler as quotationDeliveries } from '../_modules/quotation-deliveries.js';
import { handler as evolutionWebhook } from '../_modules/evolution-webhook.js';
import { handler as quotationFollowUpWorker } from '../_modules/quotation-follow-up-worker.js';
import { handler as followUps } from '../_modules/follow-ups.js';
import { handler as quotationDeliveryWorker } from '../_modules/quotation-delivery-worker.js';
import { handler as whatsappDeliveryDiagnostics } from '../_modules/whatsapp-delivery-diagnostics.js';
import { handler as sendWhatsappFlow } from '../_modules/send-whatsapp-flow.js';
import { handler as settings } from '../_modules/settings.js';
import { handler as tasks } from '../_modules/tasks.js';
import { whatsappConversations, whatsappMessages } from '../_modules/whatsapp-attendance.js';
import { whatsappBackfill } from '../_modules/whatsapp-backfill.js';
import { whatsappMessageActions } from '../_modules/whatsapp-message-send.js';
import { handler as whatsappContext } from '../_modules/whatsapp-context.js';
import { atendimentoClientLink, atendimentoContext } from '../_modules/atendimento-context.js';
import { atendimentoQuoteDraft } from '../_modules/atendimento-quote-draft.js';
import { atendimentoAi } from '../_modules/atendimento-ai.js';
import { whatsappMessageMedia } from '../_modules/whatsapp-message-media.js';
import { whatsappAttachments } from '../_modules/whatsapp-attachments.js';
import { handler as communicationFlowPreview } from '../_modules/communication-flow-preview.js';
import { handler as communicationSendEvents } from '../_modules/communication-send-events.js';
import { handler as communicationFlows } from '../_modules/communication-flows.js';
import { handler as communicationMedia } from '../_modules/communication-media.js';
import { handler as communicationMediaUpload } from '../_modules/communication-media-upload.js';
import { handler as pdf } from '../_modules/pdf.js';
import { handler as view } from '../_modules/view.js';
import { handler as operationalStatus } from '../_modules/operational-status.js';
import { handler as siteQuoteLeads } from '../_modules/site-quote-leads.js';

export const routes: Record<string, LegacyHandler> = {
  'operational-status': operationalStatus,
  'client-detail': clientDetail,
  'client-matches': clientMatches,
  'crm-deals': crmDeals,
  'crm-pipeline-stages': crmPipelineStages,
  'crm-update-deal': crmUpdateDeal,
  'duplicate-quotation': duplicateQuotation,
  'edit-draft': editDraft,
  extract,
  'commercial-exports': commercialExport,
  'commercial-queue': commercialQueue,
  'proposal-opportunities': proposalOpportunities,
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
  quotations,
  'quotation-templates': quotationTemplates,
  'order-templates': orderTemplates,
  'quotation-preview': quotationPreview,
  'quotation-issues': quotationIssues,
  'public-quotation': publicQuotation,
  'sales-dashboard': salesDashboard,
  'sales-order-from-quotation': salesOrderFromQuotation,
  'sales-orders': salesOrders,
  'site-quote-leads': siteQuoteLeads,
  'send-whatsapp': sendWhatsapp,
  'send-quotation-email': sendQuotationEmail,
  'quotation-deliveries': quotationDeliveries,
  'evolution-webhook': evolutionWebhook,
  'quotation-follow-up-worker': quotationFollowUpWorker,
  'follow-ups': followUps,
  'quotation-delivery-worker': quotationDeliveryWorker,
  'whatsapp-delivery-diagnostics': whatsappDeliveryDiagnostics,
  'send-whatsapp-flow': sendWhatsappFlow,
  settings,
  tasks,
  'whatsapp-conversations': whatsappConversations,
  'whatsapp-messages': whatsappMessages,
  'whatsapp-backfill': whatsappBackfill,
  'whatsapp-message-actions': whatsappMessageActions,
  'whatsapp-context': whatsappContext,
  'atendimento-context': atendimentoContext,
  'atendimento-client-link': atendimentoClientLink,
  'atendimento-quote-draft': atendimentoQuoteDraft,
  'atendimento-ai': atendimentoAi,
  'whatsapp-message-media': whatsappMessageMedia,
  'whatsapp-attachments': whatsappAttachments,
  'communication-flow-preview': communicationFlowPreview,
  'communication-send-events': communicationSendEvents,
  'communication-flows': communicationFlows,
  'communication-media': communicationMedia,
  'communication-media-upload': communicationMediaUpload,
  view,
  login,
  logout,
};
