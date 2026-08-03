import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import { isCoreQuotesEnabled, responseMetadata } from './orcamento-mode.js';
import { getQuotationTemplateManifest } from './lib/quotation-templates.js';

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (!isCoreQuotesEnabled()) return json(404, { error: 'Endpoint não encontrado.' });
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });
  const templates = getQuotationTemplateManifest();
  const defaultTemplate = templates.find((template) => template.is_default)!;
  return json(200, {
    data: templates,
    templates,
    default: defaultTemplate,
    default_key: defaultTemplate.key,
    default_hash: defaultTemplate.hash,
    ...responseMetadata('core'),
  });
}

export const quotationTemplatesHandler: LegacyHandler = handler;
