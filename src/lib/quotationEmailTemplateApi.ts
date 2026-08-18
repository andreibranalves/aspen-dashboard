import { apiGet, apiPut } from '@/lib/api';

export {
  DEFAULT_QUOTATION_EMAIL_TEMPLATE,
  QUOTATION_EMAIL_TEMPLATE_LIMITS,
  QUOTATION_EMAIL_TEMPLATE_TOKENS,
  renderQuotationEmailTemplate,
  validateQuotationEmailTemplate,
} from '../../api/_lib/quotation-email-template.js';
export type {
  QuotationEmailTemplate,
  QuotationEmailTemplateField,
} from '../../api/_lib/quotation-email-template.js';

import type { QuotationEmailTemplate } from '../../api/_lib/quotation-email-template.js';

export function getQuotationEmailTemplate(): Promise<QuotationEmailTemplate> {
  return apiGet<QuotationEmailTemplate>('/quotation-email-template');
}

export function saveQuotationEmailTemplate(
  template: QuotationEmailTemplate,
): Promise<QuotationEmailTemplate> {
  return apiPut<QuotationEmailTemplate>('/quotation-email-template', template);
}
