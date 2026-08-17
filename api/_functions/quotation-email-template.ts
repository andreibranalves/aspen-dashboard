import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import {
  validateQuotationEmailTemplate,
} from '../_lib/quotation-email-template.js';
import {
  createPostgresQuotationEmailTemplateRepository,
  type QuotationEmailTemplateRepository,
} from '../_db/quotation-email-template-repository.js';

export interface QuotationEmailTemplateHandlerDependencies {
  repository: QuotationEmailTemplateRepository;
}

function jsonResponse(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

function logDatabaseError(operation: 'load' | 'save'): void {
  console.error(`[quotation-email-template] failed to ${operation}`);
}

export function createHandler(
  dependencies: QuotationEmailTemplateHandlerDependencies = {
    repository: createPostgresQuotationEmailTemplateRepository(),
  },
): LegacyHandler {
  return async function quotationEmailTemplateHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod === 'GET') {
      try {
        return jsonResponse(200, await dependencies.repository.get());
      } catch {
        logDatabaseError('load');
        return jsonResponse(500, {
          error: 'Não foi possível carregar o modelo de e-mail. Tente novamente.',
        });
      }
    }

    if (event.httpMethod === 'PUT') {
      let payload: unknown;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        return jsonResponse(400, { error: 'JSON inválido.' });
      }

      const validation = validateQuotationEmailTemplate(payload);
      if (!validation.ok) {
        return jsonResponse(400, {
          error: 'Revise os campos destacados.',
          fields: validation.fields,
        });
      }

      try {
        return jsonResponse(200, await dependencies.repository.save(validation.value));
      } catch {
        logDatabaseError('save');
        return jsonResponse(500, {
          error: 'Não foi possível salvar o modelo de e-mail. Tente novamente.',
        });
      }
    }

    return jsonResponse(405, { error: 'Método não permitido.' }, { Allow: 'GET, PUT' });
  };
}

export const handler = createHandler();
