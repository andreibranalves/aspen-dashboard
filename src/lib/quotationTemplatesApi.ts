import { apiGet, apiPost, apiPut } from '@/lib/api';

export interface QuotationTemplateMetadata {
  id: string;
  key: string;
  name: string;
  archived: boolean;
  is_default: boolean;
  current_version_id: string;
  current_version: number;
  current_hash: string;
  usage_count: number;
  updated_at: string;
}

export interface QuotationTemplateDetail extends QuotationTemplateMetadata {
  current_source: string;
  versions: Array<{
    id: string;
    version: number;
    source_hash: string;
    created_at: string;
  }>;
}

export interface QuotationTemplateValidation {
  valid: boolean;
  warnings: string[];
  preview: string;
}

export interface QuotationTemplateInput {
  key: string;
  name: string;
  source: string;
}

export interface QuotationTemplateVersionInput {
  name?: string;
  source: string;
}

interface TemplateListResponse {
  templates?: QuotationTemplateMetadata[];
  data?: QuotationTemplateMetadata[];
  default_key: string;
}

export function listQuotationTemplates(activeOnly = false): Promise<TemplateListResponse> {
  return apiGet<TemplateListResponse>(
    `/quotation-templates${activeOnly ? '?active=true' : ''}`
  );
}

export async function getQuotationTemplate(id: string): Promise<QuotationTemplateDetail> {
  const result = await apiGet<{ data: QuotationTemplateDetail }>(
    `/quotation-templates?id=${encodeURIComponent(id)}`
  );
  return result.data;
}

export function validateQuotationTemplate(
  source: string,
  key: string
): Promise<QuotationTemplateValidation> {
  return apiPost<QuotationTemplateValidation>('/quotation-templates/validate', { source, key });
}

export function createQuotationTemplate(input: QuotationTemplateInput): Promise<{ id: string }> {
  return apiPost<{ id: string }>('/quotation-templates', input);
}

export function saveQuotationTemplateVersion(
  id: string,
  input: QuotationTemplateVersionInput
): Promise<{ id: string }> {
  return apiPut<{ id: string }>(`/quotation-templates?id=${encodeURIComponent(id)}`, {
    action: 'save_version',
    ...input,
  });
}

export function archiveQuotationTemplate(id: string): Promise<{ archived: true }> {
  return apiPut<{ archived: true }>(`/quotation-templates?id=${encodeURIComponent(id)}`, {
    action: 'archive',
  });
}

export function setDefaultQuotationTemplate(id: string): Promise<{ default_key: string }> {
  return apiPut<{ default_key: string }>(`/quotation-templates?id=${encodeURIComponent(id)}`, {
    action: 'set_default',
  });
}

/** Compatibility alias for consumers that still only need template metadata. */
export type QuotationTemplate = QuotationTemplateMetadata;
