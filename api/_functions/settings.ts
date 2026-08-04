import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import {
  DEFAULT_SETTINGS,
  createPostgresSettingsRepository,
  type Settings,
  type SettingsInput,
  type SettingsRepository,
} from '../_db/settings-repository.js';
import {
  normalizeQuotationSections,
  validateQuotationSections,
  type QuotationSectionsSettings,
} from '../_db/quotation-content.js';
import { isOperationalMode } from './operational-mode.js';

const MAX_PAYMENT_LENGTH = 500;
const MAX_DELIVERY_LENGTH = 500;
const MAX_NOTES_LENGTH = 4000;
const MAX_TEMPLATE_KEY_LENGTH = 120;
const MAX_FREIGHT_INTEGER_DIGITS = 12;

export interface SettingsHandlerDependencies {
  repository: SettingsRepository;
}

interface ValidationFailure {
  error: string;
  fields: Record<string, string>;
}

function jsonResponse(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationFailure(fields: Record<string, string>): ValidationFailure {
  return {
    error: 'Dados de configuração inválidos.',
    fields,
  };
}

function validateText(
  value: unknown,
  field: string,
  maximumLength: number,
  fields: Record<string, string>
): string | null {
  if (typeof value !== 'string') {
    fields[field] = 'Informe um texto válido.';
    return null;
  }

  if (value.length > maximumLength) {
    fields[field] = `Informe no máximo ${maximumLength} caracteres.`;
    return null;
  }

  return value;
}

/**
 * Canonicalizes a BRL decimal using string operations only. This avoids making
 * a JavaScript floating point value the source of truth for money.
 */
function validateFreight(value: unknown, fields: Record<string, string>): string | null {
  if (typeof value !== 'string') {
    fields.frete_padrao = 'Informe o frete como valor decimal com duas casas.';
    return null;
  }

  const input = value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input);
  if (!match) {
    fields.frete_padrao = 'Informe um frete não negativo com até duas casas decimais.';
    return null;
  }

  const integerPart = match[1];
  const fractionalPart = match[2] || '';
  if (integerPart.length > MAX_FREIGHT_INTEGER_DIGITS) {
    fields.frete_padrao = 'O frete informado é maior que o limite permitido.';
    return null;
  }

  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');
  return `${normalizedInteger}.${fractionalPart.padEnd(2, '0')}`;
}

export function validateSettingsPayload(payload: unknown): SettingsInput | ValidationFailure {
  if (!isRecord(payload)) {
    return validationFailure({ geral: 'Envie um objeto de configurações válido.' });
  }

  const fields: Record<string, string> = {};
  const validadeDias = payload.validade_dias;
  if (
    typeof validadeDias !== 'number' ||
    !Number.isInteger(validadeDias) ||
    validadeDias < 1 ||
    validadeDias > 365
  ) {
    fields.validade_dias = 'Informe uma validade em dias entre 1 e 365.';
  }

  const pagamento = payload.pagamento === undefined
    ? ''
    : validateText(payload.pagamento, 'pagamento', MAX_PAYMENT_LENGTH, fields);
  const entrega = payload.entrega === undefined
    ? undefined
    : validateText(payload.entrega, 'entrega', MAX_DELIVERY_LENGTH, fields);
  const fretePadrao = validateFreight(payload.frete_padrao, fields);
  const observacoes = payload.observacoes === undefined
    ? ''
    : validateText(payload.observacoes, 'observacoes', MAX_NOTES_LENGTH, fields);
  const templatePadrao = payload.template_padrao === undefined
    ? undefined
    : validateText(payload.template_padrao, 'template_padrao', MAX_TEMPLATE_KEY_LENGTH, fields);
  if (templatePadrao !== null && templatePadrao !== undefined && !templatePadrao.trim()) {
    fields.template_padrao = 'Informe a chave do template padrão.';
  }

  let secoes: QuotationSectionsSettings;
  if (payload.secoes !== undefined) {
    try {
      validateQuotationSections(payload.secoes);
      secoes = normalizeQuotationSections(payload.secoes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Informe seções válidas.';
      const section = /seção "([^"]+)"/i.exec(message)?.[1];
      const field = /campo "([^"]+)"/i.exec(message)?.[1];
      const titleError = /Título da seção "([^"]+)"/i.exec(message);
      fields[
        `secoes.${section || titleError?.[1] || 'geral'}${field ? `.${field}` : titleError ? '.title' : ''}`
      ] = message;
      if (section) {
        fields[`secoes.${section}.title`] = message;
      }
      secoes = normalizeQuotationSections(undefined);
    }
  } else {
    secoes = normalizeQuotationSections(undefined, {
      pagamento: pagamento ?? '',
      entrega: entrega ?? '',
      observacoes: observacoes ?? '',
    });
  }

  if (Object.keys(fields).length > 0) {
    return validationFailure(fields);
  }

  return {
    validade_dias: validadeDias as number,
    pagamento: secoes.pagamento.body,
    ...(typeof entrega === 'string' ? { entrega } : {}),
    frete_padrao: fretePadrao as string,
    observacoes: secoes.condicoes_gerais.body,
    secoes,
    ...(typeof templatePadrao === 'string' ? { template_padrao: templatePadrao.trim() } : {}),
  };
}

function isValidationFailure(result: Settings | SettingsInput | ValidationFailure): result is ValidationFailure {
  return 'fields' in result;
}

function logDatabaseError(operation: 'load' | 'save', error: unknown): void {
  // Keep diagnostics in server logs while returning a safe Portuguese message
  // to API consumers. Do not serialize database driver errors or connection
  // strings into HTTP responses or broad server logs.
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[settings] failed to ${operation} settings (${kind})`);
}

export function createHandler(
  dependencies: SettingsHandlerDependencies = {
    repository: createPostgresSettingsRepository(),
  }
): LegacyHandler {
  return async function settingsHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod === 'GET') {
      try {
        const settings = await dependencies.repository.get();
        const response = settings || { ...DEFAULT_SETTINGS };
        return jsonResponse(200, { ...response, operational_mode: isOperationalMode() });
      } catch (error) {
        logDatabaseError('load', error);
        return jsonResponse(500, {
          error: 'Não foi possível carregar as configurações. Tente novamente.',
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

      const settings = validateSettingsPayload(payload);
      if (isValidationFailure(settings)) {
        return jsonResponse(400, settings);
      }

      try {
        const saved = await dependencies.repository.save(settings);
        return jsonResponse(200, saved);
      } catch (error) {
        logDatabaseError('save', error);
        return jsonResponse(500, {
          error: 'Não foi possível salvar as configurações. Tente novamente.',
        });
      }
    }

    return jsonResponse(405, { error: 'Método não permitido.' }, { Allow: 'GET, PUT' });
  };
}

export const handler = createHandler();
