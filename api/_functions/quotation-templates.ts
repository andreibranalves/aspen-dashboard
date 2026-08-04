import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import { isCoreQuotesEnabled, responseMetadata } from './orcamento-mode.js';
import {
  createQuotationTemplateLibraryRepository,
  type QuotationTemplateLibraryRepository,
  QuotationTemplateLibraryConflictError,
  QuotationTemplateLibraryInputError,
  QuotationTemplateLibraryNotFoundError,
  QuotationTemplateLibraryRepositoryError,
} from '../_db/quotation-template-library-repository.js';

function json(statusCode: number, payload: object): FunctionResult {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ ...payload, ...responseMetadata('core') }) };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function body(event: FunctionEvent): Record<string, unknown> | null { try { const value = JSON.parse(event.body || '{}'); return record(value) ? value : null; } catch { return null; } }
function errorResponse(error: unknown): FunctionResult {
  if (error instanceof QuotationTemplateLibraryInputError || error instanceof QuotationTemplateLibraryNotFoundError || error instanceof QuotationTemplateLibraryConflictError || error instanceof QuotationTemplateLibraryRepositoryError) return json(error.statusCode, { error: error.message });
  console.error(`[quotation-templates] request failed (${error instanceof Error ? error.name : typeof error})`);
  return json(503, { error: 'Não foi possível processar o catálogo de templates. Tente novamente.' });
}
function isValidate(event: FunctionEvent): boolean { return new URL(event.url || '/api/quotation-templates', 'http://localhost').pathname.replace(/\/$/, '') === '/api/quotation-templates/validate'; }

export interface QuotationTemplatesDependencies { repository: QuotationTemplateLibraryRepository; }
export function createQuotationTemplatesHandler(dependencies: QuotationTemplatesDependencies = { repository: createQuotationTemplateLibraryRepository() }): LegacyHandler {
  return async (event) => {
    if (!isCoreQuotesEnabled()) return json(404, { error: 'Endpoint não encontrado.' });
    try {
      if (isValidate(event)) {
        if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
        const input = body(event); if (!input) return json(400, { error: 'JSON inválido.' });
        return json(200, await dependencies.repository.validate({ key: String(input.key || ''), source: String(input.source || '') }));
      }
      if (event.httpMethod === 'GET') {
        const id = event.queryStringParameters?.id;
        if (id) return json(200, { data: await dependencies.repository.get(id) });
        const result = await dependencies.repository.list(event.queryStringParameters?.active === 'true');
        return json(200, { ...result, data: result.templates });
      }
      const input = body(event); if (!input) return json(400, { error: 'JSON inválido.' });
      if (event.httpMethod === 'POST') return json(201, await dependencies.repository.create({ key: String(input.key || ''), name: String(input.name || ''), source: String(input.source || '') }));
      if (event.httpMethod !== 'PUT') return json(405, { error: 'Método não permitido.' });
      const id = event.queryStringParameters?.id; if (!id) return json(400, { error: 'ID do template não informado.' });
      const action = input.action;
      if (action === 'save_version') return json(200, await dependencies.repository.saveVersion(id, { name: input.name == null ? undefined : String(input.name), source: String(input.source || '') }));
      if (action === 'archive') return json(200, await dependencies.repository.archive(id));
      if (action === 'set_default') return json(200, await dependencies.repository.setDefault(id));
      return json(400, { error: 'Ação de template inválida.' });
    } catch (error) { return errorResponse(error); }
  };
}
export const handler = createQuotationTemplatesHandler();
export const quotationTemplatesHandler = handler;
